import type { Metadata } from "next";
import Link from "next/link";
import { ChatList } from "@/components/ChatList";
import "./globals.css";

export const metadata: Metadata = { title: "Mirror AI", description: "chat with ai characters that actually remember you" };

const NAV = [
  { href: "/", label: "Discover" },
  { href: "/chats", label: "Chats", mobileOnly: true },
  { href: "/create", label: "Create" },
  { href: "/import", label: "Import" },
  { href: "/profile", label: "Profile" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <Link href="/" className="brand">Mirror<span>AI</span></Link>
            <nav>{NAV.filter((n) => !n.mobileOnly).map((n) => <Link key={n.href} href={n.href}>{n.label}</Link>)}</nav>
            <div className="sidebar-label">Your chats</div>
            <ChatList compact />
          </aside>
          <div className="content">
            <header>
              <Link href="/" className="brand">Mirror<span>AI</span></Link>
              <nav>{NAV.filter((n) => n.href !== "/").map((n) => <Link key={n.href} href={n.href}>{n.label.toLowerCase()}</Link>)}</nav>
            </header>
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
