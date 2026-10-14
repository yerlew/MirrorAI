import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "Mirror AI", description: "chat with ai characters that actually remember you" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <Link href="/" className="brand">Mirror<span>AI</span></Link>
          <nav>
            <Link href="/create">create</Link>
            <Link href="/profile">profile</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
