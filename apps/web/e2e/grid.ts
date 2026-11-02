// Locators for a sheet's grid in end-to-end tests. The grid draws only what is in view, and
// draws the frozen first column twice: once in the master table, once in a clone laid over
// it (`.ht_clone_inline_start`), which is the one a click on that column reaches.
import { expect, type Locator, type Page } from "@playwright/test";

/** The grid of a sheet, once it has drawn its rows. */
export async function grid(page: Page, label: string): Promise<Locator> {
  const region = page.getByRole("region", { name: label });
  await expect(region.locator(".ht_master tbody td").first()).toBeVisible();
  return region;
}

/** The master table's row for an entity name. */
export function row(region: Locator, name: string): Locator {
  return region.locator(".ht_master tbody tr").filter({
    has: region.page().locator('td[data-column="name"]', { hasText: name }),
  });
}

export function cell(rowLocator: Locator, column: string): Locator {
  return rowLocator.locator(`td[data-column="${column}"]`);
}

/** The column titles, in visual order. */
export async function headers(region: Locator): Promise<string[]> {
  const texts = await region.locator(".ht_clone_top thead th .colHeader").allTextContents();
  return texts.map((text) => text.trim());
}

/** The header cell of a column, by title, in the copy of the header row that takes clicks. */
export function header(region: Locator, title: string): Locator {
  return region
    .locator(".ht_clone_top thead th")
    .filter({ has: region.page().locator(".colHeader", { hasText: title }) });
}

/** The names of the rows drawn, top to bottom. */
export async function names(region: Locator): Promise<string[]> {
  const texts = await region
    .locator('.ht_master tbody td[data-column="name"] .sheet-text')
    .allTextContents();
  return texts.map((text) => text.trim());
}
