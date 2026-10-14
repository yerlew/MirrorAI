"use client";
import Link from "next/link";
import { useState } from "react";
import { supabase, usernameProblem } from "@/lib/supabase";

export default function SignUp() {
  const [f, setF] = useState({ name: "", email: "", username: "", password: "" });
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = usernameProblem(f.username);
    if (problem) return setError(problem);
    setError("");
    setBusy(true);
    // the database turns this metadata into the profile and hands out the #tag
    const { data, error } = await supabase.auth.signUp({
      email: f.email,
      password: f.password,
      options: { data: { display_name: f.name.trim(), username: f.username.trim() } },
    });
    setBusy(false);
    if (error) setError(error.message);
    else if (data.session) location.href = "/profile";
    else setSent(true);
  }

  if (sent) {
    return (
      <main>
        <div className="panel" style={{ maxWidth: 520 }}>
          <h2>check your email</h2>
          <p className="muted" style={{ margin: 0 }}>We sent a link to {f.email}. Confirm it, then <Link href="/login" style={{ color: "var(--accent)" }}>log in</Link>.</p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <form className="stack" onSubmit={submit}>
        <h2 style={{ margin: 0 }}>make an account</h2>
        <label className="field">name
          <input value={f.name} onChange={set("name")} placeholder="what people see on your profile" required maxLength={40} autoComplete="name" />
        </label>
        <label className="field">email
          <input type="email" value={f.email} onChange={set("email")} required autoComplete="email" />
        </label>
        <label className="field">username
          <input value={f.username} onChange={set("username")} placeholder="anything you want" required maxLength={32} autoComplete="username" />
          <span>
            {f.username.trim() && !usernameProblem(f.username)
              ? <>you&apos;ll be <strong style={{ color: "var(--text)" }}>{f.username.trim()}#</strong>number. the number is yours for good, handed out in signup order</>
              : "No rules except no #. Everyone gets a permanent #number on the end, like Yerlew#0, so names don't have to be unique."}
          </span>
        </label>
        <label className="field">password
          <input type="password" value={f.password} onChange={set("password")} required minLength={8} autoComplete="new-password" />
        </label>
        <div className="row">
          <button disabled={busy}>{busy ? "making it…" : "sign up"}</button>
          <Link href="/login" className="muted" style={{ marginLeft: 8 }}>have an account? <span style={{ color: "var(--accent)" }}>log in</span></Link>
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}
