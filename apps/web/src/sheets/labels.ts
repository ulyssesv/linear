// One badge column per single-select label group (spec MIRROR, section 4). Multi-select
// groups and labels outside a group are not shown in P1.
import type { Label, Mirrored } from "@/server/mirror/types";
import type { CellValue, Chip, SheetColumn } from "./model.ts";

type GroupLabel = Mirrored<Label & { teamId?: string | null }>;

export type LabelGroupColumns = {
  columns: SheetColumn[];
  /** The cell of every group column for an entity's label ids. */
  cells(labelIds: readonly string[]): Record<string, CellValue>;
};

export function labelGroupColumns(
  labels: readonly GroupLabel[],
  teamName: (id: string) => string | undefined,
): LabelGroupColumns {
  const groups = labels
    .filter((l) => l.isGroup && l.selection === "single" && !l.archivedAt && !l.removedAt)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const nameCount = new Map<string, number>();
  for (const group of groups) nameCount.set(group.name, (nameCount.get(group.name) ?? 0) + 1);

  const columns = groups.map((group): SheetColumn => {
    // Team-scoped groups may share a name; the team tells them apart.
    const team = group.teamId ? teamName(group.teamId) : undefined;
    const title =
      (nameCount.get(group.name) ?? 0) > 1 && team ? `${group.name} (${team})` : group.name;
    return { id: `label:${group.id}`, title, shape: "badge" };
  });

  const groupOf = new Map<string, { columnId: string; chip: Chip }>();
  const groupIds = new Set(groups.map((group) => group.id));
  for (const label of labels) {
    if (label.isGroup || !label.parentId || !groupIds.has(label.parentId)) continue;
    groupOf.set(label.id, {
      columnId: `label:${label.parentId}`,
      chip: { label: label.name, color: label.color || null },
    });
  }

  return {
    columns,
    cells(labelIds) {
      const cells: Record<string, CellValue> = {};
      for (const column of columns) cells[column.id] = null;
      for (const id of labelIds) {
        const found = groupOf.get(id);
        // Single-select: the first label of a group wins should Linear ever send two.
        if (found && cells[found.columnId] === null) cells[found.columnId] = found.chip;
      }
      return cells;
    },
  };
}
