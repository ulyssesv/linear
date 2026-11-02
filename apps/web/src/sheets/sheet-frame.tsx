// The frame around a sheet, and the placeholder the server renders in a sheet's place
// (MIRROR-R23). Kept apart from sheet-page.tsx so the routes' pending components pull in
// only this much; the page itself loads with the route's own chunk.
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { SheetKind } from "./model.ts";

export const sheetTitles: Record<SheetKind, string> = {
  projects: "Projects",
  initiatives: "Initiatives",
};

function SheetNav({ kind }: { kind: SheetKind }) {
  return (
    <nav aria-label="Sheets" className="flex gap-4 text-sm">
      <Link to="/sheets" className="underline underline-offset-4 hover:text-muted-foreground">
        All sheets
      </Link>
      {(Object.keys(sheetTitles) as SheetKind[])
        .filter((other) => other !== kind)
        .map((other) => (
          <Link
            key={other}
            to={`/sheets/${other}`}
            className="underline underline-offset-4 hover:text-muted-foreground"
          >
            {sheetTitles[other]}
          </Link>
        ))}
    </nav>
  );
}

export function SheetFrame({ kind, children }: { kind: SheetKind; children: ReactNode }) {
  return (
    <div className="flex h-[calc(100dvh-2.5rem)] min-h-[24rem] flex-col gap-4 px-6 pt-4 pb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-semibold text-2xl tracking-tight">{sheetTitles[kind]}</h1>
        <SheetNav kind={kind} />
      </div>
      {children}
    </div>
  );
}

/** What the server renders for a sheet route, and what shows while it loads. */
export function SheetPlaceholder({ kind }: { kind: SheetKind }) {
  return (
    <SheetFrame kind={kind}>
      <div data-testid="sheet-placeholder" className="space-y-2 text-muted-foreground text-sm">
        <noscript>
          <p data-testid="sheet-noscript" className="font-medium text-foreground">
            This sheet runs in the browser and needs JavaScript. Turn JavaScript on and reload the
            page to see it.
          </p>
        </noscript>
        <p>Loading the sheet…</p>
      </div>
    </SheetFrame>
  );
}
