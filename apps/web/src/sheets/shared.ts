// Helpers shared by the sheet builders.
import type { LatestUpdate, Mirrored, Tracked } from "@/server/mirror/types";
import type { Chip, ExcerptValue, RowFlag } from "./model.ts";

export function byId<T extends { id: string }>(records: readonly T[]): Map<string, T> {
  return new Map(records.map((record) => [record.id, record]));
}

/** Archived and removed are both shown when present (MIRROR-R18). */
export function flagsOf(entity: Mirrored<Tracked>): RowFlag[] {
  const flags: RowFlag[] = [];
  if (entity.archivedAt) flags.push("archived");
  if (entity.removedAt) flags.push("removed");
  return flags;
}

/**
 * Chips for linked entities, in the entity's order. Ids the mirror does not hold (private
 * teams, never mirrored) and entities flagged removed are left out.
 */
export function chips(
  ids: readonly string[],
  entities: ReadonlyMap<string, Mirrored<{ name: string }>>,
): Chip[] {
  const out: Chip[] = [];
  for (const id of ids) {
    const entity = entities.get(id);
    if (entity && !entity.removedAt) out.push({ label: entity.name, color: null });
  }
  return out;
}

export function latestUpdate(update: LatestUpdate | null): ExcerptValue | null {
  return update ? { text: update.excerpt, date: update.createdAt } : null;
}
