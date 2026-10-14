// POST /functions/v1/feedback
// body: { body: string, contact?: string, page?: string }
// saves feedback for the app owner and emails it to FEEDBACK_EMAIL through resend (RESEND_API_KEY).
// without those secrets it's only saved; read it in the supabase table editor (public.feedback).
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
const TO = Deno.env.get("FEEDBACK_EMAIL");
// resend's shared sender works without a domain, but only delivers to the email your resend account signed up with
const FROM = Deno.env.get("FEEDBACK_FROM") ?? "Mirror AI <onboarding@resend.dev>";
const PER_HOUR = 5;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};
const reply = (status: number, msg: string) => new Response(msg, { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return reply(405, "method not allowed");

  const jwt = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  const { data: auth } = await admin.auth.getUser(jwt);
  if (!auth?.user) return reply(401, "log in first");

  const input = await req.json().catch(() => null);
  const body = typeof input?.body === "string" ? input.body.trim() : "";
  if (!body || body.length > 4000) return reply(400, "feedback has to be 1-4000 characters");
  const contact = typeof input?.contact === "string" ? input.contact.trim().slice(0, 200) : "";
  const page = typeof input?.page === "string" ? input.page.slice(0, 300) : "";

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from("feedback").select("id", { count: "exact", head: true }).eq("user_id", auth.user.id).gte("created_at", since);
  if ((count ?? 0) >= PER_HOUR) return reply(429, "that's a lot of feedback, try again in a bit");

  const { data: row, error } = await admin.from("feedback").insert({ user_id: auth.user.id, contact: contact || null, body, page: page || null }).select("id").single();
  if (error) return reply(500, error.message);

  if (RESEND_KEY && TO) {
    const { data: who } = await admin.from("profiles").select("handle, display_name").eq("id", auth.user.id).single();
    const from = who?.handle ?? auth.user.email ?? auth.user.id;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        reply_to: contact.includes("@") ? contact : auth.user.email,
        subject: `Mirror AI feedback from ${from}`,
        text: `${body}\n\n---\nfrom: ${who?.display_name ?? ""} (${from})\naccount email: ${auth.user.email ?? "none"}\ncontact: ${contact || "none"}\npage: ${page || "unknown"}`,
      }),
    });
    if (res.ok) await admin.from("feedback").update({ emailed: true }).eq("id", row.id);
    else console.error("resend", res.status, await res.text());
  }
  return reply(200, "ok");
});
