import type { ReactNode } from "react";
import { richNode } from "./Sym";

export function Card(props: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className={`card ${props.className ?? ""}`}>
      {(props.title || props.actions) && (
        <header className="card-head">
          <div>
            {props.title && <h3 className="card-title">{richNode(props.title)}</h3>}
            {props.subtitle && <p className="card-sub">{richNode(props.subtitle)}</p>}
          </div>
          {props.actions && <div className="card-actions">{props.actions}</div>}
        </header>
      )}
      <div className={`card-body ${props.bodyClassName ?? ""}`}>{richNode(props.children)}</div>
      {props.footer && <footer className="card-foot">{richNode(props.footer)}</footer>}
    </section>
  );
}

export function Badge({ tone, children }: { tone: "good" | "bad" | "warn" | "neutral"; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="dot" />
      {children}
    </span>
  );
}

export function Callout({ tone = "neutral", icon, children }: { tone?: "neutral" | "warn" | "bad" | "good"; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={`callout ${tone === "neutral" ? "" : `callout-${tone}`}`} role={tone === "bad" ? "alert" : undefined}>
      {icon}
      <div>{richNode(children)}</div>
    </div>
  );
}
