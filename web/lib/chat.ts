import { SUPABASE_URL, supabase } from "./supabase";

export type ChatEvent =
  | { type: "chat"; chat_id: string }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

// posts a message to the chat edge function and yields its server-sent events
// personaId only matters when starting a new chat (chatId null)
export async function* sendMessage(characterId: string, chatId: string | null, content: string, personaId: string | null = null): AsyncGenerator<ChatEvent> {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify({ character_id: characterId, chat_id: chatId, persona_id: chatId ? null : personaId, content }),
  });
  if (!res.ok || !res.body) {
    yield { type: "error", message: res.status === 401 ? "log in first" : `request failed (${res.status})` };
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 2);
      if (line.startsWith("data: ")) yield JSON.parse(line.slice(6)) as ChatEvent;
    }
  }
}
