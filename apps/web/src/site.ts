// Site name, navigation (CONTENT-R3) and the landing page's content (SEED-R17).

export const site = {
  name: "linear.sesv.co",
  purpose:
    "Proofs of concept and documentation for proposals to Linear. Each proposal is built in " +
    "the open from specs and decision records kept in the repository, with Linear tracking " +
    "the work and mirroring the documents.",
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

export type ProofOfConcept = {
  key: "planning-sheet" | "metrics-rollup" | "ai-sdlc";
  title: string;
  summary: string;
  status: "Planned" | "In progress" | "Live";
  link: { label: string; href: string };
};

export const proofsOfConcept: readonly ProofOfConcept[] = [
  {
    key: "planning-sheet",
    title: "Planning sheet",
    summary: "A spreadsheet-like surface over Linear initiatives and projects.",
    status: "Planned",
    link: {
      label: "Initiative in Linear",
      href: "https://linear.app/sesv/initiative/planning-sheet-7f1a80410512",
    },
  },
  {
    key: "metrics-rollup",
    title: "Metrics rollup",
    summary: "Goals tied to metrics, rolled up from issues to projects to initiatives.",
    status: "Planned",
    link: {
      label: "Initiative in Linear",
      href: "https://linear.app/sesv/initiative/metrics-rollup-8bbaf276122a",
    },
  },
  {
    key: "ai-sdlc",
    title: "AI SDLC",
    summary:
      "Linear alongside specs, decision records and glossaries whose source of truth is a repository.",
    status: "Planned",
    link: {
      label: "Initiative in Linear",
      href: "https://linear.app/sesv/initiative/ai-sdlc-4f642730a3cf",
    },
  },
];
