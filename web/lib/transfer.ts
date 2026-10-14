// import/export of bots + chat history.
// reads: our own format, character card v1/v2/v3 (json or png, used by sillytavern, chub, janitor exports, etc.)
// and sillytavern chat logs (.jsonl). writes: our own format, which embeds a card v2 so other apps can read the bot.
import type { Character, Message } from "./supabase";

export type ImportedBot = {
  name: string;
  tagline: string;
  intro: string;
  persona: string;
  scenario: string;
  greeting: string;
  tags: string[];
  source: string;
  extra?: Partial<Pick<Character, "background" | "traits" | "quirks" | "warmup" | "minor" | "canon_source" | "canon" | "canon_context" | "real_person">>; // our own fields, from extensions.mirrorai
};
export type ImportedMessage = { role: "user" | "assistant"; content: string };
// memoryCovers: how many leading messages the memory summary already covers
export type Imported = { bot: ImportedBot | null; messages: ImportedMessage[]; memory?: string; pinned?: string; memoryCovers?: number };

export const FORMAT = "mirrorai.chat.v1";

export function exportChat(c: Character, messages: Message[], memory: string, pinned: string, memoryCovers: number) {
  return {
    format: FORMAT,
    exported_at: new Date().toISOString(),
    character: {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: c.name,
        description: c.persona,
        personality: (c.traits ?? []).join(", "),
        scenario: c.scenario,
        first_mes: c.greeting,
        mes_example: "",
        creator_notes: c.intro || c.tagline || "",
        tags: c.tags,
        extensions: { mirrorai: { background: c.background, traits: c.traits, quirks: c.quirks, warmup: c.warmup, minor: c.minor, canon_source: c.canon_source, canon: c.canon, canon_context: c.canon_context, real_person: c.real_person } },
      },
    },
    memory,
    memory_covers: memoryCovers,
    pinned,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };
}

export function download(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

type CardData = { extensions?: { mirrorai?: ImportedBot["extra"] }; name?: string; description?: string; personality?: string; scenario?: string; first_mes?: string; mes_example?: string; creator_notes?: string; tags?: string[] };

function fromCard(raw: Record<string, unknown>): ImportedBot | null {
  const spec = typeof raw.spec === "string" ? raw.spec : "chara_card_v1";
  const d = (raw.data && typeof raw.data === "object" ? raw.data : raw) as CardData;
  if (!d.name) return null;
  const extra = d.extensions?.mirrorai;
  const persona = [
    d.description,
    d.personality && !extra?.traits?.length && `Personality: ${d.personality}`,
    d.mes_example && `Example dialogue:\n${d.mes_example}`,
  ].filter(Boolean).join("\n\n");
  return {
    name: String(d.name).slice(0, 60),
    tagline: (d.creator_notes ?? "").split("\n")[0].slice(0, 140),
    intro: (d.creator_notes ?? "").slice(0, 2000),
    persona: persona.slice(0, 8000),
    scenario: d.scenario ?? "",
    greeting: d.first_mes ?? "",
    tags: Array.isArray(d.tags) ? d.tags.map(String).slice(0, 20) : [],
    source: spec,
    extra: extra && typeof extra === "object" ? extra : undefined,
  };
}

// png character cards hide their json, base64-encoded, in a tEXt chunk named "chara" (v2) or "ccv3" (v3)
function cardFromPng(buf: ArrayBuffer): Record<string, unknown> | null {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let offset = 8; // png signature
  const found: Record<string, string> = {};
  while (offset + 8 <= bytes.length) {
    const len = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (type === "tEXt") {
      const chunk = bytes.slice(offset + 8, offset + 8 + len);
      const nul = chunk.indexOf(0);
      const key = new TextDecoder("latin1").decode(chunk.slice(0, nul));
      found[key] = new TextDecoder("latin1").decode(chunk.slice(nul + 1));
    }
    if (type === "IEND") break;
    offset += 12 + len;
  }
  const b64 = found.ccv3 ?? found.chara;
  if (!b64) return null;
  const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
  return JSON.parse(json);
}

/** sillytavern chat: first line is metadata, then one {name, is_user, mes} per line */
function fromSillyTavernChat(text: string): Imported {
  const lines = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const meta = lines[0]?.character_name ? lines.shift() : null;
  const messages = lines
    .filter((l) => typeof l.mes === "string" && !l.is_system)
    .map((l) => ({ role: (l.is_user ? "user" : "assistant") as ImportedMessage["role"], content: l.mes }));
  const bot = meta?.character_name
    ? { name: String(meta.character_name).slice(0, 60), tagline: "", intro: "", persona: "", scenario: "", greeting: "", tags: [], source: "sillytavern_chat" }
    : null;
  return { bot, messages };
}

export async function parseImport(file: File): Promise<Imported> {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 8));
  if (head[0] === 0x89 && head[1] === 0x50) {
    const card = cardFromPng(buf);
    if (!card) throw new Error("that png has no character card in it");
    return { bot: fromCard(card), messages: [] };
  }
  const text = new TextDecoder().decode(buf);
  if (file.name.endsWith(".jsonl")) return fromSillyTavernChat(text);
  const json = JSON.parse(text);
  if (json.format === FORMAT) {
    const messages = (json.messages ?? [])
      .filter((m: ImportedMessage) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m: ImportedMessage) => ({ role: m.role, content: m.content }));
    return { bot: fromCard(json.character), messages, memory: json.memory ?? "", pinned: json.pinned ?? "", memoryCovers: Number(json.memory_covers) || 0 };
  }
  const bot = fromCard(json);
  if (!bot) throw new Error("couldn't find a character in that file");
  return { bot, messages: [] };
}
