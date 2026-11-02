// Site name, navigation (CONTENT-R3) and the initiatives the landing page presents
// (CONTENT-R11).

export const site = {
  name: "linear.sesv.co",
  repository: "https://github.com/ulyssesv/linear",
} as const;

/** The header navigation (CONTENT-R3): the three initiative pages, this site, about. */
export const navigation = [
  { href: "/planning-sheet", label: "Planning sheet" },
  { href: "/metrics-rollup", label: "Metrics rollup" },
  { href: "/ai-sdlc", label: "AI SDLC" },
  { href: "/this-site", label: "This site" },
  { href: "/about", label: "About" },
] as const;

/**
 * The three initiatives: their page and their Linear initiative. Title, summary and status
 * live in each page's content file (CONTENT-R11, CONTENT-R12).
 */
export type InitiativeKey = "planning-sheet" | "metrics-rollup" | "ai-sdlc";

export const initiativePages: readonly { key: InitiativeKey; href: string; linear: string }[] = [
  {
    key: "planning-sheet",
    href: "/planning-sheet",
    linear: "https://linear.app/sesv/initiative/planning-sheet-7f1a80410512",
  },
  {
    key: "metrics-rollup",
    href: "/metrics-rollup",
    linear: "https://linear.app/sesv/initiative/metrics-rollup-8bbaf276122a",
  },
  {
    key: "ai-sdlc",
    href: "/ai-sdlc",
    linear: "https://linear.app/sesv/initiative/ai-sdlc-4f642730a3cf",
  },
];
