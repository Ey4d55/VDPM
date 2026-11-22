/**
 * Colour tokens used by charts. Charts take explicit colours (not CSS
 * variables) so that exported SVG/PNG files render identically outside the app.
 */
export type ThemeName = "dark" | "light";

export interface ChartTheme {
  name: ThemeName;
  background: string;
  panel: string;
  ink: string;
  muted: string;
  faint: string;
  grid: string;
  axis: string;
  feasible: string;
  infeasible: string;
  warning: string;
  demand: string;
  bandFeasible: string;
  bandInfeasible: string;
  bandNeutral: string;
  bandCorner: string;
  /** Score components, drawn in neutral shades so they never clash with setup colours. */
  components: { drag: string; grip: string; margin: string };
}

export const THEMES: Record<ThemeName, ChartTheme> = {
  dark: {
    name: "dark",
    background: "#0a0d13",
    panel: "#11161f",
    ink: "#e8ebf2",
    muted: "#98a1b5",
    faint: "#5d6679",
    grid: "#1e2532",
    axis: "#3a4356",
    feasible: "#34c27a",
    infeasible: "#ff5468",
    warning: "#f2b13a",
    demand: "#e8ebf2",
    bandFeasible: "rgba(52,194,122,0.10)",
    bandInfeasible: "rgba(255,84,104,0.10)",
    bandNeutral: "rgba(152,161,181,0.10)",
    bandCorner: "rgba(152,161,181,0.055)",
    components: { drag: "#d5dae4", grip: "#8a93a7", margin: "#4f586b" },
  },
  light: {
    name: "light",
    background: "#f5f6f8",
    panel: "#ffffff",
    ink: "#141a24",
    muted: "#5b6476",
    faint: "#9aa2b2",
    grid: "#e7eaf0",
    axis: "#b9c0cd",
    feasible: "#1e9e5a",
    infeasible: "#d42a3f",
    warning: "#c98a12",
    demand: "#141a24",
    bandFeasible: "rgba(30,158,90,0.09)",
    bandInfeasible: "rgba(212,42,63,0.08)",
    bandNeutral: "rgba(91,100,118,0.08)",
    bandCorner: "rgba(91,100,118,0.05)",
    components: { drag: "#28303e", grip: "#7b8496", margin: "#c5cbd6" },
  },
};

/** Setup colours: A blue and B red as in the manuscript, then a colour-blind-aware sequence. */
const SETUP_PALETTE: Record<ThemeName, string[]> = {
  dark: ["#4d8dff", "#ff4d5e", "#2dd4bf", "#f5a524", "#a78bfa", "#86efac", "#f472b6", "#cbd5e1"],
  light: ["#1f5fd1", "#d1242f", "#0f9488", "#c27c0e", "#7c3aed", "#15803d", "#be185d", "#475569"],
};

export const setupColour = (theme: ThemeName, index: number): string => {
  const p = SETUP_PALETTE[theme];
  return p[index % p.length]!;
};
