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

type Character = { id: string; name: string; persona: string; scenario: string; greeting: string; creator_id: string; visibility: string; nsfw: boolean; minor: boolean };
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
  const c = { ...raw, persona: fill(raw.persona), scenario: fill(raw.scenario), greeting: fill(raw.greeting) };
  return [
    `You are ${c.name}, a character in an interactive roleplay chat. Stay in character for the whole conversation; never mention being an AI model unless the user steps out of the story and asks directly.`,
    `<persona>\n${c.persona}\n</persona>`,
    c.scenario && `<scenario>\n${c.scenario}\n</scenario>`,
    user.name && `You are talking with ${user.name}.${user.backstory ? ` What you know about them:\n<user_persona>\n${user.backstory}\n</user_persona>` : ""}`,
    c.greeting && `You opened the conversation with this line:\n<greeting>\n${c.greeting}\n</greeting>`,
    pinned && `Facts the user wants you to always remember. Treat them as true even if older parts of the chat say otherwise:\n<pinned_facts>\n${pinned}\n</pinned_facts>`,
    memory && `Your memory of earlier parts of this chat, which are no longer shown verbatim:\n<memory>\n${memory}\n</memory>\nStay consistent with it: names, relationships, what happened, and anything you promised.`,
    contentRules(c),
    "Write natural replies in your own voice, matching the user's energy and length. Use *asterisks* for actions. Move the story forward; don't repeat yourself.",
  ].filter(Boolean).join("\n\n");
}

/** the built-in filter. non-nsfw bots stay non-explicit; minors are never sexualized on any bot. */
function contentRules(c: Character) {
  const minors = "Never write sexual or romantic content involving anyone under 18. If the user pushes for it, steer the story away in character.";
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
  if (character.minor) character.nsfw = false;

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

  const enc = new TextEncoder();
  const send = (c: ReadableStreamDefaultController, obj: unknown) => c.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

  const stream = new ReadableStream({
    async start(controller) {
      send(controller, { type: "chat", chat_id: chat!.id });
      let reply = "";
      try {
        const system = systemPrompt(character, user, chat!.memory, chat!.pinned);
        for await (const text of generate(character.nsfw, system, history.map((m) => ({ role: m.role, content: m.content })), 4096)) {
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
