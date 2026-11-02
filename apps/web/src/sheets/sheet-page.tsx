// A sheet page (MIRROR-R18, MIRROR-R23): the toolbar and the grid. Rendered in the browser
// only; the server sends SheetPlaceholder in its place, which says so when JavaScript is
// off. The grid adapter, and the grid library with it, loads as a chunk of its own.
import { Link } from "@tanstack/react-router";
import { lazy, Suspense, useId, useMemo, useState } from "react";
import { type SheetKind, type SheetModel, visibleRows } from "./model.ts";

const Grid = lazy(() => import("./grid/handsontable-adapter.tsx"));

const titles: Record<SheetKind, string> = { projects: "Projects", initiatives: "Initiatives" };
const nouns: Record<SheetKind, [string, string]> = {
  projects: ["project", "projects"],
  initiatives: ["initiative", "initiatives"],
};

function count(kind: SheetKind, n: number): string {
  const [one, many] = nouns[kind];
  return `${n} ${n === 1 ? one : many}`;
}

function SheetNav({ kind }: { kind: SheetKind }) {
  return (
    <nav aria-label="Sheets" className="flex gap-4 text-sm">
      <Link to="/sheets" className="underline underline-offset-4 hover:text-muted-foreground">
        All sheets
      </Link>
      {(Object.keys(titles) as SheetKind[])
        .filter((other) => other !== kind)
        .map((other) => (
          <Link
            key={other}
            to={`/sheets/${other}`}
            className="underline underline-offset-4 hover:text-muted-foreground"
          >
            {titles[other]}
          </Link>
        ))}
    </nav>
  );
}

function Frame({ kind, children }: { kind: SheetKind; children: React.ReactNode }) {
  return (
    <div className="flex h-[calc(100dvh-2.5rem)] min-h-[24rem] flex-col gap-4 px-6 pt-4 pb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-semibold text-2xl tracking-tight">{titles[kind]}</h1>
        <SheetNav kind={kind} />
      </div>
      {children}
    </div>
  );
}

/** What the server renders for a sheet route, and what shows while it loads. */
export function SheetPlaceholder({ kind }: { kind: SheetKind }) {
  return (
    <Frame kind={kind}>
      <div data-testid="sheet-placeholder" className="space-y-2 text-muted-foreground text-sm">
        <noscript>
          <p data-testid="sheet-noscript" className="font-medium text-foreground">
            This sheet runs in the browser and needs JavaScript. Turn JavaScript on and reload the
            page to see it.
          </p>
        </noscript>
        <p>Loading the sheet…</p>
      </div>
    </Frame>
  );
}

export function SheetPage({ model }: { model: SheetModel }) {
  const [showFlagged, setShowFlagged] = useState(false);
  const toggleId = useId();
  const rows = useMemo(() => visibleRows(model.rows, showFlagged), [model.rows, showFlagged]);
  const flagged = model.rows.length - visibleRows(model.rows, false).length;

  return (
    <Frame kind={model.kind}>
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
          <Grid label={titles[model.kind]} columns={model.columns} rows={rows} />
        </Suspense>
      </div>
    </Frame>
  );
}
