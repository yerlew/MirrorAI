// POST /functions/v1/chat
// body: { character_id: string, chat_id?: string, content: string }
// streams server-sent events: {type:"chat",chat_id} → {type:"delta",text}* → {type:"done"} | {type:"error",message}
import Anthropic from "npm:@anthropic-ai/sdk@0.133";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = Deno.env.get("CHAT_MODEL") ?? "claude-opus-5-5";
const WINDOW = 40; // recent messages sent verbatim; older ones live in chats.memory
const FOLD_EVERY = 20; // fold this many overflow messages into memory at a time

const anthropic = new Anthropic(); // ANTHROPIC_API_KEY from function secrets
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};

type Character = { id: string; name: string; persona: string; scenario: string; greeting: string; creator_id: string; visibility: string };
type Row = { id: number; role: "user" | "assistant"; content: string };

function systemPrompt(c: Character, memory: string) {
  return [
    `You are ${c.name}, a character in an interactive roleplay chat. Stay in character for the whole conversation; never mention being an AI model unless the user steps out of the story and asks directly.`,
    `<persona>\n${c.persona}\n</persona>`,
    c.scenario && `<scenario>\n${c.scenario}\n</scenario>`,
    c.greeting && `You opened the conversation with this line:\n<greeting>\n${c.greeting}\n</greeting>`,
    memory && `What has happened so far in earlier parts of this chat:\n<memory>\n${memory}\n</memory>`,
    "Write natural replies in your own voice, matching the user's energy and length. Use *asterisks* for actions. Move the story forward; don't repeat yourself.",
  ].filter(Boolean).join("\n\n");
}

async function foldMemory(chatId: string, memory: string, memoryThrough: number) {
  const { data: rows } = await admin.from("messages").select("id, role, content")
    .eq("chat_id", chatId).gt("id", memoryThrough).order("id", { ascending: false }).limit(WINDOW + FOLD_EVERY);
  if (!rows || rows.length < WINDOW + FOLD_EVERY) return;
  const overflow = (rows as Row[]).slice(WINDOW).reverse();
  const transcript = overflow.map((m) => `${m.role}: ${m.content}`).join("\n");
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: "low" },
    system: "You maintain the long-term memory of a roleplay chat. Merge the new transcript into the existing memory: keep names, relationships, facts the user shared about themselves, promises and ongoing plot threads. Drop small talk. Write terse bullet points, under 400 words. Output only the updated memory.",
    messages: [{ role: "user", content: `<memory>\n${memory}\n</memory>\n<transcript>\n${transcript}\n</transcript>` }],
  });
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  if (res.stop_reason === "end_turn" && text) {
    await admin.from("chats").update({ memory: text, memory_through: overflow.at(-1)!.id }).eq("id", chatId);
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

  let chat: { id: string; memory: string; memory_through: number } | null = null;
  if (body.chat_id) {
    const { data } = await admin.from("chats").select("id, memory, memory_through")
      .eq("id", body.chat_id).eq("user_id", userId).eq("character_id", character.id).single();
    chat = data;
    if (!chat) return new Response("chat not found", { status: 404, headers: cors });
  } else {
    const { data, error } = await admin.from("chats").insert({ user_id: userId, character_id: character.id })
      .select("id, memory, memory_through").single();
    if (error) return new Response(error.message, { status: 500, headers: cors });
    chat = data;
  }

  await admin.from("messages").insert({ chat_id: chat.id, role: "user", content });
  const { data: recent } = await admin.from("messages").select("id, role, content")
    .eq("chat_id", chat.id).gt("id", chat.memory_through).order("id", { ascending: false }).limit(WINDOW);
  const history = ((recent ?? []) as Row[]).reverse();
  while (history.length && history[0].role === "assistant") history.shift(); // must open on a user turn

  const enc = new TextEncoder();
  const send = (c: ReadableStreamDefaultController, obj: unknown) => c.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

  const stream = new ReadableStream({
    async start(controller) {
      send(controller, { type: "chat", chat_id: chat!.id });
      let reply = "";
      try {
        const s = anthropic.beta.messages.stream({
          model: MODEL,
          max_tokens: 4096,
          output_config: { effort: "low" },
          betas: ["server-side-fallback-2026-07-01"],
          // deno-lint-ignore no-explicit-any
          fallbacks: "default" as any, // on a policy decline the api retries on a fallback model
          system: systemPrompt(character, chat!.memory),
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        });
        for await (const ev of s) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            reply += ev.delta.text;
            send(controller, { type: "delta", text: ev.delta.text });
          }
        }
        const final = await s.finalMessage();
        if (final.stop_reason === "refusal") {
          send(controller, { type: "error", message: "the character can't continue that one. try steering the story another way." });
        } else if (reply) {
          await admin.from("messages").insert({ chat_id: chat!.id, role: "assistant", content: reply });
          send(controller, { type: "done" });
        }
        await admin.from("chats").update({ updated_at: new Date().toISOString() }).eq("id", chat!.id);
      } catch (err) {
        console.error(err);
        send(controller, { type: "error", message: "something broke, try again." });
      }
      controller.close();
      const fold = foldMemory(chat!.id, chat!.memory, chat!.memory_through).catch(console.error);
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil?.(fold);
    },
  });

  return new Response(stream, { headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
});
