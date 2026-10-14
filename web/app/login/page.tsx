"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user?.email ?? null));
  }, []);

  async function submit(kind: "in" | "up") {
    setError("");
    const { data, error } = kind === "in"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    if (error) setError(error.message);
    else setUser(data.user?.email ?? null);
  }

  if (user) {
    return (
      <main>
        <p>logged in as {user}</p>
        <button onClick={() => supabase.auth.signOut().then(() => setUser(null))}>log out</button>
      </main>
    );
  }

  return (
    <main>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); submit("in"); }}>
        <input type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit">log in</button>
          <button type="button" onClick={() => submit("up")} style={{ background: "transparent", border: "1px solid var(--line)", color: "var(--text)" }}>sign up</button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}
