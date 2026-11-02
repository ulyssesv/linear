import type { ComponentType, ReactElement } from "react";

/** What every content file exports as `meta` (CONTENT-R7, CONTENT-R8). */
export type ContentMeta = {
  /** The page's heading and, with the site name, its <title>. */
  title: string;
  /** The page's meta description. */
  description: string;
  [key: string]: unknown;
};

/** The components a content file may use besides HTML (CONTENT-R9). */
export type MDXComponents = Record<string, ComponentType<never> | string>;

/** The default export of a compiled MDX file. */
export type MDXContent = (props: { components?: MDXComponents }) => ReactElement;

/** A content file's exports, as `import * as module from "...mdx"` sees them. */
export type ContentModule = { default: MDXContent; meta: ContentMeta };

/** The fields of `meta` that are missing or empty; a content file needs none (CONTENT-R8). */
export function missingMeta(meta: unknown): string[] {
  const record = (typeof meta === "object" && meta !== null ? meta : {}) as Record<string, unknown>;
  return ["title", "description"].filter(
    (key) => typeof record[key] !== "string" || (record[key] as string).trim() === "",
  );
}
