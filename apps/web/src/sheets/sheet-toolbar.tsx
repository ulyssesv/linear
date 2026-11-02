// The toolbar above a sheet (MIRROR-R18, MIRROR-R20): the row count, the archived toggle,
// the team and status filters and the columns menu. Every control changes view state the
// page holds in React only; nothing is stored or sent.
import { type ReactNode, useEffect, useId, useRef } from "react";
import type { SheetColumn } from "./model.ts";
import { type FilterOption, type FilterValues, nameColumn, toggleValue } from "./view.ts";

/**
 * A disclosure that closes on Escape and on a click outside it. Built on <details>, so it
 * works from the keyboard and needs no dependency.
 */
function Menu({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: Event) => {
      const details = ref.current;
      if (!details?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        details.open = false;
        details.querySelector("summary")?.focus();
        return;
      }
      if (!details.contains(event.target as Node)) details.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details ref={ref} data-testid={testId} className="relative">
      <summary className="cursor-pointer select-none rounded-md border px-2 py-1 hover:bg-muted">
        {label}
      </summary>
      <div className="absolute left-0 z-20 mt-1 max-h-80 min-w-56 overflow-auto rounded-md border bg-background p-2 shadow-md">
        {children}
      </div>
    </details>
  );
}

function Check({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 py-0.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={id} className={disabled ? "text-muted-foreground" : undefined}>
        {label}
      </label>
    </div>
  );
}

/** A multi-select filter: nothing selected shows every row. */
export function FilterMenu({
  title,
  testId,
  options,
  selected,
  onChange,
}: {
  title: string;
  testId: string;
  options: readonly FilterOption[];
  selected: FilterValues;
  onChange: (selected: FilterValues) => void;
}) {
  const summary =
    selected.length === 0
      ? "All"
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${selected.length} selected`;
  return (
    <Menu label={`${title}: ${summary}`} testId={testId}>
      <fieldset>
        <legend className="sr-only">{title}</legend>
        {options.length === 0 ? <p className="text-muted-foreground">No values</p> : null}
        {options.map((option) => (
          <Check
            key={option.value}
            label={
              <>
                {option.label} <span className="text-muted-foreground">({option.count})</span>
              </>
            }
            checked={selected.includes(option.value)}
            onChange={(on) => onChange(toggleValue(selected, option.value, on))}
          />
        ))}
      </fieldset>
      {selected.length > 0 ? (
        <button
          type="button"
          className="mt-2 text-sm underline underline-offset-4"
          onClick={() => onChange([])}
        >
          Clear {title.toLowerCase()} filter
        </button>
      ) : null}
    </Menu>
  );
}

/** Show or hide columns; the name column always stays. */
export function ColumnsMenu({
  columns,
  hidden,
  onToggle,
}: {
  columns: readonly SheetColumn[];
  hidden: readonly string[];
  onToggle: (columnId: string, hide: boolean) => void;
}) {
  const count = columns.filter((column) => hidden.includes(column.id)).length;
  return (
    <Menu label={count > 0 ? `Columns (${count} hidden)` : "Columns"} testId="columns-menu">
      <fieldset>
        <legend className="sr-only">Visible columns</legend>
        {columns.map((column) => (
          <Check
            key={column.id}
            label={column.title}
            checked={!hidden.includes(column.id)}
            disabled={column.id === nameColumn}
            onChange={(visible) => onToggle(column.id, !visible)}
          />
        ))}
      </fieldset>
    </Menu>
  );
}

export function ArchivedToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      Show archived and removed
    </label>
  );
}
