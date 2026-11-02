// The projects and initiatives sheets (MIRROR-R18, MIRROR-R19, MIRROR-R23). `local` project
// only: each test writes its own mirror rows through e2e/mirror.ts and signs in through
// e2e/auth.ts; nothing here reaches Linear.
import type { Locator, Page } from "@playwright/test";
import { initiativePages, site } from "../src/site.ts";
import { type E2EMirror, expect, test } from "./mirror.ts";

// Wide enough that every column renders: the grid only draws what is in view.
test.use({ viewport: { width: 3200, height: 900 } });

/** The grid of a sheet, once it has drawn its rows. */
async function grid(page: Page, label: string): Promise<Locator> {
  const region = page.getByRole("region", { name: label });
  await expect(region.locator(".ht_master tbody td").first()).toBeVisible();
  return region;
}

/** The master table's row for an entity name. */
function row(region: Locator, name: string): Locator {
  return region.locator(".ht_master tbody tr").filter({
    has: region.page().locator('td[data-column="name"]', { hasText: name }),
  });
}

function cell(rowLocator: Locator, column: string): Locator {
  return rowLocator.locator(`td[data-column="${column}"]`);
}

async function headers(region: Locator): Promise<string[]> {
  const texts = await region.locator(".ht_clone_top thead th .colHeader").allTextContents();
  return texts.map((text) => text.trim());
}

/** A small workspace: one team, one lead, a status, a single- and a multi-select group. */
function projectsFixture(mirror: E2EMirror) {
  const team = mirror.team("alpha");
  const otherTeam = mirror.team("beta");
  const lead = mirror.user("lead", { name: mirror.name("Grace Hopper") });
  const status = mirror.projectStatus("started", { name: mirror.name("In Progress") });
  const size = mirror.projectLabel("size", { isGroup: true, selection: "single" });
  const large = mirror.projectLabel("size-l", { name: "L", parentId: size.id, color: "#4cb782" });
  const theme = mirror.projectLabel("theme", { isGroup: true, selection: "multi" });
  const growth = mirror.projectLabel("theme-growth", { parentId: theme.id });
  const initiative = mirror.initiative("bet");
  const live = mirror.project("live", {
    identifier: null,
    statusId: status.id,
    leadId: lead.id,
    startDate: "2026-10-01",
    targetDate: "2026-12-31",
    priority: 2,
    health: "atRisk",
    progress: 0.256,
    teamIds: [team.id, otherTeam.id],
    initiativeIds: [initiative.id],
    labelIds: [large.id, growth.id],
    lastUpdate: {
      id: mirror.id("update"),
      excerpt: "Shipped the first milestone.",
      health: "atRisk",
      createdAt: "2026-10-20T09:30:00.000Z",
    },
  });
  const archived = mirror.project("archived", { archivedAt: "2026-10-15T00:00:00.000Z" });
  const removed = mirror.project("removed");
  return {
    records: {
      teams: [team, otherTeam],
      users: [lead],
      projectStatuses: [status],
      projectLabels: [size, large, theme, growth],
      initiatives: [initiative],
      projects: [live, archived, removed],
      removed: { projects: [removed.id] },
    },
    team,
    otherTeam,
    lead,
    status,
    size,
    theme,
    initiative,
    live,
    archived,
    removed,
  };
}

test.describe("projects sheet", () => {
  test("MIRROR-R19 shows the columns of section 4 with their shapes", async ({
    page,
    signIn,
    mirror,
  }) => {
    const f = projectsFixture(mirror);
    await mirror.write(f.records);
    await signIn();
    await page.goto("/sheets/projects");
    const region = await grid(page, "Projects");

    const titles = await headers(region);
    const expected = [
      "Name",
      "Status",
      "Lead",
      "Start date",
      "Target date",
      "Priority",
      "Teams",
      "Initiatives",
      "Health",
      "Progress",
      "Latest update",
      "Link",
    ];
    expect(titles.filter((title) => expected.includes(title))).toEqual(expected);
    // One badge column per single-select label group, between priority and teams.
    expect(titles).toContain(f.size.name);
    expect(titles.indexOf(f.size.name)).toBeGreaterThan(titles.indexOf("Priority"));
    expect(titles.indexOf(f.size.name)).toBeLessThan(titles.indexOf("Teams"));
    expect(titles).not.toContain(f.theme.name);

    const live = row(region, f.live.name);
    await expect(live).toHaveCount(1);
    const shapes = {
      name: "text",
      status: "badge",
      lead: "user",
      startDate: "date",
      targetDate: "date",
      priority: "badge",
      [`label:${f.size.id}`]: "badge",
      teams: "chips",
      initiatives: "chips",
      health: "badge",
      progress: "percent",
      latestUpdate: "excerpt",
      link: "link",
    };
    for (const [column, shape] of Object.entries(shapes)) {
      await expect(cell(live, column)).toHaveAttribute("data-shape", shape);
    }
    await expect(cell(live, "name")).toHaveText(f.live.name);
    await expect(cell(live, "status").locator(".sheet-badge")).toHaveText(f.status.name);
    await expect(cell(live, "lead")).toContainText(f.lead.name);
    await expect(cell(live, "startDate")).toHaveText("Oct 1, 2026");
    await expect(cell(live, "targetDate")).toHaveText("Dec 31, 2026");
    await expect(cell(live, "priority").locator(".sheet-badge")).toHaveText("High");
    await expect(cell(live, `label:${f.size.id}`).locator(".sheet-badge")).toHaveText("L");
    await expect(cell(live, "teams").locator(".sheet-chip")).toHaveText([
      f.team.name,
      f.otherTeam.name,
    ]);
    await expect(cell(live, "initiatives").locator(".sheet-chip")).toHaveText([f.initiative.name]);
    await expect(cell(live, "health").locator(".sheet-badge")).toHaveText("At risk");
    await expect(cell(live, "progress")).toHaveText("26%");
    await expect(cell(live, "latestUpdate").locator("time")).toHaveText("Oct 20, 2026");
    await expect(cell(live, "latestUpdate")).toContainText("Shipped the first milestone.");
    const link = cell(live, "link").getByRole("link");
    await expect(link).toHaveText(f.live.slugId);
    await expect(link).toHaveAttribute("href", f.live.url);
  });

  test("MIRROR-R18 lists every project; archived and removed ones are hidden until asked, then flagged", async ({
    page,
    signIn,
    mirror,
  }) => {
    const f = projectsFixture(mirror);
    await mirror.write(f.records);
    await signIn();
    await page.goto("/sheets/projects");
    const region = await grid(page, "Projects");

    await expect(row(region, f.live.name)).toHaveCount(1);
    await expect(row(region, f.archived.name)).toHaveCount(0);
    await expect(row(region, f.removed.name)).toHaveCount(0);
    await expect(page.getByTestId("sheet-count")).toContainText("archived or removed hidden");

    await page.getByLabel("Show archived and removed").check();
    const archived = row(region, f.archived.name);
    const removed = row(region, f.removed.name);
    await expect(archived).toHaveCount(1);
    await expect(removed).toHaveCount(1);
    await expect(archived.locator('[data-flag="archived"]')).toHaveText("Archived");
    await expect(removed.locator('[data-flag="removed"]')).toHaveText("Removed");
    await expect(cell(archived, "name")).toHaveClass(/sheet-flagged/);
    await expect(cell(row(region, f.live.name), "name")).not.toHaveClass(/sheet-flagged/);
    await expect(row(region, f.live.name).locator("[data-flag]")).toHaveCount(0);

    await page.getByLabel("Show archived and removed").uncheck();
    await expect(row(region, f.archived.name)).toHaveCount(0);
  });

  test("MIRROR-R19 no cell can be edited and the grid offers no editing affordance", async ({
    page,
    signIn,
    mirror,
  }) => {
    const f = projectsFixture(mirror);
    await mirror.write(f.records);
    await signIn();
    await page.goto("/sheets/projects");
    const region = await grid(page, "Projects");
    // Not the first column: the frozen copy of it lies over the master table.
    const target = cell(row(region, f.live.name), "targetDate");
    const editor = page.locator(".handsontableInputHolder textarea:visible, .htEditor:visible");

    // Double-click, Enter, typing and deleting open nothing and change nothing.
    await target.dblclick();
    await expect(editor).toHaveCount(0);
    await page.keyboard.press("Enter");
    await page.keyboard.type("overwritten");
    await page.keyboard.press("Delete");
    await page.keyboard.press("Backspace");
    await expect(editor).toHaveCount(0);
    await expect(target).toHaveText("Dec 31, 2026");

    // No fill handle on the selection.
    await target.click();
    await expect(region.locator(".wtBorder.corner:visible")).toHaveCount(0);

    // Paste does nothing.
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "pasted");
      const target = document.activeElement ?? document.body;
      target.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    await expect(target).toHaveText("Dec 31, 2026");

    // Copy is allowed and gives plain text.
    const copied = await page.evaluate(() => {
      const data = new DataTransfer();
      const target = document.activeElement ?? document.body;
      target.dispatchEvent(
        new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }),
      );
      return data.getData("text/plain");
    });
    expect(copied).toBe("Dec 31, 2026");

    // No context menu of the grid's own.
    await target.click({ button: "right" });
    await expect(page.locator(".htContextMenu:visible")).toHaveCount(0);
    await expect(target).toHaveText("Dec 31, 2026");
  });

  test("MIRROR-R19 mirror values render as text, never as markup", async ({
    page,
    signIn,
    mirror,
  }) => {
    const hostile = `${mirror.name("x")} <img src=x onerror="window.__sheetXss=1">`;
    const group = mirror.projectLabel("group", {
      name: `${mirror.name("g")} <img src=x onerror="window.__sheetXss=2">`,
      isGroup: true,
      selection: "single",
    });
    const project = mirror.project("hostile", {
      name: hostile,
      url: "javascript:window.__sheetXss=3",
    });
    await mirror.write({ projectLabels: [group], projects: [project] });
    await signIn();
    await page.goto("/sheets/projects");
    const region = await grid(page, "Projects");

    await expect(cell(row(region, hostile), "name")).toHaveText(hostile);
    expect(await headers(region)).toContain(group.name);
    await expect(region.locator("img")).toHaveCount(0);
    await expect(cell(row(region, hostile), "link").getByRole("link")).toHaveCount(0);
    expect(await page.evaluate(() => (window as { __sheetXss?: number }).__sheetXss)).toBe(
      undefined,
    );
  });
});

test.describe("initiatives sheet", () => {
  test("MIRROR-R18 MIRROR-R19 lists every initiative with the columns of section 4", async ({
    page,
    signIn,
    mirror,
  }) => {
    const team = mirror.team("lead-team");
    const owner = mirror.user("owner");
    const horizon = mirror.initiativeLabel("horizon", { isGroup: true, selection: "single" });
    const h1 = mirror.initiativeLabel("h1", { name: "H1", parentId: horizon.id });
    const projects = [mirror.project("a"), mirror.project("b"), mirror.project("gone")];
    const live = mirror.initiative("live", {
      identifier: "INI-1",
      status: "Active",
      ownerId: owner.id,
      leadTeamId: team.id,
      targetDate: "2027-03-31",
      priority: 1,
      health: "onTrack",
      projectIds: projects.map((p) => p.id),
      labelIds: [h1.id],
      lastUpdate: {
        id: mirror.id("update"),
        excerpt: "On track for Q1.",
        health: "onTrack",
        createdAt: "2026-10-21T00:00:00.000Z",
      },
    });
    const archived = mirror.initiative("archived", { archivedAt: "2026-10-15T00:00:00.000Z" });
    const removed = mirror.initiative("removed");
    await mirror.write({
      teams: [team],
      users: [owner],
      initiativeLabels: [horizon, h1],
      projects,
      initiatives: [live, archived, removed],
      removed: { initiatives: [removed.id], projects: [mirror.id("gone")] },
    });
    await signIn();
    await page.goto("/sheets/initiatives");
    const region = await grid(page, "Initiatives");

    const titles = await headers(region);
    const expected = [
      "Name",
      "Status",
      "Owner",
      "Target date",
      "Priority",
      horizon.name,
      "Lead team",
      "Health",
      "Projects",
      "Latest update",
      "Link",
    ];
    expect(titles.filter((title) => expected.includes(title))).toEqual(expected);

    const r = row(region, live.name);
    const shapes = {
      name: "text",
      status: "badge",
      owner: "user",
      targetDate: "date",
      priority: "badge",
      [`label:${horizon.id}`]: "badge",
      leadTeam: "chips",
      health: "badge",
      projects: "number",
      latestUpdate: "excerpt",
      link: "link",
    };
    for (const [column, shape] of Object.entries(shapes)) {
      await expect(cell(r, column)).toHaveAttribute("data-shape", shape);
    }
    await expect(cell(r, "status")).toHaveText("Active");
    await expect(cell(r, "owner")).toContainText(owner.name);
    await expect(cell(r, "targetDate")).toHaveText("Mar 31, 2027");
    await expect(cell(r, "priority")).toHaveText("Urgent");
    await expect(cell(r, `label:${horizon.id}`)).toHaveText("H1");
    await expect(cell(r, "leadTeam").locator(".sheet-chip")).toHaveText([team.name]);
    await expect(cell(r, "health")).toHaveText("On track");
    // Two mirrored projects; the removed one does not count.
    await expect(cell(r, "projects")).toHaveText("2");
    await expect(cell(r, "latestUpdate")).toContainText("On track for Q1.");
    await expect(cell(r, "link").getByRole("link")).toHaveAttribute("href", live.url);
    await expect(cell(r, "link")).toHaveText("INI-1");

    await expect(row(region, archived.name)).toHaveCount(0);
    await expect(row(region, removed.name)).toHaveCount(0);
    await page.getByLabel("Show archived and removed").check();
    await expect(row(region, archived.name).locator('[data-flag="archived"]')).toBeVisible();
    await expect(row(region, removed.name).locator('[data-flag="removed"]')).toBeVisible();
  });
});

test.describe("client-only sheets", () => {
  for (const [path, title] of [
    ["/sheets/projects", "Projects"],
    ["/sheets/initiatives", "Initiatives"],
  ] as const) {
    test(`MIRROR-R23 the server sends ${path} without the sheet, saying it needs JavaScript`, async ({
      page,
      signIn,
      mirror,
    }) => {
      const project = mirror.project("server");
      const initiative = mirror.initiative("server");
      await mirror.write({ projects: [project], initiatives: [initiative] });
      const user = await signIn();
      const response = await page.request.get(path);
      expect(response.status()).toBe(200);
      const html = await response.text();
      // The shell is server-rendered: the account bar and the sheet's title.
      expect(html).toContain(user.name);
      expect(html).toContain(`>${title}</h1>`);
      expect(html).toContain("<noscript>");
      expect(html).toContain("This sheet runs in the browser and needs JavaScript");
      // The rows are not.
      expect(html).not.toContain(project.name);
      expect(html).not.toContain(initiative.name);
      expect(html).not.toContain("ht_master");
    });
  }

  test.describe("with JavaScript off", () => {
    test.use({ javaScriptEnabled: false });

    test("MIRROR-R23 a sheet route says it needs JavaScript", async ({ page, signIn }) => {
      const user = await signIn();
      await page.goto("/sheets/projects");
      await expect(page.getByTestId("sheet-noscript")).toBeVisible();
      await expect(page.getByTestId("sheet-noscript")).toContainText("needs JavaScript");
      await expect(page.getByTestId("signed-in-user")).toHaveText(user.name);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Projects");
    });

    test("MIRROR-R23 SEED-R18 every other route keeps server rendering", async ({
      page,
      signIn,
    }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(site.name);
      await expect(page.locator("[data-purpose]")).toBeVisible();
      await expect(page.locator("[data-initiative]")).toHaveCount(initiativePages.length);

      await page.goto("/sign-in");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");

      await signIn();
      await page.goto("/sheets");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Planning sheet");
      await expect(page.getByRole("link", { name: "Projects" })).toBeVisible();
    });
  });
});

test.describe("sheet data", () => {
  test("MIRROR-R15 the server function behind a sheet refuses a request without a session", async ({
    page,
    signIn,
    mirror,
    playwright,
    baseURL,
  }) => {
    const project = mirror.project("guarded");
    await mirror.write({ projects: [project] });
    await signIn();
    const call = page.waitForRequest((request) => request.url().includes("/_serverFn/"));
    await page.goto("/sheets/projects");
    const url = (await call).url();
    await grid(page, "Projects");

    const anonymous = await playwright.request.newContext({ baseURL });
    try {
      const response = await anonymous.get(url, { maxRedirects: 0 });
      expect(await response.text()).not.toContain(project.name);
      expect(response.status()).not.toBe(200);
    } finally {
      await anonymous.dispose();
    }
  });
});
