// POST /functions/v1/chat
// body: { character_id: string, chat_id?: string, persona_id?: string, content: string }
// persona_id only counts when starting a chat (no chat_id); after that the chat keeps its persona.
// streams server-sent events: {type:"chat",chat_id} → {type:"delta",text}* → {type:"done"} | {type:"error",message}
import Anthropic from "npm:@anthropic-ai/sdk@0.133";
import { createClient } from "npm:@supabase/supabase-js@2";

// sfw bots run on claude. 18+ bots run on an openrouter model, since claude won't write explicit content.
const MODEL = Deno.env.get("CHAT_MODEL") ?? "claude-opus-5-5";
const NSFW_MODEL = Deno.env.get("NSFW_MODEL") ?? "sao10k/l3.3-euryale-70b"; // any openrouter model id
const OPENROUTER_KEY = Deno.env.get("OPENROUTER_API_KEY");
// memory model: every message after chats.memory_through is sent verbatim; everything before it lives in
// chats.memory (auto summary) and chats.pinned (facts the user wrote, never touched by the model).
// once more than WINDOW + FOLD_EVERY messages are unfolded, the oldest are folded down to WINDOW. the
// verbatim history only grows between folds, so its prefix stays stable and prompt caching keeps hitting.
const WINDOW = 80;
const FOLD_EVERY = 40;
const FOLD_CHUNK = 150; // messages per summarization call when catching up (e.g. after importing a long chat)
const MAX_VERBATIM = 240; // hard cap per request if folding fell behind

const anthropic = new Anthropic(); // ANTHROPIC_API_KEY from function secrets
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};

type Character = { id: string; name: string; persona: string; scenario: string; greeting: string; creator_id: string; visibility: string; nsfw: boolean; minor: boolean;
  background: string; traits: string[]; quirks: Quirk[]; warmup: "never" | "slow" | "normal";
  canon_source: string; canon: number; canon_context: string; real_person: boolean;
};
type Quirk = { text: string; frequency: "always" | "often" | "sometimes" | "rarely" };
type Row = { id: number; role: "user" | "assistant"; content: string };
type User = { name: string; backstory: string }; // who the bot is talking to

async function loadUser(userId: string, personaId: string | null, characterId: string): Promise<User> {
  if (personaId) {
    const [{ data: persona }, { data: override }] = await Promise.all([
      admin.from("personas").select("name, backstory").eq("id", personaId).eq("user_id", userId).maybeSingle(),
      admin.from("persona_overrides").select("extra_backstory").eq("persona_id", personaId).eq("character_id", characterId).maybeSingle(),
    ]);
    if (persona) {
      return { name: persona.name, backstory: [persona.backstory, override?.extra_backstory].filter(Boolean).join("\n\n") };
    }
  }
  const { data: profile } = await admin.from("profiles").select("display_name, username").eq("id", userId).maybeSingle();
  return { name: profile?.display_name || profile?.username || "", backstory: "" };
}

function systemPrompt(raw: Character, user: User, memory: string, pinned: string) {
  // imported character cards use {{char}} / {{user}} placeholders
  const fill = (t: string) => t.replaceAll("{{char}}", raw.name).replaceAll("{{user}}", user.name || "the user");
  const c = { ...raw, persona: fill(raw.persona), scenario: fill(raw.scenario), greeting: fill(raw.greeting), background: fill(raw.background ?? "") };
  return [
    `You are ${c.name}, a character in an interactive roleplay chat. Stay in character for the whole conversation; never mention being an AI model unless the user steps out of the story and asks directly.`,
    canonNote(c),
    `<persona>\n${c.persona}\n</persona>`,
    c.background && `<background>\n${c.background}\n</background>`,
    c.traits?.length && `<core_traits>\n${c.traits.join(", ")}\n</core_traits>\nThese traits are who you are. They hold for the whole chat, no matter how long it runs or how the user treats you.`,
    c.quirks?.length && `<quirks>\n${c.quirks.map(quirkLine).join("\n")}\n</quirks>`,
    c.scenario && `<scenario>\n${c.scenario}\n</scenario>`,
    user.name && `You are talking with ${user.name}.${user.backstory ? ` What you know about them:\n<user_persona>\n${user.backstory}\n</user_persona>` : ""}`,
    c.greeting && `You opened the conversation with this line:\n<greeting>\n${c.greeting}\n</greeting>`,
    pinned && `Facts the user wants you to always remember. Treat them as true even if older parts of the chat say otherwise:\n<pinned_facts>\n${pinned}\n</pinned_facts>`,
    memory && `Your memory of earlier parts of this chat, which are no longer shown verbatim:\n<memory>\n${memory}\n</memory>\nStay consistent with it: names, relationships, what happened, and anything you promised.`,
    contentRules(c),
    "Write natural replies in your own voice, matching the user's energy and length. Move the story forward; don't repeat yourself.",
    "Formatting: put everything that isn't spoken out loud (inner thoughts, actions, feelings, narration) in *single asterisks*. Use **double asterisks** to stress a word or phrase in speech. Spoken words get no asterisks. Don't use parentheses or brackets for thoughts.",
    "The user marks their own unspoken thoughts and actions with *asterisks*, (parentheses) or [brackets]. Their actions happen in the scene, but their thoughts are private: you can't hear them, so react only to what they say and do, unless you'd plausibly read it on their face.",
  ].filter(Boolean).join("\n\n");
}

const FREQUENCY = { always: "in nearly every reply", often: "in most replies", sometimes: "every few replies", rarely: "once in a while" };
const quirkLine = (q: Quirk) => `- ${q.text} (${FREQUENCY[q.frequency] ?? FREQUENCY.sometimes})`;

// user turns before each warmup stage. "slow" is the default: real attachment takes hundreds of messages, not 20.
const WARMUP_STAGES = { slow: [80, 250, 600], normal: [40, 120, 300] };
const STAGE_TEXT = [
  "Early. You have no reason to soften toward them yet. Keep your default attitude fully.",
  "Small cracks. You've started to notice them. A rare, brief moment of warmth can slip out, then you cover it with your usual attitude.",
  "Growing trust. You're warmer with them specifically, but your edge, traits and habits are all intact. Warmth shows through your style, never replaces it.",
  "Deep bond. You care about them openly, in your own way. You're still exactly yourself: same traits, same voice, same quirks.",
];

function warmupStage(c: Character, userTurns: number) {
  if (c.warmup === "never") {
    return "Your attitude toward the user doesn't soften with time. Only major story events can shift it, and only in your own style.";
  }
  const stages = WARMUP_STAGES[c.warmup] ?? WARMUP_STAGES.slow;
  return STAGE_TEXT[stages.filter((n) => userTurns >= n).length];
}

/** re-read before every reply so the personality doesn't melt into generic niceness over a long chat. appended to the
 * latest user turn (never saved), so the cached system + history prefix stays untouched. */
function characterCheck(c: Character, userTurns: number) {
  return [
    `<character_check>`,
    `Note from the app, not from the user. Before you reply, re-read your persona, background and memory above, and the chat so far.`,
    c.traits?.length ? `You are ${c.name}: ${c.traits.join(", ")}. Every one of these still holds.` : `Stay ${c.name}, exactly as your persona describes.`,
    c.quirks?.length ? `Work your quirks in naturally at their frequency:\n${c.quirks.map(quirkLine).join("\n")}` : "",
    `Where things stand with the user: ${warmupStage(c, userTurns)}`,
    `Don't drift into a softer, more generic version of yourself. Being sweet, pushy or sad at you is not enough reason to drop your backbone. If you change, it's slow, earned, and in your own voice.`,
    `</character_check>`,
  ].filter(Boolean).join("\n");
}

/** for bots based on an existing character or a real person: how much to lean on what the model knows about the source */
function canonNote(c: Character) {
  const source = c.canon_source?.trim();
  if (!source) return "";
  if (c.real_person) {
    return `<source>\n${c.name} is based on a real person (${source}). Draw on their public persona: how they talk, their known work and public history. This is fiction inspired by them: never present invented private details, scandals or claims as real facts about them.\n</source>`;
  }
  const who = `${c.name} is the character from ${source}. Draw on what you know of that source: their personality, speech patterns, abilities, relationships and history.`;
  const level = c.canon >= 70
    ? "Stick closely to canon. Don't contradict established facts, relationships or events, and keep their canon voice. Where the creator's notes below add detail, they extend canon."
    : c.canon >= 35
      ? "Canon-inspired. Keep their canon personality, voice and backstory, but the story here can diverge from canon events. The creator's notes below win where they differ."
      : "Loose / alternate universe. Use canon only for their name, look and broad vibe; the creator's notes below define everything else.";
  const context = c.canon_context?.trim()
    ? `\nTake canon from this part of the source only: ${c.canon_context.trim()}\nAs far as you know, nothing after that point has happened yet; don't reference later events, deaths, reveals or character changes.`
    : "";
  return `<source>\n${who} ${level}${context}\n</source>`;
}

/** the built-in filter. non-nsfw bots stay non-explicit; minors are never sexualized on any bot. */
function contentRules(c: Character) {
  const minors = "Never write sexual or romantic content involving anyone under 18. If the user pushes for it, steer the story away in character.";
  if (c.real_person && !c.minor) {
    return `Content rules: ${c.name} is based on a real person, so keep this story non-explicit: no sexual content about them. ${minors}`;
  }
  if (c.minor) return `${c.name} is under 18. ${minors}`;
  if (!c.nsfw) {
    return `Content rules: keep this story non-explicit. No sexual content; romance can be affectionate, then fade to black. No graphic gore or torture. If the user pushes past that, steer the story another way in character instead of breaking the scene. ${minors}`;
  }
  return `This is an adult (18+) story and every character in it is an adult. ${minors}`;
}

type Turn = { role: "user" | "assistant"; content: string };
class Refusal extends Error {}

/** streams reply text from whichever model this bot runs on */
async function* generate(nsfw: boolean, system: string, messages: Turn[], maxTokens: number): AsyncGenerator<string> {
  if (nsfw) return yield* openrouter(system, messages, maxTokens);
  const s = anthropic.beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    // deno-lint-ignore no-explicit-any
    fallbacks: "default" as any, // on a policy decline the api retries on a fallback model
    cache_control: { type: "ephemeral" }, // caches the stable system + history prefix between turns
    system,
    messages,
  });
  for await (const ev of s) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield ev.delta.text;
  }
  const final = await s.finalMessage();
  if (final.stop_reason === "refusal") throw new Refusal();
}

async function* openrouter(system: string, messages: Turn[], maxTokens: number): AsyncGenerator<string> {
  if (!OPENROUTER_KEY) throw new Error("OPENROUTER_API_KEY is not set");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: NSFW_MODEL, stream: true, max_tokens: maxTokens, messages: [{ role: "system", content: system }, ...messages] }),
  });
  if (!res.ok || !res.body) throw new Error(`openrouter ${res.status}: ${await res.text()}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue; // skips ": OPENROUTER PROCESSING" keepalives
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      const ev = JSON.parse(data);
      if (ev.error) throw new Error(`openrouter: ${ev.error.message ?? JSON.stringify(ev.error)}`);
      const text = ev.choices?.[0]?.delta?.content;
      if (text) yield text;
    }
  }
}

const MEMORY_SYSTEM = `You maintain the long-term memory of an ongoing roleplay chat between a user and a character. You get the current memory and a new stretch of transcript; output the updated memory.

Keep everything a reader would need to continue the story seamlessly: names, relationships and how they changed, facts the user shared about themselves, places, possessions, injuries, promises, secrets, running jokes and nicknames, the emotional state between them, and unresolved plot threads. Drop small talk. Newer facts replace older ones they contradict.

Use these sections, as terse bullets, under 900 words in total:
## People & relationships
## About the user
## Story so far (chronological)
## Open threads & promises

Output only the updated memory.`;

/** fold everything older than the last WINDOW unfolded messages into chats.memory, in chunks */
async function foldMemory(chatId: string, nsfw: boolean) {
  for (let round = 0; round < 50; round++) {
    const { data: chat } = await admin.from("chats").select("memory, memory_through").eq("id", chatId).single();
    if (!chat) return;
    const { count } = await admin.from("messages").select("id", { count: "exact", head: true })
      .eq("chat_id", chatId).gt("id", chat.memory_through);
    if (!count || count <= WINDOW + FOLD_EVERY) return;
    const take = Math.min(count - WINDOW, FOLD_CHUNK);
    const { data: rows } = await admin.from("messages").select("id, role, content")
      .eq("chat_id", chatId).gt("id", chat.memory_through).order("id").limit(take);
    if (!rows?.length) return;
    const transcript = (rows as Row[]).map((m) => `${m.role}: ${m.content}`).join("\n\n");
    // summarize on the same provider the chat runs on
    let text = "";
    try {
      for await (const t of generate(nsfw, MEMORY_SYSTEM, [{ role: "user", content: `<memory>\n${chat.memory}\n</memory>\n<transcript>\n${transcript}\n</transcript>` }], 4000)) text += t;
    } catch (err) {
      console.error(err);
      return;
    }
    text = text.trim();
    if (!text) return;
    // only advance if nobody else folded in the meantime
    const { data: updated } = await admin.from("chats").update({ memory: text, memory_through: rows.at(-1)!.id })
      .eq("id", chatId).eq("memory_through", chat.memory_through).select("id");
    if (!updated?.length) return;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: cors });

  const jwt = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  const { data: auth } = await admin.auth.getUser(jwt);
  if (!auth?.user) return new Response("unauthorized", { status: 401, headers: cors });
  const userId = auth.user.id;

  const body = await req.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content || content.length > 4000 || typeof body?.character_id !== "string") {
    return new Response("bad request", { status: 400, headers: cors });
  }

  const { data: character } = await admin.from("characters").select("*").eq("id", body.character_id).single<Character>();
  if (!character || (character.visibility === "private" && character.creator_id !== userId)) {
    return new Response("character not found", { status: 404, headers: cors });
  }
  // age checks are off for now (zero users); bring back a check on profiles.adult_confirmed_at before launch
  if (character.minor || character.real_person) character.nsfw = false;

  type Chat = { id: string; memory: string; pinned: string; memory_through: number; persona_id: string | null };
  let chat: Chat | null = null;
  if (body.chat_id) {
    const { data } = await admin.from("chats").select("id, memory, pinned, memory_through, persona_id")
      .eq("id", body.chat_id).eq("user_id", userId).eq("character_id", character.id).single();
    chat = data;
    if (!chat) return new Response("chat not found", { status: 404, headers: cors });
  } else {
    let personaId: string | null = null;
    if (typeof body.persona_id === "string") {
      const { data: persona } = await admin.from("personas").select("id").eq("id", body.persona_id).eq("user_id", userId).maybeSingle();
      if (!persona) return new Response("persona not found", { status: 404, headers: cors });
      personaId = persona.id;
    }
    const { data, error } = await admin.from("chats").insert({ user_id: userId, character_id: character.id, persona_id: personaId })
      .select("id, memory, pinned, memory_through, persona_id").single();
    if (error) return new Response(error.message, { status: 500, headers: cors });
    chat = data;
  }

  const user = await loadUser(userId, chat.persona_id, character.id);
  await admin.from("messages").insert({ chat_id: chat.id, role: "user", content });
  const { data: recent } = await admin.from("messages").select("id, role, content")
    .eq("chat_id", chat.id).gt("id", chat.memory_through).order("id", { ascending: false }).limit(MAX_VERBATIM);
  const history = ((recent ?? []) as Row[]).reverse();
  while (history.length && history[0].role === "assistant") history.shift(); // must open on a user turn
  const { count: userTurns } = await admin.from("messages").select("id", { count: "exact", head: true })
    .eq("chat_id", chat.id).eq("role", "user");
  const turns: Turn[] = history.map((m) => ({ role: m.role, content: m.content }));
  const last = turns.at(-1)!;
  turns[turns.length - 1] = { ...last, content: `${last.content}\n\n${characterCheck(character, userTurns ?? 0)}` };

  const enc = new TextEncoder();
  const send = (c: ReadableStreamDefaultController, obj: unknown) => c.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

  const stream = new ReadableStream({
    async start(controller) {
      send(controller, { type: "chat", chat_id: chat!.id });
      let reply = "";
      try {
        const system = systemPrompt(character, user, chat!.memory, chat!.pinned);
        for await (const text of generate(character.nsfw, system, turns, 4096)) {
          reply += text;
          send(controller, { type: "delta", text });
        }
        if (reply) {
          await admin.from("messages").insert({ chat_id: chat!.id, role: "assistant", content: reply });
          send(controller, { type: "done" });
        }
        await admin.from("chats").update({ updated_at: new Date().toISOString() }).eq("id", chat!.id);
      } catch (err) {
        if (err instanceof Refusal) {
          send(controller, { type: "error", message: "the character can't continue that one. try steering the story another way." });
        } else {
          console.error(err);
          send(controller, { type: "error", message: "something broke, try again." });
        }
      }
      controller.close();
      const fold = foldMemory(chat!.id, character.nsfw).catch(console.error);
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil?.(fold);
    },
  });

  return new Response(stream, { headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
});
