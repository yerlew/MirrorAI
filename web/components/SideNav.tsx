"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NOTIFICATIONS_READ, supabase } from "@/lib/supabase";

// stroke icons, 24x24 viewBox
const ICONS: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z",
  discover: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4",
  chats: "M4 5h16v11H8l-4 4z",
  messages: "M3 6h18v12H3zm0 0 9 7 9-7",
  notifications: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4zm4 4a2 2 0 0 0 4 0",
  profiles: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-6 10a6 6 0 0 1 12 0M16 3.5a4 4 0 0 1 0 7.5M21 21a6 6 0 0 0-3.5-5.5",
  user: "M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm-8 9a8 8 0 0 1 16 0",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z",
  create: "M12 5v14M5 12h14",
  import: "M12 4v11m0 0-4-4m4 4 4-4M4 20h16",
};

export const NAV = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/discover", label: "Discover", icon: "discover" },
  { href: "/chats", label: "Chats", icon: "chats" },
  { href: "/messages", label: "Messages", icon: "messages" },
  { href: "/notifications", label: "Notifications", icon: "notifications" },
  { href: "/profiles", label: "Profiles", icon: "profiles" },
  { href: "/profile", label: "User", icon: "user" },
  { href: "/settings", label: "Settings", icon: "settings" },
];
const EXTRA = [
  { href: "/create", label: "Create a bot", icon: "create" },
  { href: "/import", label: "Import", icon: "import" },
];

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

export function SideNav({ mobile }: { mobile?: boolean }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href) && !(href === "/profile" && path.startsWith("/profiles")));
  const items = mobile ? [...NAV, ...EXTRA] : NAV;
  const unread = useUnread(path);
  return (
    <>
      <nav className={mobile ? "mobile-nav" : undefined}>
        {items.map((n) => (
          <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}>
            <Icon name={n.icon} />
            <span>{n.label}</span>
            {n.icon === "notifications" && unread > 0 && <b className="unread-dot" aria-label={`${unread} unread`}>{unread > 99 ? "99+" : unread}</b>}
          </Link>
        ))}
      </nav>
      {!mobile && (
        <nav className="nav-extra">
          {EXTRA.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}

/** unread notification count, refreshed on navigation and when the tab marks them read */
function useUnread(path: string) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const load = async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return setN(0);
      const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
      setN(count ?? 0);
    };
    load();
    window.addEventListener(NOTIFICATIONS_READ, load);
    return () => window.removeEventListener(NOTIFICATIONS_READ, load);
  }, [path]);
  return n;
}
