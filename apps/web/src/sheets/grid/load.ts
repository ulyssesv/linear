// Loading the grid adapter, and the grid library with it, as a chunk of its own. Kept out
// of sheet-page.tsx so the sheet routes' loaders can start the download beside the sheet's
// data (MIRROR-R25) without pulling the page into the site's main bundle.

export const loadGrid = () => import("./handsontable-adapter.tsx");

/** Starts loading the grid's chunk; a failure surfaces when the page renders the grid. */
export function preloadGrid(): void {
  loadGrid().catch(() => {});
}
