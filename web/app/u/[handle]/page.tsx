"use client";
import { useParams } from "next/navigation";
import { ProfileView } from "@/components/ProfileView";

export default function CreatorPage() {
  const params = useParams<{ handle: string }>();
  // the #tag arrives url-encoded
  const handle = (() => { try { return decodeURIComponent(params.handle); } catch { return params.handle; } })();
  return <ProfileView handle={handle} />;
}
