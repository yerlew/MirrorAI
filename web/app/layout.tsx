import type { Metadata } from "next";
import Link from "next/link";
import { ChatList } from "@/components/ChatList";
import { SideNav } from "@/components/SideNav";
import "./globals.css";

export const metadata: Metadata = { title: "Mirror AI", description: "chat with ai characters that actually remember you" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <Link href="/" className="brand">Mirror<span>AI</span></Link>
            <SideNav />
            <div className="sidebar-label">Your chats</div>
            <ChatList compact />
          </aside>
          <div className="content">
            <header>
              <Link href="/" className="brand">Mirror<span>AI</span></Link>
              <SideNav mobile />
            </header>
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
