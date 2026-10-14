"use client";
import { useParams } from "next/navigation";
import { ChatPanel } from "@/components/ChatPanel";

export default function Chat() {
  const { id } = useParams<{ id: string }>();
  return <ChatPanel id={id} />;
}
