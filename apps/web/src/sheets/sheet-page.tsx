// A sheet page (MIRROR-R18, MIRROR-R20, MIRROR-R24): the toolbar, the freshness indicator
// and the grid. Rendered in the browser only; the server sends SheetPlaceholder
// (sheet-frame.tsx) in its place (MIRROR-R23). The grid adapter, and the grid library with
// it, loads as a chunk of its own.
//
// View state (archived toggle, sort, filters, hidden columns) lives in React state here
// and nowhere else: a reload forgets it, and changing it sends nothing (MIRROR-R20).
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import type { SheetView } from "./freshness.ts";
import { FreshnessIndicator } from "./freshness-indicator.tsx";
import { loadGrid } from "./grid/load.ts";
import type { GridIntent } from "./grid/types.ts";
import { type SheetColumn, type SheetKind, visibleRows } from "./model.ts";
import { SheetFrame, sheetTitles } from "./sheet-frame.tsx";
import { ArchivedToggle, ColumnsMenu, FilterMenu } from "./sheet-toolbar.tsx";
import { useSheetFreshness } from "./use-sheet-freshness.ts";
import {
  filterOptions,
  filterRows,
  initialViewState,
  type SheetViewState,
  sortRows,
  statusColumn,
  teamColumn,
  toggleHidden,
} from "./view.ts";

const Grid = lazy(loadGrid);

const nouns: Record<SheetKind, [string, string]> = {
  projects: ["project", "projects"],
  initiatives: ["initiative", "initiatives"],
};

function count(kind: SheetKind, n: number): string {
  const [one, many] = nouns[kind];
  return `${n} ${n === 1 ? one : many}`;
}

const teamTitles: Record<SheetKind, string> = { projects: "Team", initiatives: "Lead team" };

/**
 * The same array while the columns are the same, so a full refresh that changes no column
 * leaves the grid's column state (widths, order) alone.
 */
function useStableColumns(columns: SheetColumn[]): SheetColumn[] {
  const previous = useRef(columns);
  if (JSON.stringify(previous.current) !== JSON.stringify(columns)) previous.current = columns;
  return previous.current;
}

export function SheetPage({ view: initial }: { view: SheetView }) {
  const { model, freshness, state } = useSheetFreshness(initial);
  const { kind } = model;
  const columns = useStableColumns(model.columns);
  const [showFlagged, setShowFlagged] = useState(false);
  const [view, setView] = useState<SheetViewState>(initialViewState);

  const shown = useMemo(() => visibleRows(model.rows, showFlagged), [model.rows, showFlagged]);
  const rows = useMemo(
    () => sortRows(filterRows(shown, kind, view), columns, view.sort),
    [shown, kind, view, columns],
  );
  const flagged = model.rows.length - visibleRows(model.rows, false).length;
  const filtered = view.teams.length > 0 || view.statuses.length > 0;
  const teams = useMemo(() => filterOptions(shown, teamColumn[kind], "No team"), [shown, kind]);
  const statuses = useMemo(() => filterOptions(shown, statusColumn, "No status"), [shown]);

  const onIntent = useCallback((intent: GridIntent) => {
    if (intent.type === "sort") {
      const { columnId, direction } = intent;
      setView((current) => ({ ...current, sort: direction ? { columnId, direction } : null }));
    }
    // Resize and reorder stay in the grid for this page's life; P1 keeps neither.
  }, []);

  return (
    <SheetFrame kind={kind}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <p data-testid="sheet-count" className="text-muted-foreground">
          {filtered ? `${rows.length} of ` : ""}
          {count(kind, filtered ? shown.length : rows.length)}
          {!showFlagged && flagged > 0 ? ` (${flagged} archived or removed hidden)` : ""}
        </p>
        <FilterMenu
          title={teamTitles[kind]}
          testId="filter-teams"
          options={teams}
          selected={view.teams}
          onChange={(selected) => setView((current) => ({ ...current, teams: selected }))}
        />
        <FilterMenu
          title="Status"
          testId="filter-statuses"
          options={statuses}
          selected={view.statuses}
          onChange={(selected) => setView((current) => ({ ...current, statuses: selected }))}
        />
        <ColumnsMenu
          columns={columns}
          hidden={view.hidden}
          onToggle={(columnId, hide) =>
            setView((current) => ({
              ...current,
              hidden: toggleHidden(current.hidden, columnId, hide),
            }))
          }
        />
        <ArchivedToggle checked={showFlagged} onChange={setShowFlagged} />
        <FreshnessIndicator kind={kind} freshness={freshness} state={state} />
      </div>
      {/* isolate: the grid's layers stack among themselves, under the toolbar's menus. */}
      <div className="isolate min-h-0 flex-1 overflow-hidden rounded-md border">
        <Suspense fallback={<p className="p-4 text-muted-foreground text-sm">Loading the grid…</p>}>
          <Grid
            label={sheetTitles[kind]}
            columns={columns}
            rows={rows}
            sort={view.sort}
            hiddenColumnIds={view.hidden}
            onIntent={onIntent}
          />
        </Suspense>
      </div>
    </SheetFrame>
  );
}
