import { ChatList } from "@/components/ChatList";
import { Collection } from "@/components/Collection";

export default function ChatsPage() {
  return (
    <main style={{ maxWidth: 900 }}>
      <h1 style={{ fontSize: 24, margin: "8px 0 12px" }}>Collected</h1>
      <Collection />
      <h1 style={{ fontSize: 24, margin: "24px 0 12px" }}>Your chats</h1>
      <p className="muted" style={{ marginTop: 0 }}>Only you can see these. Bot creators can't see your chats or that you used their bot.</p>
      <ChatList />
    </main>
  );
}
