// Sheet behaviours (MIRROR-R20, MIRROR-R21, MIRROR-R24, MIRROR-R25). `local` project only:
// each test writes its own mirror rows through e2e/mirror.ts, signs in through e2e/auth.ts,
// and filters to its own team where other tests' rows could get in the way. Webhooks are
// posted to the built server, signed with the e2e server's secret; nothing reaches Linear.
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { delivery, envelope, projectData } from "../test/webhook-fixtures.ts";
import { cell, grid, header, headers, names, row } from "./grid.ts";
import { type E2EMirror, expect, test } from "./mirror.ts";
import { e2eServerEnv } from "./server-env.ts";

/** Opens a filter menu and ticks its values. */
async function pick(page: Page, testId: string, labels: string[]): Promise<void> {
  const menu = page.getByTestId(testId);
  await menu.locator("summary").click();
  for (const label of labels) await menu.getByLabel(label).check();
  await menu.locator("summary").click();
}

/** Four projects across two teams of this test, with dates, priorities and progress. */
function teamsFixture(mirror: E2EMirror) {
  const alpha = mirror.team("alpha");
  const beta = mirror.team("beta");
  const lead = mirror.user("lead");
  const planned = mirror.projectStatus("planned", { name: mirror.name("Planned") });
  const started = mirror.projectStatus("started", { name: mirror.name("Started") });
  const a = mirror.project("a late", {
    teamIds: [alpha.id],
    statusId: started.id,
    leadId: lead.id,
    targetDate: "2027-03-01",
    priority: 4,
    progress: 0.9,
  });
  const b = mirror.project("b early", {
    teamIds: [alpha.id],
    statusId: planned.id,
    targetDate: "2026-11-15",
    priority: 1,
    progress: 0.1,
  });
  const c = mirror.project("c none", {
    teamIds: [beta.id],
    statusId: started.id,
    targetDate: null,
    priority: 0,
    progress: 0.5,
  });
  const d = mirror.project("d mid", {
    teamIds: [alpha.id, beta.id],
    statusId: planned.id,
    targetDate: "2026-12-31",
    priority: 2,
    progress: 0.25,
  });
  return {
    records: {
      teams: [alpha, beta],
      users: [lead],
      projectStatuses: [planned, started],
      projects: [a, b, c, d],
    },
    alpha,
    beta,
    planned,
    started,
    a: a.name,
    b: b.name,
    c: c.name,
    d: d.name,
  };
}

test.describe("view behaviours", () => {
  // Wide enough that every column renders: the grid only draws what is in view.
  test.use({ viewport: { width: 3200, height: 900 } });

  test("MIRROR-R20 sort, filter by team and status, and column hide work in the browser, write nowhere and persist nothing", async ({
    page,
    signIn,
    mirror,
  }) => {
    const f = teamsFixture(mirror);
    await mirror.write(f.records);
    await signIn();

    // Record any write to browser storage or cookies from the page's own scripts.
    await page.addInitScript(() => {
      const writes: string[] = [];
      (window as unknown as { __storageWrites: string[] }).__storageWrites = writes;
      for (const method of ["setItem", "removeItem", "clear"] as const) {
        const original = Storage.prototype[method] as (...args: unknown[]) => unknown;
        Storage.prototype[method] = function (this: Storage, ...args: unknown[]) {
          writes.push(`storage.${method}`);
          return original.apply(this, args);
        } as never;
      }
      const cookie = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
      Object.defineProperty(Document.prototype, "cookie", {
        configurable: true,
        get() {
          return cookie?.get?.call(this);
        },
        set(value: string) {
          writes.push("cookie");
          cookie?.set?.call(this, value);
        },
      });
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = (...args: Parameters<IDBFactory["open"]>) => {
        writes.push("indexedDB.open");
        return open(...args);
      };
    });

    await page.goto("/sheets/projects");
    const region = await grid(page, "Projects");
    const cookiesBefore = await page.context().cookies();
    const requests: { method: string; url: string }[] = [];
    page.on("request", (request) =>
      requests.push({ method: request.method(), url: request.url() }),
    );

    // Filter by team: a project matches when any of its teams is selected.
    await pick(page, "filter-teams", [f.alpha.name]);
    await expect.poll(() => names(region)).toEqual([f.a, f.b, f.d]);
    await expect(page.getByTestId("filter-teams").locator("summary")).toHaveText(
      `Team: ${f.alpha.name}`,
    );
    await expect(page.getByTestId("sheet-count")).toContainText("3 of ");

    // And by status, combined with the team filter.
    await pick(page, "filter-statuses", [f.started.name]);
    await expect.poll(() => names(region)).toEqual([f.a]);
    await page.getByTestId("filter-statuses").locator("summary").click();
    await page.getByTestId("filter-statuses").getByLabel(f.started.name).uncheck();
    await page.getByTestId("filter-statuses").locator("summary").click();
    await pick(page, "filter-teams", [f.beta.name]);
    await expect.poll(() => names(region)).toEqual([f.a, f.b, f.c, f.d]);

    // Sort by clicking a header: ascending, descending, then none. Empty dates go last.
    const target = header(region, "Target date");
    await target.locator(".colHeader").click();
    await expect(header(region, "Target date")).toHaveAttribute("aria-sort", "ascending");
    await expect.poll(() => names(region)).toEqual([f.b, f.d, f.a, f.c]);
    await target.locator(".colHeader").click();
    await expect(header(region, "Target date")).toHaveAttribute("aria-sort", "descending");
    await expect.poll(() => names(region)).toEqual([f.a, f.d, f.b, f.c]);
    await target.locator(".colHeader").click();
    await expect(header(region, "Target date")).toHaveAttribute("aria-sort", "none");
    await expect.poll(() => names(region)).toEqual([f.a, f.b, f.c, f.d]);

    // Priority in Linear's order, no priority last; progress as numbers.
    await header(region, "Priority").locator(".colHeader").click();
    await expect.poll(() => names(region)).toEqual([f.b, f.d, f.a, f.c]);
    await expect(header(region, "Priority")).toHaveAttribute("aria-sort", "ascending");
    await header(region, "Progress").locator(".colHeader").click();
    await header(region, "Progress").locator(".colHeader").click();
    await expect(header(region, "Progress")).toHaveAttribute("aria-sort", "descending");
    await expect(header(region, "Priority")).toHaveAttribute("aria-sort", "none");
    await expect.poll(() => names(region)).toEqual([f.a, f.c, f.d, f.b]);
    // The rich cells follow their rows.
    await expect(cell(row(region, f.a), "progress")).toHaveText("90%");
    await expect(cell(row(region, f.b), "progress")).toHaveText("10%");

    // Hide a column; the name cannot be hidden.
    const columnsMenu = page.getByTestId("columns-menu");
    await columnsMenu.locator("summary").click();
    await expect(columnsMenu.getByLabel("Name")).toBeDisabled();
    await columnsMenu.getByLabel("Lead").uncheck();
    await columnsMenu.getByLabel("Health").uncheck();
    await expect.poll(() => headers(region)).not.toContain("Lead");
    expect(await headers(region)).not.toContain("Health");
    expect(await headers(region)).toContain("Status");
    await expect(columnsMenu.locator("summary")).toHaveText("Columns (2 hidden)");
    await columnsMenu.getByLabel("Health").check();
    await expect.poll(() => headers(region)).toContain("Health");
    await columnsMenu.locator("summary").click();

    // Nothing was written: every request was a read, and nothing reached storage or cookies.
    expect(requests.filter((request) => request.method !== "GET")).toEqual([]);
    expect(
      await page.evaluate(
        () => (window as unknown as { __storageWrites: string[] }).__storageWrites,
      ),
    ).toEqual([]);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    expect(await page.context().cookies()).toEqual(cookiesBefore);

    // Nothing persists: a reload starts from the default view.
    await page.reload();
    const again = await grid(page, "Projects");
    await expect(page.getByTestId("filter-teams").locator("summary")).toHaveText("Team: All");
    await expect(page.getByTestId("filter-statuses").locator("summary")).toHaveText("Status: All");
    await expect(page.getByTestId("columns-menu").locator("summary")).toHaveText("Columns");
    expect(await headers(again)).toContain("Lead");
    await expect(again.locator('.ht_clone_top thead th[aria-sort="descending"]')).toHaveCount(0);
    await expect(again.locator('.ht_clone_top thead th[aria-sort="ascending"]')).toHaveCount(0);
  });

  test("MIRROR-R20 the initiatives sheet filters by lead team and status", async ({
    page,
    signIn,
    mirror,
  }) => {
    const core = mirror.team("core");
    const web = mirror.team("web");
    const one = mirror.initiative("one", { leadTeamId: core.id, status: "Active" });
    const two = mirror.initiative("two", { leadTeamId: web.id, status: "Planned" });
    const three = mirror.initiative("three", { leadTeamId: core.id, status: "Planned" });
    await mirror.write({ teams: [core, web], initiatives: [one, two, three] });
    await signIn();
    await page.goto("/sheets/initiatives");
    const region = await grid(page, "Initiatives");

    await pick(page, "filter-teams", [core.name]);
    await expect(page.getByTestId("filter-teams").locator("summary")).toHaveText(
      `Lead team: ${core.name}`,
    );
    await expect.poll(() => names(region)).toEqual([one.name, three.name]);
    await pick(page, "filter-statuses", ["Planned"]);
    await expect.poll(() => names(region)).toEqual([three.name]);
  });
});

test.describe("spreadsheet navigation", () => {
  test.use({ viewport: { width: 1200, height: 700 } });

  // MIRROR-R21 is checked by hand (docs in the pull request); this is a cheap smoke of the
  // grid's own keyboard handling, the frozen first column, resize and reorder, so a change
  // that breaks them fails here first.
  // @req MIRROR-R21
  test("keyboard navigation, the frozen first column, resize and reorder still work", async ({
    page,
    signIn,
    mirror,
  }) => {
    const team = mirror.team("nav");
    const status = mirror.projectStatus("nav-status");
    const projects = Array.from({ length: 40 }, (_, i) =>
      mirror.project(`nav ${String(i).padStart(2, "0")}`, {
        teamIds: [team.id],
        statusId: status.id,
        targetDate: "2026-12-01",
      }),
    );
    await mirror.write({ teams: [team], projectStatuses: [status], projects });
    await signIn();
    await page.goto("/sheets/projects");
    const region = await grid(page, "Projects");
    await pick(page, "filter-teams", [team.name]);
    await expect.poll(async () => (await names(region))[0]).toBe(projects[0]?.name);

    const current = region.locator(".ht_master td.current");
    const currentColumn = () => current.getAttribute("data-column");
    const currentName = () =>
      current.locator("xpath=..").locator('td[data-column="name"] .sheet-text').textContent();

    await cell(row(region, projects[0]?.name ?? ""), "status").click();
    await expect.poll(currentColumn).toBe("status");
    await page.keyboard.press("ArrowRight");
    await expect.poll(currentColumn).toBe("lead");
    await page.keyboard.press("Tab");
    await expect.poll(currentColumn).toBe("startDate");
    await page.keyboard.press("ArrowDown");
    await expect.poll(currentName).toBe(projects[1]?.name);
    // Home goes to the first cell outside the frozen column, as with frozen panes in Excel.
    await page.keyboard.press("Home");
    await expect.poll(currentColumn).toBe("status");
    await page.keyboard.press("ArrowLeft");
    await expect.poll(currentColumn).toBe("name");
    await page.keyboard.press("PageDown");
    await expect
      .poll(async () => {
        const name = await currentName();
        return projects.findIndex((p) => p.name === name);
      })
      .toBeGreaterThan(5);
    await page.keyboard.press("PageUp");
    await expect.poll(currentName).toBe(projects[1]?.name);
    await page.keyboard.press("End");
    await expect.poll(currentColumn).toBe("link");

    // The first column stays put while the rest scrolls sideways.
    const frozen = region.locator('.ht_clone_inline_start td[data-column="name"]').first();
    const left = (await frozen.boundingBox())?.x ?? -1;
    await region.locator(".ht_master .wtHolder").evaluate((holder) => {
      holder.scrollLeft = holder.scrollWidth;
    });
    await expect(region.locator('.ht_master td[data-column="link"]').first()).toBeVisible();
    await expect(frozen).toBeVisible();
    expect((await frozen.boundingBox())?.x).toBe(left);
    await region.locator(".ht_master .wtHolder").evaluate((holder) => {
      holder.scrollLeft = 0;
    });

    // Resize: drag the handle at a header's right edge.
    const statusHeader = header(region, "Status");
    const before = (await statusHeader.boundingBox())?.width ?? 0;
    await statusHeader.hover();
    const handle = region.locator(".manualColumnResizer");
    const box = await handle.boundingBox();
    if (!box) throw new Error("no resize handle");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () => (await header(region, "Status").boundingBox())?.width ?? 0)
      .toBeGreaterThan(before + 40);

    // Reorder: select a column by its header, then drag it left of another.
    const order = await headers(region);
    const leadHeader = header(region, "Lead");
    await leadHeader.locator(".colHeader").click(); // also sorts by lead; harmless here
    const from = await leadHeader.boundingBox();
    const to = await header(region, "Status").boundingBox();
    if (!from || !to) throw new Error("headers not drawn");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 5, to.y + to.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect
      .poll(async () => (await headers(region)).indexOf("Lead"))
      .toBe(order.indexOf("Status"));
    expect((await headers(region))[0]).toBe("Name");
    // The drag did not count as another click: the sort and its indicator moved with it.
    await expect(header(region, "Lead")).toHaveAttribute("aria-sort", "ascending");
    await expect(header(region, "Status")).toHaveAttribute("aria-sort", "none");
  });
});

test.describe("freshness", () => {
  test.use({ viewport: { width: 3200, height: 900 } });

  const indicator = (page: Page) => page.getByTestId("sheet-freshness");

  async function lastChange(page: Page): Promise<number> {
    const at = await indicator(page).locator("time").getAttribute("datetime", { timeout: 1000 });
    return at ? Date.parse(at) : 0;
  }

  test("MIRROR-R24 a webhook change reaches an open sheet within ten seconds, in place, and the indicator moves", async ({
    page,
    signIn,
    mirror,
    baseURL,
  }) => {
    const team = mirror.team("hooks");
    const project = mirror.project("hooked", { teamIds: [team.id] });
    const neighbour = mirror.project("neighbour", { teamIds: [team.id] });
    await mirror.write({ teams: [team], projects: [project, neighbour] });
    await signIn();
    await page.goto("/sheets/projects");
    const region = await grid(page, "Projects");
    await expect(row(region, project.name)).toHaveCount(1);
    await expect(indicator(page)).toHaveAttribute("data-state", "live");
    const versionBefore = await indicator(page).getAttribute("data-version");
    const changedBefore = await lastChange(page).catch(() => 0);

    const renamed = mirror.name("renamed by webhook");
    const post = async (action: "update" | "remove", overrides: Record<string, unknown>) => {
      const data = projectData(project.id, {
        name: project.name,
        slugId: project.slugId,
        identifier: null,
        url: project.url,
        teamIds: [team.id],
        statusId: null,
        status: null,
        leadId: null,
        lead: null,
        labelIds: [],
        initiatives: [],
        updatedAt: new Date().toISOString(),
        ...overrides,
      });
      const body = envelope("Project", action, data, { timestamp: Date.now() });
      const response = await fetch(
        delivery(body, {
          secret: e2eServerEnv(0).LINEAR_WEBHOOK_SECRET,
          url: `${baseURL}/webhooks/linear`,
          delivery: randomUUID(),
        }),
      );
      expect(response.status).toBe(200);
      return Date.now();
    };

    const applied = await post("update", { name: renamed, priority: 1 });
    await expect(row(region, renamed)).toHaveCount(1, { timeout: 10_000 });
    expect(Date.now() - applied).toBeLessThan(10_000);
    // In place: the same row, not a second one; its neighbour untouched.
    await expect(row(region, project.name)).toHaveCount(0);
    await expect(cell(row(region, renamed), "priority")).toHaveText("Urgent");
    await expect(row(region, neighbour.name)).toHaveCount(1);

    // The indicator shows the change.
    await expect(indicator(page)).not.toHaveAttribute("data-version", versionBefore ?? "");
    await expect.poll(() => lastChange(page)).toBeGreaterThan(changedBefore);
    expect(await lastChange(page)).toBeGreaterThanOrEqual(applied - 5_000);
    await expect(indicator(page)).toContainText("Updated just now");
    await expect(indicator(page).locator("time")).toHaveAttribute("title", /\d{4}/);

    // A remove event flags the row, which then hides like any removed one.
    const removed = await post("remove", { name: renamed });
    await expect(row(region, renamed)).toHaveCount(0, { timeout: 10_000 });
    expect(Date.now() - removed).toBeLessThan(10_000);
    await page.getByLabel("Show archived and removed").check();
    await expect(row(region, renamed).locator('[data-flag="removed"]')).toBeVisible();
  });

  test("MIRROR-R24 a reconcile change reaches an open sheet within ten seconds without reload", async ({
    page,
    signIn,
    mirror,
  }) => {
    const team = mirror.team("reconciled");
    const project = mirror.project("reconciled", { teamIds: [team.id], progress: 0.1 });
    await mirror.write({ teams: [team], projects: [project] });
    await signIn();
    await page.goto("/sheets/projects");
    const region = await grid(page, "Projects");
    await expect(row(region, project.name)).toHaveCount(1);
    const changedBefore = await lastChange(page).catch(() => 0);
    let navigations = 0;
    page.on("framenavigated", () => navigations++);
    // View state the update must leave alone.
    await pick(page, "filter-teams", [team.name]);
    await header(region, "Progress").locator(".colHeader").click();
    const columnsMenu = page.getByTestId("columns-menu");
    await columnsMenu.locator("summary").click();
    await columnsMenu.getByLabel("Lead").uncheck();
    await columnsMenu.locator("summary").click();

    const renamed = mirror.name("renamed by reconcile");
    const update = {
      ...project,
      name: renamed,
      progress: 0.75,
      updatedAt: new Date().toISOString(),
    };
    // As a reconcile pass writes: one transaction with its sync-log entry.
    await mirror.write({ projects: [update] }, { source: "reconcile", run: true });
    const applied = Date.now();
    await expect(row(region, renamed)).toHaveCount(1, { timeout: 10_000 });
    expect(Date.now() - applied).toBeLessThan(10_000);
    await expect(cell(row(region, renamed), "progress")).toHaveText("75%");
    await expect(row(region, project.name)).toHaveCount(0);
    await expect.poll(() => lastChange(page)).toBeGreaterThan(changedBefore);
    expect(navigations).toBe(0);
    expect(await names(region)).toEqual([renamed]);
    await expect(header(region, "Progress")).toHaveAttribute("aria-sort", "ascending");
    expect(await headers(region)).not.toContain("Lead");
  });

  test("MIRROR-R24 an expired session stops the updates and offers to sign in again", async ({
    page,
    signIn,
    mirror,
    context,
  }) => {
    await mirror.write({ projects: [mirror.project("session")] });
    await signIn();
    await page.goto("/sheets/projects");
    await grid(page, "Projects");
    await context.clearCookies();
    await expect(indicator(page)).toHaveAttribute("data-state", "signed-out", { timeout: 10_000 });
    await expect(indicator(page).getByRole("link", { name: "Sign in again" })).toHaveAttribute(
      "href",
      "/sign-in?next=%2Fsheets%2Fprojects",
    );
  });
});

test.describe("performance", () => {
  // MIRROR-R25 is checked by hand on the production host; this measures the same path
  // locally against three hundred projects and reports the numbers in the test output.
  // @req MIRROR-R25
  test("a sheet of three hundred projects loads and scrolls", async ({ page, signIn, mirror }) => {
    test.setTimeout(90_000);
    const teams = ["core", "web", "ops", "data"].map((t) => mirror.team(t));
    const users = ["ana", "ben", "cy", "dee", "eve"].map((u) => mirror.user(u));
    const statuses = ["backlog", "planned", "started", "done"].map((s, i) =>
      mirror.projectStatus(s, { position: i }),
    );
    const size = mirror.projectLabel("size", { isGroup: true, selection: "single" });
    const sizes = ["S", "M", "L"].map((s) =>
      mirror.projectLabel(`size-${s}`, { name: s, parentId: size.id }),
    );
    const initiatives = ["i1", "i2", "i3"].map((i) => mirror.initiative(i));
    const projects = Array.from({ length: 300 }, (_, i) => {
      const nth = <T>(list: T[]) => list[i % list.length] as T;
      return mirror.project(`perf ${String(i).padStart(3, "0")}`, {
        // Every seventh project in two teams.
        teamIds: [nth(teams).id, ...(i % 7 === 0 ? [teams[(i + 1) % teams.length]?.id ?? ""] : [])],
        statusId: nth(statuses).id,
        leadId: nth(users).id,
        startDate: `2026-${String((i % 12) + 1).padStart(2, "0")}-01`,
        targetDate: i % 5 === 0 ? null : `2027-${String((i % 12) + 1).padStart(2, "0")}-15`,
        priority: i % 5,
        health: nth(["onTrack", "atRisk", "offTrack", null]),
        progress: (i % 100) / 100,
        initiativeIds: [nth(initiatives).id],
        labelIds: [nth(sizes).id],
        lastUpdate: {
          id: mirror.id(`update-${i}`),
          excerpt: `Week ${i}: shipped the next slice and lined up the review for the one after.`,
          health: "onTrack",
          createdAt: "2026-10-20T09:30:00.000Z",
        },
      });
    });
    await mirror.write({
      teams,
      users,
      projectStatuses: statuses,
      projectLabels: [size, ...sizes],
      initiatives,
      projects,
    });
    await signIn();

    const loads: number[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.goto("/sheets/projects", { waitUntil: "commit" });
      const shown = await page.waitForFunction(
        () =>
          document.querySelector('.ht_master tbody td[data-column="name"] .sheet-text')
            ? performance.now()
            : 0,
        null,
        { polling: "raf", timeout: 15_000 },
      );
      loads.push(Math.round(Number(await shown.jsonValue())));
    }
    // The sheet's data request of the last load: its size and how long the server took.
    const data = await page.evaluate(() => {
      const fetches = performance
        .getEntriesByType("resource")
        .filter((entry) => entry.name.includes("/_serverFn/")) as PerformanceResourceTiming[];
      const largest = fetches.sort((a, b) => b.decodedBodySize - a.decodedBodySize)[0];
      return largest
        ? { kb: Math.round(largest.decodedBodySize / 1024), ms: Math.round(largest.duration) }
        : null;
    });
    await expect(page.getByTestId("sheet-count")).toContainText("projects");
    const count = Number(
      /(\d+) projects/.exec((await page.getByTestId("sheet-count").textContent()) ?? "")?.[1],
    );
    expect(count).toBeGreaterThanOrEqual(300);

    // Scroll from top to bottom in steps, one per frame, and time each frame.
    const frames = await page.locator(".ht_master .wtHolder").evaluate(async (holder) => {
      const gaps: number[] = [];
      const step = Math.max(200, holder.clientHeight / 2);
      let last = performance.now();
      while (holder.scrollTop + holder.clientHeight < holder.scrollHeight - 1) {
        holder.scrollTop += step;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const now = performance.now();
        gaps.push(now - last);
        last = now;
      }
      return gaps;
    });
    const sorted = [...frames].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const worst = sorted.at(-1) ?? 0;
    const summary =
      `rows ${count}; navigation to first rows drawn ${loads.join(", ")} ms ` +
      `(first is a cold load); sheet data ${data?.kb ?? "?"} KiB in ${data?.ms ?? "?"} ms; ` +
      `scroll ${frames.length} frames, p95 ${p95.toFixed(1)} ms, ` +
      `worst ${worst.toFixed(1)} ms, over 50 ms ${frames.filter((f) => f > 50).length}`;
    test.info().annotations.push({ type: "MIRROR-R25", description: summary });
    console.log(`MIRROR-R25 ${summary}`);
    // Rendering stays virtualised: only the rows in view are in the document.
    expect(await page.locator(".ht_master tbody tr").count()).toBeLessThan(100);
    // A loose local bound; the requirement's two seconds is checked on the production host.
    expect(Math.max(...loads)).toBeLessThan(process.env.CI ? 6_000 : 2_000);
  });
});
