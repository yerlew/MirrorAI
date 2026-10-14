"use client";
import { useState } from "react";
import { PostFeed } from "@/components/Posts";

export default function PostsPage() {
  const [tab, setTab] = useState<"all" | "following">("all");
  return (
    <main style={{ maxWidth: 640 }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 24, margin: "8px 0" }}>Posts</h1>
        <div className="segmented" role="group" aria-label="Feed" style={{ marginLeft: "auto" }}>
          <button aria-pressed={tab === "all"} onClick={() => setTab("all")}>Everyone</button>
          <button aria-pressed={tab === "following"} onClick={() => setTab("following")}>Following</button>
        </div>
      </div>
      <PostFeed following={tab === "following"} showComposer />
    </main>
  );
}
