// Cell content for each shape of spec MIRROR section 4 (MIRROR-R19), built as DOM nodes.
// Mirror values come from Linear and are untrusted: they only ever reach the page as
// text nodes, attribute values the browser does not execute, or a colour that passed
// isColor. No HTML string is ever parsed. Independent of the grid library, so a future
// adapter keeps the same cells.
import {
  type CellShape,
  type CellValue,
  type Chip,
  type ExcerptValue,
  flagLabel,
  formatDate,
  formatPercent,
  type LinkValue,
  type RowFlag,
  type UserValue,
} from "../model.ts";

/** Hex colours only, as Linear stores them; anything else is dropped. */
export function isColor(value: string | null): value is string {
  return value !== null && /^#[0-9a-f]{3,8}$/i.test(value);
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function chip(doc: Document, value: Chip, className = "sheet-chip"): HTMLElement {
  const node = el(doc, "span", className);
  if (isColor(value.color)) {
    const dot = el(doc, "span", "sheet-dot");
    dot.style.backgroundColor = value.color;
    node.append(dot);
  }
  node.append(doc.createTextNode(value.label));
  return node;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts.at(-1)] : [name.trim()];
  return letters
    .map((part) => part?.[0] ?? "")
    .join("")
    .toUpperCase();
}

/** The content of one cell. Flags are shown on the first column of a flagged row. */
export function cellContent(
  doc: Document,
  shape: CellShape,
  value: CellValue,
  flags: readonly RowFlag[] = [],
): DocumentFragment {
  const out = doc.createDocumentFragment();
  if (value !== null && value !== undefined) out.append(...shapeContent(doc, shape, value));
  for (const flag of flags) {
    const node = el(doc, "span", "sheet-flag", flagLabel(flag));
    node.dataset.flag = flag;
    out.append(node);
  }
  return out;
}

function shapeContent(doc: Document, shape: CellShape, value: NonNullable<CellValue>): Node[] {
  switch (shape) {
    case "text":
      return [el(doc, "span", "sheet-text", String(value))];
    case "badge":
      return [chip(doc, value as Chip, "sheet-badge")];
    case "user": {
      const { name } = value as UserValue;
      const avatar = el(doc, "span", "sheet-avatar", initials(name));
      avatar.setAttribute("aria-hidden", "true");
      return [avatar, el(doc, "span", "sheet-text", name)];
    }
    case "date":
      return [el(doc, "span", "sheet-text", formatDate(value as string))];
    case "chips":
      return (value as Chip[]).map((item) => chip(doc, item));
    case "percent": {
      const fraction = Math.min(Math.max(value as number, 0), 1);
      const bar = el(doc, "span", "sheet-bar");
      const fill = el(doc, "span", "sheet-bar-fill");
      fill.style.width = `${Math.round(fraction * 100)}%`;
      bar.append(fill);
      bar.setAttribute("aria-hidden", "true");
      return [bar, el(doc, "span", "sheet-text", formatPercent(value as number))];
    }
    case "excerpt": {
      const excerpt = value as ExcerptValue;
      const date = el(doc, "time", "sheet-muted", formatDate(excerpt.date));
      date.dateTime = excerpt.date;
      const text = el(doc, "span", "sheet-text", excerpt.text);
      text.title = excerpt.text;
      return [date, text];
    }
    case "link": {
      const link = value as LinkValue;
      // safeLink admitted only https URLs into the model.
      const anchor = el(doc, "a", "sheet-link", link.label);
      anchor.href = link.href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      return [anchor];
    }
    case "number":
      return [el(doc, "span", "sheet-number", String(value))];
  }
}
