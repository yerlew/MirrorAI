"use client";
import Link from "next/link";
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

  async function submit() {
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    else location.href = "/profile";
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
      <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit">log in</button>
          <Link href="/signup" className="muted" style={{ alignSelf: "center", marginLeft: 8 }}>new here? <span style={{ color: "var(--accent)" }}>make an account</span></Link>
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}
