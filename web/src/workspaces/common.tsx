import type { ReactNode } from "react";
import { Badge } from "../components/Card";
import { pct } from "../format";
import { richNode } from "../components/Sym";

export function WsHeader({ title, lead, actions }: { title: string; lead: ReactNode; actions?: ReactNode }) {
  return (
    <header className="ws-header">
      <div>
        <h1 className="ws-title">{title}</h1>
        <p className="ws-lead">{richNode(lead)}</p>
      </div>
      {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>}
    </header>
  );
}

export function SetupName({ name, colour, bold }: { name: string; colour: string | undefined; bold?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: bold ? 600 : undefined, whiteSpace: "nowrap" }}>
      <span className="swatch" style={{ background: colour }} />
      {name}
    </span>
  );
}

export function MarginBadge({ margin }: { margin: number }) {
  if (margin < 0) return <Badge tone="bad">fails · {pct(margin)}</Badge>;
  if (margin < 0.1) return <Badge tone="warn">tight · {pct(margin)}</Badge>;
  return <Badge tone="good">{pct(margin)}</Badge>;
}

export function FeasibleBadge({ ok, yes = "Feasible", no = "Infeasible" }: { ok: boolean; yes?: string; no?: string }) {
  return <Badge tone={ok ? "good" : "bad"}>{ok ? yes : no}</Badge>;
}

/** Download text as a file. */
export function downloadText(text: string, filename: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read a dropped or chosen file as text. */
export const readFileText = (file: File): Promise<string> => file.text();
