// The grid adapter (REC-004): the only module that imports Handsontable (MIRROR-R22,
// enforced by test/grid-boundary.test.ts). It turns a sheet (GridProps) into grid
// configuration and grid events into GridIntents. Replacing the grid means replacing this
// file and grid-theme.css; pages only know ./types.ts.
//
// P1 is read-only (MIRROR-R19): no editor, no fill handle, no context menu, paste and
// every change refused, no rows or columns inserted. Copy works, as plain text. Only the
// plugins listed below are registered; never the formulas plugin (REC-004).
//
// The grid's own data is each cell's plain text (cellText), which is what copy puts on the
// clipboard. The renderers draw the rich value from the sheet model instead, found by
// physical row and column, so the grid's reordering never mixes them up.
//
// View behaviours (MIRROR-R20, MIRROR-R21): the sheet sorts and filters its rows itself
// (sheets/view.ts), since plain text would sort dates and priorities wrongly. ColumnSorting
// is registered for its header affordance only: a header click or Enter on a header
// becomes a sort intent and the plugin's own sort is cancelled; the indicator follows the
// `sort` prop. HiddenColumns draws `hiddenColumnIds` away while keeping each column's
// width and place. Keyboard navigation, the frozen first column, resize and reorder are
// the grid's own.
import { HotTable, type HotTableRef } from "@handsontable/react-wrapper";
import type Handsontable from "handsontable/base";
import { ColumnSorting } from "handsontable/plugins/columnSorting";
import { CopyPaste } from "handsontable/plugins/copyPaste";
import { HiddenColumns } from "handsontable/plugins/hiddenColumns";
import { ManualColumnMove } from "handsontable/plugins/manualColumnMove";
import { ManualColumnResize } from "handsontable/plugins/manualColumnResize";
import { registerPlugin } from "handsontable/plugins/registry";
import { baseRenderer } from "handsontable/renderers/baseRenderer";
import { useCallback, useEffect, useMemo, useRef } from "react";
import "handsontable/styles/handsontable.min.css";
import "handsontable/styles/ht-theme-main.min.css";
import "./grid-theme.css";
import { type CellShape, cellText, type SheetColumn, type SheetRow } from "../model.ts";
import { cellContent } from "./cells.ts";
import type { GridProps } from "./types.ts";

registerPlugin(ColumnSorting);
registerPlugin(CopyPaste);
registerPlugin(HiddenColumns);
registerPlugin(ManualColumnMove);
registerPlugin(ManualColumnResize);

/** Sort from the header, cycling ascending, descending, none; the sheet does the sorting. */
const columnSorting = { headerAction: true, indicator: true, sortEmptyCells: true };

type SortConfig = { column: number; sortOrder: "asc" | "desc" };

/** The vendor's non-commercial key; this site is a non-commercial demonstration (REC-004). */
const licenseKey = "non-commercial-and-evaluation";

const widths: Record<CellShape, number> = {
  text: 240,
  badge: 130,
  user: 150,
  date: 110,
  chips: 200,
  percent: 110,
  excerpt: 300,
  link: 110,
  number: 90,
};

/** Header text goes through innerHTML in the grid; titles come from Linear label groups. */
function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

type Model = { columns: readonly SheetColumn[]; rows: readonly SheetRow[] };

function rendererFor(model: { current: Model }): Handsontable.renderers.BaseRenderer {
  return function render(instance, td, row, col, prop, value, cellProperties) {
    baseRenderer(instance, td, row, col, prop, value, cellProperties);
    const physicalColumn = instance.toPhysicalColumn(col);
    const column = model.current.columns[physicalColumn];
    const sheetRow = model.current.rows[instance.toPhysicalRow(row)];
    if (!column || !sheetRow) {
      td.replaceChildren();
      return;
    }
    const flagged = sheetRow.flags.length > 0;
    td.classList.add("sheet-cell");
    td.classList.toggle("sheet-flagged", flagged);
    td.dataset.column = column.id;
    td.dataset.shape = column.shape;
    td.replaceChildren(
      cellContent(
        td.ownerDocument,
        column.shape,
        sheetRow.cells[column.id] ?? null,
        physicalColumn === 0 ? sheetRow.flags : [],
      ),
    );
  };
}

export default function HandsontableGrid({
  label,
  columns,
  rows,
  sort = null,
  hiddenColumnIds = [],
  onIntent,
}: GridProps) {
  const hot = useRef<HotTableRef>(null);
  const model = useRef<Model>({ columns, rows });
  model.current = { columns, rows };
  const intent = useRef(onIntent);
  intent.current = onIntent;

  const renderer = useMemo(() => rendererFor(model), []);
  const data = useMemo(
    () =>
      rows.map((row) =>
        columns.map((column) => cellText(column.shape, row.cells[column.id] ?? null)),
      ),
    [columns, rows],
  );
  const columnSettings = useMemo(
    () => columns.map(() => ({ renderer, editor: false as const, readOnly: true })),
    [columns, renderer],
  );
  const headers = useMemo(() => columns.map((column) => escapeHtml(column.title)), [columns]);
  const colWidths = useMemo(() => columns.map((column) => widths[column.shape]), [columns]);

  const columnIdAt = useCallback((visual: number) => {
    const instance = hot.current?.hotInstance;
    const physical = instance ? instance.toPhysicalColumn(visual) : visual;
    return model.current.columns[physical]?.id;
  }, []);

  const hiddenKey = hiddenColumnIds.join("\n");
  const hiddenColumns = useMemo(() => {
    const hidden = new Set(hiddenKey ? hiddenKey.split("\n") : []);
    const physical = columns.flatMap((column, index) => (hidden.has(column.id) ? [index] : []));
    return { columns: physical, indicators: false, copyPasteEnabled: false };
  }, [columns, hiddenKey]);

  // The indicator follows the sheet's sort after every update, in visual columns, which a
  // column move changes.
  useEffect(() => {
    const instance = hot.current?.hotInstance;
    if (!instance || instance.isDestroyed) return;
    const physical = sort ? columns.findIndex((column) => column.id === sort.columnId) : -1;
    const config: SortConfig[] =
      sort && physical >= 0
        ? [{ column: instance.toVisualColumn(physical), sortOrder: sort.direction }]
        : [];
    instance.getPlugin("columnSorting").setSortConfig(config);
    instance.render();
  });

  const beforeColumnSort = useCallback(
    (current: SortConfig[], destination: SortConfig[]): boolean => {
      const next = destination[0];
      const previous = current[0];
      const target = next ?? previous;
      const columnId = target ? columnIdAt(target.column) : undefined;
      if (columnId) {
        intent.current?.({ type: "sort", columnId, direction: next ? next.sortOrder : null });
      }
      // The sheet orders the rows; the plugin's own sort would compare plain text.
      return false;
    },
    [columnIdAt],
  );

  return (
    <section className="sheet-grid" aria-label={label}>
      <HotTable
        ref={hot}
        licenseKey={licenseKey}
        themeName="ht-theme-main"
        data={data}
        columns={columnSettings}
        colHeaders={headers}
        headerClassName="htLeft"
        colWidths={colWidths}
        rowHeaders={false}
        width="100%"
        height="100%"
        stretchH="none"
        autoRowSize={false}
        autoColumnSize={false}
        wordWrap={false}
        fixedColumnsStart={1}
        // Read-only, with no editing affordance (MIRROR-R19).
        readOnly
        editor={false}
        enterBeginsEditing={false}
        fillHandle={false}
        contextMenu={false}
        dropdownMenu={false}
        allowInsertRow={false}
        allowInsertColumn={false}
        allowRemoveRow={false}
        allowRemoveColumn={false}
        copyPaste
        beforePaste={() => false}
        beforeChange={() => false}
        beforeCreateRow={() => false}
        beforeCreateCol={() => false}
        beforeRemoveRow={() => false}
        beforeRemoveCol={() => false}
        // View-level changes become intents; P1 persists none of them (MIRROR-R20).
        columnSorting={columnSorting}
        beforeColumnSort={beforeColumnSort}
        hiddenColumns={hiddenColumns}
        manualColumnResize
        manualColumnMove
        afterColumnResize={(width: number, visual: number) => {
          const columnId = columnIdAt(visual);
          if (columnId) intent.current?.({ type: "resize", columnId, width });
        }}
        afterColumnMove={(
          _moved: number[],
          _final: number,
          _drop: number | undefined,
          _possible: boolean,
          orderChanged: boolean,
        ) => {
          const instance = hot.current?.hotInstance;
          if (!orderChanged || !instance) return;
          const columnIds = Array.from(
            { length: instance.countCols() },
            (_, visual) => columnIdAt(visual) ?? "",
          );
          intent.current?.({ type: "reorder", columnIds });
        }}
      />
    </section>
  );
}
