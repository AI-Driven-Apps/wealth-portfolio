import type { ReactNode } from "react";

// The few Markdown features the brief uses: headings, bullets, bold, italics,
// links. React escapes everything, so model output can't inject HTML, and only
// http(s) links become anchors.
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|_(.+?)_|\*(.+?)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<b key={k++}>{m[1]}</b>);
    else if (m[2] || m[3]) out.push(<i key={k++}>{m[2] ?? m[3]}</i>);
    else out.push(<a key={k++} href={m[5]} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline">{m[4]}</a>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length} className="ml-5 list-disc space-y-1">{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) { list.push(bullet[1]); continue; }
    flush();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) blocks.push(<h3 key={blocks.length} className="mt-4 text-[14px] font-semibold first:mt-0">{inline(h[2])}</h3>);
    else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="space-y-2 text-[14px] leading-relaxed">{blocks}</div>;
}
