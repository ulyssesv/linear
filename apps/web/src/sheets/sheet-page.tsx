// A sheet page (MIRROR-R18): the toolbar and the grid. Rendered in the browser only; the
// server sends SheetPlaceholder (sheet-frame.tsx) in its place (MIRROR-R23). The grid
// adapter, and the grid library with it, loads as a chunk of its own.
import { lazy, Suspense, useId, useMemo, useState } from "react";
import { type SheetKind, type SheetModel, visibleRows } from "./model.ts";
import { SheetFrame, sheetTitles } from "./sheet-frame.tsx";

const Grid = lazy(() => import("./grid/handsontable-adapter.tsx"));

const nouns: Record<SheetKind, [string, string]> = {
  projects: ["project", "projects"],
  initiatives: ["initiative", "initiatives"],
};

function count(kind: SheetKind, n: number): string {
  const [one, many] = nouns[kind];
  return `${n} ${n === 1 ? one : many}`;
}

export function SheetPage({ model }: { model: SheetModel }) {
  const [showFlagged, setShowFlagged] = useState(false);
  const toggleId = useId();
  const rows = useMemo(() => visibleRows(model.rows, showFlagged), [model.rows, showFlagged]);
  const flagged = model.rows.length - visibleRows(model.rows, false).length;

  return (
    <SheetFrame kind={model.kind}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <p data-testid="sheet-count" className="text-muted-foreground">
          {count(model.kind, rows.length)}
          {!showFlagged && flagged > 0 ? ` (${flagged} archived or removed hidden)` : ""}
        </p>
        <label htmlFor={toggleId} className="flex items-center gap-2">
          <input
            id={toggleId}
            type="checkbox"
            checked={showFlagged}
            onChange={(event) => setShowFlagged(event.target.checked)}
          />
          Show archived and removed
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
        <Suspense fallback={<p className="p-4 text-muted-foreground text-sm">Loading the grid…</p>}>
          <Grid label={sheetTitles[model.kind]} columns={model.columns} rows={rows} />
        </Suspense>
      </div>
    </SheetFrame>
  );
}
