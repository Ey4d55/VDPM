/** Minimal stroke icons (24 x 24 grid, 1.75 stroke), drawn for this app. */
import type { SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...props,
});

export const IconDecision = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 19h16" /><path d="M7 15V9" /><path d="M12 15V5" /><path d="M17 15v-3" /></svg>
);
export const IconCircuit = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 16c-1.5-2.5-.5-6 2-7.5S12 8 13 6s4-2.5 5.5-.5 1 4.5-1 6-1 3.5.5 4.5-.5 4-3 3.5-5-1-7-.5S6 18 5 16Z" /><circle cx="6.2" cy="15.6" r="1" fill="currentColor" /></svg>
);
export const IconSetups = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 14c5-1 10-4 18-9" /><path d="M3 18c6-1 11-3 18-5" /><circle cx="9" cy="12" r="1.2" fill="currentColor" /><circle cx="15" cy="14.3" r="1.2" fill="currentColor" /></svg>
);
export const IconSafety = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
);
export const IconWhatIf = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 7h10" /><path d="M18 7h2" /><circle cx="16" cy="7" r="2" /><path d="M4 17h4" /><path d="M12 17h8" /><circle cx="10" cy="17" r="2" /></svg>
);
export const IconResearch = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 3h6" /><path d="M10 3v6L4.5 18.5A1.6 1.6 0 0 0 6 21h12a1.6 1.6 0 0 0 1.5-2.5L14 9V3" /><path d="M7.5 15h9" /></svg>
);
export const IconMethod = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 4h11l3 3v13H5z" /><path d="M8 10h8" /><path d="M8 14h8" /><path d="M8 18h5" /></svg>
);
export const IconSun = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
export const IconMoon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" /></svg>
);
export const IconReset = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 12a8 8 0 1 0 2.3-5.6" /><path d="M4 4v4h4" /></svg>
);
export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></svg>
);
export const IconUpload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 20V9" /><path d="m7 14 5-5 5 5" /><path d="M5 4h14" /></svg>
);
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconX = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m5 12 4.5 4.5L19 7" /></svg>
);
export const IconAlert = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4" /><circle cx="12" cy="17" r="0.6" fill="currentColor" /></svg>
);
export const IconInfo = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><circle cx="12" cy="7.6" r="0.6" fill="currentColor" /></svg>
);
export const IconTrophy = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" /><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4" /><path d="M12 13v4M8 20h8M9.5 17h5" /></svg>
);
export const IconInfinity = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M7.5 15.5c-2 0-3.5-1.6-3.5-3.5S5.5 8.5 7.5 8.5c3.5 0 5.5 7 9 7 2 0 3.5-1.6 3.5-3.5s-1.5-3.5-3.5-3.5c-3.5 0-5.5 7-9 7Z" /></svg>
);
export const IconImage = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" /></svg>
);

/** Brand mark: a corner apex inside a rounded square, with the two setup colours. */
export const BrandMark = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 32 32" aria-hidden className="brand-mark" {...p}>
    <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--panel)" stroke="var(--line-strong)" />
    <path d="M7 24c3-10 8-15 18-16" fill="none" stroke="#4d8dff" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M7 24c5-6 10-8.5 18-9" fill="none" stroke="#ff4d5e" strokeWidth="2.4" strokeLinecap="round" />
    <circle cx="7" cy="24" r="2" fill="var(--ink)" />
  </svg>
);
