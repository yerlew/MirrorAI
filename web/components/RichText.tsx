import { Fragment } from "react";

// chat formatting: *thoughts/actions* (dim italic), **emphasis** (bold), ***both***.
// users can also write thoughts in (parentheses) or [brackets]; those stay visible but render dim italic too.
// asterisks only count when they aren't glued to letters/digits, so 2*3*4 stays math
const STARS = String.raw`(?<![\w*])(?:\*\*\*[^*\n]+?\*\*\*|\*\*[^*\n]+?\*\*|\*[^*\n]+?\*)(?![\w*])`;
const BOT = new RegExp(`(${STARS})`, "g");
const USER = new RegExp(String.raw`(${STARS}|\([^()\n]+\)|\[[^[\]\n]+\])`, "g");

export function RichText({ text, user }: { text: string; user?: boolean }) {
  return (
    <>
      {text.split(user ? USER : BOT).map((part, i) => {
        if (part.startsWith("***") && part.endsWith("***") && part.length > 6) return <strong key={i} className="thought">{part.slice(3, -3)}</strong>;
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={i} className="thought">{part.slice(1, -1)}</em>;
        if (user && /^[([].*[)\]]$/.test(part)) return <em key={i} className="thought">{part}</em>;
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}
