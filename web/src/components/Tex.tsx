import katex from "katex";
import { useMemo } from "react";

/** Typeset a TeX formula with KaTeX (rendered to static HTML, no runtime fetches). */
export function Tex({ children, display = false }: { children: string; display?: boolean }) {
  const html = useMemo(
    () => katex.renderToString(children, { displayMode: display, throwOnError: false, output: "htmlAndMathml" }),
    [children, display],
  );
  return <span className={display ? "eq" : undefined} dangerouslySetInnerHTML={{ __html: html }} />;
}
