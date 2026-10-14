"use client";
import { useState } from "react";
import { SUPABASE_URL, supabase } from "@/lib/supabase";

/** send feedback straight to the people running mirror ai */
export function FeedbackButton({ className = "icon-btn round", label }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [contact, setContact] = useState("");
  const [state, setState] = useState<"" | "sending" | "sent">("");
  const [error, setError] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setState("sending");
    setError("");
    const { data } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
      body: JSON.stringify({ body, contact, page: location.pathname }),
    }).catch(() => null);
    if (!res?.ok) { setState(""); return setError(res ? await res.text() : "couldn't reach the server"); }
    setState("sent");
    setBody("");
  }

  return (
    <>
      <button type="button" className={className} title="send feedback" aria-label="send feedback" onClick={() => { setOpen(true); setState(""); }}>
        {label ?? "✉"}
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <form className="panel modal" onClick={(e) => e.stopPropagation()} onSubmit={send}>
            <h2>Send feedback</h2>
            {state === "sent" ? (
              <>
                <p style={{ margin: 0 }}>thanks, it went straight to the Mirror AI team.</p>
                <div className="row"><button type="button" onClick={() => setOpen(false)}>close</button></div>
              </>
            ) : (
              <>
                <p className="muted" style={{ margin: 0 }}>bugs, ideas, complaints, anything. it goes straight to the people building Mirror AI.</p>
                <textarea rows={6} autoFocus maxLength={4000} value={body} placeholder="what's on your mind?" onChange={(e) => setBody(e.target.value)} />
                <input value={contact} maxLength={200} placeholder="email or @handle if you want a reply (optional)" onChange={(e) => setContact(e.target.value)} />
                {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
                <div className="row">
                  <button disabled={state === "sending" || !body.trim()}>{state === "sending" ? "sending…" : "send"}</button>
                  <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>cancel</button>
                </div>
              </>
            )}
          </form>
        </div>
      )}
    </>
  );
}
