/**
 * Typeset model symbols written in plain ASCII (C_DF, a_ref, w_M, ...) with
 * proper subscripts, in HTML and in SVG. Only the known symbols below are
 * converted, so identifiers such as file names are never altered.
 */
import { cloneElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";

const SYMBOL = /(?<![A-Za-z])(C_DF,min|a_lat,max|C_DF|C_D|w_D|w_G|w_M|a_ref|F_grip|F_DF|F_D|F_c|v_max|r_min|μ_min|m_max|L_j)(?![A-Za-z])/g;

function parts(text: string): { base: string; sub: string | null }[] {
  const out: { base: string; sub: string | null }[] = [];
  let last = 0;
  for (const m of text.matchAll(SYMBOL)) {
    const i = m.index;
    if (i > last) out.push({ base: text.slice(last, i), sub: null });
    const [b, s] = m[0].split(/_(.*)/s) as [string, string];
    out.push({ base: b, sub: s });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ base: text.slice(last), sub: null });
  return out;
}

/** HTML: "C_DF" becomes C<sub>DF</sub>. */
export function rich(text: string): ReactNode {
  if (!SYMBOL.test(text)) return text;
  SYMBOL.lastIndex = 0;
  return parts(text).map((p, i) =>
    p.sub === null ? (
      <Fragment key={i}>{p.base}</Fragment>
    ) : (
      <Fragment key={i}>
        {p.base}
        <sub className="sym-sub">{p.sub}</sub>
      </Fragment>
    ),
  );
}

/** SVG: subscripts as shifted tspans, so exported files keep them. */
export function richSvg(text: string): ReactNode {
  if (!SYMBOL.test(text)) return text;
  SYMBOL.lastIndex = 0;
  return parts(text).map((p, i) =>
    p.sub === null ? (
      <tspan key={i}>{p.base}</tspan>
    ) : (
      <Fragment key={i}>
        <tspan>{p.base}</tspan>
        <tspan baselineShift="sub" fontSize="0.75em">{p.sub}</tspan>
      </Fragment>
    ),
  );
}

const SKIP = new Set(["option", "select", "textarea", "pre", "code", "script", "style", "svg"]);

/**
 * Apply `rich` to every string inside plain DOM elements of a tree. Custom
 * components (charts, TeX) are left untouched; they handle their own text.
 */
export function richNode(node: ReactNode): ReactNode {
  if (typeof node === "string") return rich(node);
  if (Array.isArray(node)) return node.map((n, i) => (typeof n === "string" ? <Fragment key={`s${i}`}>{rich(n)}</Fragment> : richNode(n)));
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    const isDom = typeof el.type === "string" && !SKIP.has(el.type);
    if ((isDom || el.type === Fragment) && el.props.children !== undefined) {
      return cloneElement(el, undefined, richNode(el.props.children));
    }
  }
  return node;
}
