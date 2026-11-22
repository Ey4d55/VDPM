/**
 * A small, dependency-light chart kit built on d3-scale and d3-shape.
 * Charts draw with explicit theme colours so that SVG and PNG exports match
 * the screen exactly; every chart card offers both exports.
 */
import { scaleLinear } from "d3-scale";
import { area as d3area, line as d3line } from "d3-shape";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { fmt } from "../format";
import type { ChartTheme } from "../theme";
import { Card } from "./Card";
import { IconDownload, IconImage } from "./Icons";
import { rich, richSvg } from "./Sym";

// --------------------------------------------------------------------------- //
// Sizing and export
// --------------------------------------------------------------------------- //

export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || 600);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth((prev) => (Math.abs(w - prev) > 0.5 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function serialise(svg: SVGSVGElement, theme: ChartTheme): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const { width, height } = svg.getBoundingClientRect();
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(Math.round(width)));
  clone.setAttribute("height", String(Math.round(height)));
  clone.setAttribute("viewBox", `0 0 ${Math.round(width)} ${Math.round(height)}`);
  clone.setAttribute("font-family", "Inter, 'Helvetica Neue', Arial, sans-serif");
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", theme.panel);
  clone.insertBefore(bg, clone.firstChild);
  clone.querySelectorAll("[data-export-hide]").forEach((n) => n.remove());
  return new XMLSerializer().serializeToString(clone);
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportSvg(svg: SVGSVGElement, theme: ChartTheme, name: string) {
  download(new Blob([serialise(svg, theme)], { type: "image/svg+xml" }), `${name}.svg`);
}

export function exportPng(svg: SVGSVGElement, theme: ChartTheme, name: string, scale = 3) {
  const text = serialise(svg, theme);
  const { width, height } = svg.getBoundingClientRect();
  const img = new Image();
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);
    canvas.toBlob((b) => b && download(b, `${name}.png`), "image/png");
  };
  img.src = url;
}

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Card with SVG/PNG export of the chart(s) inside. */
export function ChartCard(props: {
  title: string;
  subtitle?: ReactNode;
  theme: ChartTheme;
  children: (svgRef: RefObject<SVGSVGElement | null>) => ReactNode;
  footer?: ReactNode;
  className?: string;
  extraActions?: ReactNode;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const name = `vdpm-${slug(props.title)}`;
  return (
    <Card
      className={props.className}
      title={props.title}
      subtitle={props.subtitle}
      footer={props.footer}
      actions={
        <>
          {props.extraActions}
          <button className="btn btn-ghost btn-icon" title="Download SVG" aria-label={`Download ${props.title} as SVG`} onClick={() => svgRef.current && exportSvg(svgRef.current, props.theme, name)}>
            <IconDownload />
          </button>
          <button className="btn btn-ghost btn-icon" title="Download PNG (3x)" aria-label={`Download ${props.title} as PNG`} onClick={() => svgRef.current && exportPng(svgRef.current, props.theme, name)}>
            <IconImage />
          </button>
        </>
      }
    >
      {props.children(svgRef)}
    </Card>
  );
}

// --------------------------------------------------------------------------- //
// Axes
// --------------------------------------------------------------------------- //

type Linear = ReturnType<typeof scaleLinear<number, number>>;

export function AxisBottom(p: { scale: Linear; y: number; theme: ChartTheme; label?: string; format?: (v: number) => string; ticks?: number; gridTop?: number }) {
  const ticks = p.scale.ticks(p.ticks ?? 6);
  const [x0, x1] = p.scale.range() as [number, number];
  return (
    <g>
      {p.gridTop !== undefined &&
        ticks.map((t) => <line key={`g${t}`} x1={p.scale(t)} x2={p.scale(t)} y1={p.gridTop} y2={p.y} stroke={p.theme.grid} strokeWidth={1} />)}
      <line x1={x0} x2={x1} y1={p.y} y2={p.y} stroke={p.theme.axis} />
      {ticks.map((t) => (
        <g key={t} transform={`translate(${p.scale(t)},${p.y})`}>
          <line y2={4} stroke={p.theme.axis} />
          <text y={17} textAnchor="middle" fontSize={11} fill={p.theme.muted} style={{ fontVariantNumeric: "tabular-nums" }}>
            {p.format ? p.format(t) : fmt(t, Number.isInteger(t) ? 0 : 1)}
          </text>
        </g>
      ))}
      {p.label && (
        <text x={(x0 + x1) / 2} y={p.y + 34} textAnchor="middle" fontSize={11.5} fill={p.theme.muted}>
          {richSvg(p.label)}
        </text>
      )}
    </g>
  );
}

export function AxisLeft(p: { scale: Linear; x: number; theme: ChartTheme; label?: string; format?: (v: number) => string; ticks?: number; gridRight?: number }) {
  const ticks = p.scale.ticks(p.ticks ?? 5);
  const [y0, y1] = p.scale.range() as [number, number];
  return (
    <g>
      {p.gridRight !== undefined &&
        ticks.map((t) => <line key={`g${t}`} x1={p.x} x2={p.gridRight} y1={p.scale(t)} y2={p.scale(t)} stroke={p.theme.grid} strokeWidth={1} />)}
      {ticks.map((t) => (
        <text key={t} x={p.x - 8} y={p.scale(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={p.theme.muted} style={{ fontVariantNumeric: "tabular-nums" }}>
          {p.format ? p.format(t) : fmt(t, Number.isInteger(t) ? 0 : 1)}
        </text>
      ))}
      {p.label && (
        <text transform={`translate(${p.x - 44},${(y0 + y1) / 2}) rotate(-90)`} textAnchor="middle" fontSize={11.5} fill={p.theme.muted}>
          {richSvg(p.label)}
        </text>
      )}
    </g>
  );
}

// --------------------------------------------------------------------------- //
// XY line chart
// --------------------------------------------------------------------------- //

export interface Series {
  id: string;
  label: string;
  colour: string;
  points: [number, number][];
  dashed?: boolean;
  width?: number;
  /** Label drawn at the last finite point. */
  endLabel?: string;
}
export interface AreaSeries {
  id: string;
  colour: string;
  points: [number, number, number][];
}
export interface RefLine {
  axis: "x" | "y";
  value: number;
  colour: string;
  label?: string;
  dashed?: boolean;
  labelPosition?: "start" | "end";
}
export interface Band {
  axis: "x" | "y";
  from: number;
  to: number;
  fill: string;
}
export interface Marker {
  x: number;
  y: number;
  colour: string;
  label?: string;
  shape?: "circle" | "diamond";
}

export function XYChart(props: {
  theme: ChartTheme;
  svgRef?: RefObject<SVGSVGElement | null>;
  height?: number;
  xDomain: [number, number];
  yDomain: [number, number];
  xLabel?: string;
  yLabel?: string;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  tooltipX?: (v: number) => string;
  tooltipY?: (v: number) => string;
  series: Series[];
  areas?: AreaSeries[];
  refLines?: RefLine[];
  bands?: Band[];
  markers?: Marker[];
  ariaLabel: string;
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const height = props.height ?? 280;
  const m = { top: 14, right: 18, bottom: 46, left: 60 };
  const x = scaleLinear().domain(props.xDomain).range([m.left, width - m.right]);
  const y = scaleLinear().domain(props.yDomain).range([height - m.bottom, m.top]).nice();
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useRef(`clip-${Math.random().toString(36).slice(2)}`).current;
  const t = props.theme;

  const line = d3line<[number, number]>()
    .defined((d) => Number.isFinite(d[1]))
    .x((d) => x(d[0]))
    .y((d) => y(d[1]));
  const area = d3area<[number, number, number]>()
    .defined((d) => Number.isFinite(d[1]) && Number.isFinite(d[2]))
    .x((d) => x(d[0]))
    .y0((d) => y(d[1]))
    .y1((d) => y(d[2]));

  const onMove = useCallback(
    (e: React.MouseEvent<SVGRectElement>) => {
      const box = (e.currentTarget as SVGRectElement).getBoundingClientRect();
      const px = e.clientX - box.left + m.left;
      setHover(x.invert(px));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, props.xDomain[0], props.xDomain[1]],
  );

  const nearest = (pts: [number, number][], xv: number): [number, number] | null => {
    let bestP: [number, number] | null = null;
    let bestD = Infinity;
    for (const p of pts) {
      const d = Math.abs(p[0] - xv);
      if (d < bestD) {
        bestD = d;
        bestP = p;
      }
    }
    return bestP;
  };

  const hx = hover === null ? null : Math.min(Math.max(hover, props.xDomain[0]), props.xDomain[1]);
  const tooltipLeft = hx === null ? 0 : x(hx);

  return (
    <div className="chart" ref={wrapRef}>
      <svg ref={props.svgRef} width={width} height={height} role="img" aria-label={props.ariaLabel}>
        <defs>
          <clipPath id={clipId}>
            <rect x={m.left} y={m.top} width={Math.max(0, width - m.left - m.right)} height={Math.max(0, height - m.top - m.bottom)} />
          </clipPath>
        </defs>
        <AxisLeft scale={y} x={m.left} theme={t} label={props.yLabel} format={props.yFormat} gridRight={width - m.right} />
        <AxisBottom scale={x} y={height - m.bottom} theme={t} label={props.xLabel} format={props.xFormat} gridTop={m.top} />
        <g clipPath={`url(#${clipId})`}>
          {props.bands?.map((b, i) =>
            b.axis === "x" ? (
              <rect key={i} x={x(b.from)} width={Math.max(0, x(b.to) - x(b.from))} y={m.top} height={height - m.top - m.bottom} fill={b.fill} />
            ) : (
              <rect key={i} x={m.left} width={width - m.left - m.right} y={y(b.to)} height={Math.max(0, y(b.from) - y(b.to))} fill={b.fill} />
            ),
          )}
          {props.areas?.map((a) => <path key={a.id} d={area(a.points) ?? ""} fill={a.colour} />)}
          {props.refLines?.map((r, i) =>
            r.axis === "x" ? (
              <line key={i} x1={x(r.value)} x2={x(r.value)} y1={m.top} y2={height - m.bottom} stroke={r.colour} strokeDasharray={r.dashed ? "4 4" : undefined} strokeWidth={1.2} />
            ) : (
              <line key={i} x1={m.left} x2={width - m.right} y1={y(r.value)} y2={y(r.value)} stroke={r.colour} strokeDasharray={r.dashed ? "4 4" : undefined} strokeWidth={1.2} />
            ),
          )}
          {props.series.map((s) => (
            <path key={s.id} d={line(s.points) ?? ""} fill="none" stroke={s.colour} strokeWidth={s.width ?? 2.2} strokeDasharray={s.dashed ? "6 5" : undefined} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {props.markers?.map((mk, i) =>
            mk.shape === "diamond" ? (
              <path key={i} d={`M${x(mk.x)},${y(mk.y) - 6}l6,6l-6,6l-6,-6z`} fill={mk.colour} stroke={t.panel} strokeWidth={1.5} />
            ) : (
              <circle key={i} cx={x(mk.x)} cy={y(mk.y)} r={4.5} fill={mk.colour} stroke={t.panel} strokeWidth={1.5} />
            ),
          )}
        </g>
        {props.refLines?.map((r, i) =>
          r.label ? (
            r.axis === "x" ? (
              <text key={`l${i}`} x={x(r.value) + 5} y={m.top + 12} fontSize={11} fill={r.colour}>
                {r.label}
              </text>
            ) : (
              <text key={`l${i}`} x={r.labelPosition === "start" ? m.left + 6 : width - m.right - 4} y={y(r.value) - 5} textAnchor={r.labelPosition === "start" ? "start" : "end"} fontSize={11} fill={r.colour}>
                {r.label}
              </text>
            )
          ) : null,
        )}
        {props.series.map((s) => {
          if (!s.endLabel) return null;
          const last = [...s.points].reverse().find((p) => Number.isFinite(p[1]));
          return last ? (
            <text key={`el${s.id}`} x={x(last[0]) - 4} y={y(last[1]) + 12} textAnchor="end" fontSize={10.5} fill={s.colour}>
              {s.endLabel}
            </text>
          ) : null;
        })}
        {props.markers?.map((mk, i) =>
          mk.label ? (
            <text key={`ml${i}`} x={x(mk.x) + 8} y={y(mk.y) - 8} fontSize={11} fill={mk.colour} fontWeight={600}>
              {mk.label}
            </text>
          ) : null,
        )}
        {hx !== null && (
          <line data-export-hide x1={x(hx)} x2={x(hx)} y1={m.top} y2={height - m.bottom} stroke={t.faint} strokeDasharray="2 3" />
        )}
        <rect
          data-export-hide
          x={m.left}
          y={m.top}
          width={Math.max(0, width - m.left - m.right)}
          height={Math.max(0, height - m.top - m.bottom)}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hx !== null && (
        <div className="chart-tooltip" style={{ left: Math.min(tooltipLeft + 12, width - 190), top: m.top + 4 }}>
          <div className="tt-head">{props.tooltipX ? props.tooltipX(hx) : fmt(hx, 2)}</div>
          {props.series.map((s) => {
            const p = nearest(s.points, hx);
            return (
              <div className="tt-row" key={s.id}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span className="swatch" style={{ background: s.colour }} />
                  {rich(s.label)}
                </span>
                <span>{p ? (props.tooltipY ? props.tooltipY(p[1]) : fmt(p[1], 2)) : "–"}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Evenly spaced samples of [a, b]. */
export const linspace = (a: number, b: number, n: number): number[] => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

/** Pad a numeric extent for display. */
export function extent(values: number[], pad = 0.06, includeZero = false): [number, number] {
  const finite = values.filter(Number.isFinite);
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) return [lo - 1, hi + 1];
  const d = (hi - lo) * pad;
  return [lo - d, hi + d];
}

export function useDebounced<T>(value: T, ms = 120): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

// --------------------------------------------------------------------------- //
// Horizontal bars (stacked, diverging, with optional whiskers)
// --------------------------------------------------------------------------- //

export interface BarSegment {
  from: number;
  to: number;
  colour: string;
  label?: string;
}
export interface BarRow {
  id: string;
  label: string;
  swatch?: string;
  segments: BarSegment[];
  whisker?: [number, number];
  valueLabel?: string;
  muted?: boolean;
}

/**
 * Horizontal bar chart. Each row holds explicit [from, to] segments, which
 * covers stacked compositions, diverging tornado bars and simple shares.
 */
export function HBarChart(props: {
  theme: ChartTheme;
  svgRef?: RefObject<SVGSVGElement | null>;
  rows: BarRow[];
  domain: [number, number];
  xLabel?: string;
  xFormat?: (v: number) => string;
  refLines?: { value: number; colour: string; label?: string; dashed?: boolean }[];
  rowHeight?: number;
  labelWidth?: number;
  valueWidth?: number;
  ariaLabel: string;
  ticks?: number;
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const t = props.theme;
  const rowH = props.rowHeight ?? 34;
  const labelW = props.labelWidth ?? 132;
  const valueW = props.valueWidth ?? 64;
  const m = { top: props.refLines?.some((r) => r.label) ? 22 : 8, right: valueW + 8, bottom: props.xLabel ? 46 : 30, left: labelW };
  const height = m.top + m.bottom + rowH * props.rows.length;
  const x = scaleLinear().domain(props.domain).range([m.left, Math.max(m.left + 10, width - m.right)]);
  const barH = Math.min(18, rowH * 0.56);
  return (
    <div className="chart" ref={wrapRef}>
      <svg ref={props.svgRef} width={width} height={height} role="img" aria-label={props.ariaLabel}>
        <AxisBottom scale={x} y={height - m.bottom} theme={t} label={props.xLabel} format={props.xFormat} gridTop={m.top} ticks={props.ticks ?? 5} />
        {props.rows.map((row, i) => {
          const cy = m.top + rowH * i + rowH / 2;
          return (
            <g key={row.id} opacity={row.muted ? 0.55 : 1}>
              {row.swatch && <rect x={8} y={cy - 5} width={10} height={10} rx={3} fill={row.swatch} />}
              <text x={row.swatch ? 26 : 8} y={cy} dy="0.32em" fontSize={12} fill={t.ink}>
                {richSvg(row.label)}
              </text>
              {row.segments.map((sg, j) => {
                const x0 = x(Math.min(sg.from, sg.to));
                const w = Math.abs(x(sg.to) - x(sg.from));
                return (
                  <rect key={j} x={x0} y={cy - barH / 2} width={Math.max(0, w)} height={barH} fill={sg.colour} rx={2}>
                    {sg.label && <title>{sg.label}</title>}
                  </rect>
                );
              })}
              {row.whisker && (
                <g stroke={t.ink} strokeWidth={1.3}>
                  <line x1={x(row.whisker[0])} x2={x(row.whisker[1])} y1={cy} y2={cy} />
                  <line x1={x(row.whisker[0])} x2={x(row.whisker[0])} y1={cy - 5} y2={cy + 5} />
                  <line x1={x(row.whisker[1])} x2={x(row.whisker[1])} y1={cy - 5} y2={cy + 5} />
                </g>
              )}
              {row.valueLabel && (
                <text x={width - 6} y={cy} dy="0.32em" textAnchor="end" fontSize={11.5} fill={t.muted} style={{ fontVariantNumeric: "tabular-nums" }}>
                  {row.valueLabel}
                </text>
              )}
            </g>
          );
        })}
        {props.refLines?.map((r, i) => (
          <g key={i}>
            <line x1={x(r.value)} x2={x(r.value)} y1={m.top - 2} y2={height - m.bottom} stroke={r.colour} strokeWidth={1.2} strokeDasharray={r.dashed ? "4 4" : undefined} />
            {r.label && (
              <text x={x(r.value) + 4} y={m.top - 8} fontSize={10.5} fill={r.colour}>
                {r.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
