// The site's photos are optimised before they are committed (CONTENT-R22).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Figure } from "../src/components/content.tsx";
import { Photo } from "../src/components/photo.tsx";
import { images } from "../src/images.ts";

const web = join(import.meta.dirname, "..");
const imageDir = join(web, "content", "images");
const files = readdirSync(imageDir).filter((name) => !name.startsWith("."));
/** Largest file the site may serve for one photo. */
const budget = 100 * 1024;

/** Width and height from a lossy WebP's VP8 frame header. */
function webpSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.toString("ascii", 8, 16)).toBe("WEBPVP8 ");
  return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
}

const skip = new Set(["node_modules", "dist", "test-results", "playwright-report", "coverage"]);
function allFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || skip.has(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? allFiles(path) : [path];
  });
}

describe("photos", () => {
  it("CONTENT-R22 every photo is a WebP file within the size budget", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      expect(name, name).toMatch(/^[a-z0-9-]+-\d+\.webp$/);
      expect(readFileSync(join(imageDir, name)).length, name).toBeLessThanOrEqual(budget);
    }
  });

  it("CONTENT-R22 no unconverted photo is left in the app", () => {
    const raw = allFiles(web)
      .map((path) => relative(web, path))
      .filter((path) => /\.(?:png|jpe?g|gif|bmp|tiff?|heic)$/i.test(path));
    expect(raw).toEqual([]);
  });

  it.each(Object.entries(images))(
    "CONTENT-R22 %s lists every width it has, with the size of its largest file",
    (name, image) => {
      const own = files.filter((file) => file.startsWith(`${name}-`));
      const widths = own.map((file) => webpSize(join(imageDir, file)).width).sort((a, b) => a - b);
      const declared = [...image.srcSet.matchAll(/ (\d+)w/g)].map(([, w]) => Number(w));
      expect(declared).toEqual(widths);
      for (const file of own) {
        expect(Number(/-(\d+)\.webp$/.exec(file)?.[1]), file).toBe(
          webpSize(join(imageDir, file)).width,
        );
      }
      const largest = webpSize(join(imageDir, `${name}-${widths.at(-1)}.webp`));
      expect({ width: image.width, height: image.height }).toEqual(largest);
      expect(image.alt.trim()).not.toBe("");
      expect(image.placeholder).toMatch(/^data:image\/webp;base64,/);
      expect(image.placeholder.length).toBeLessThan(400);
    },
  );

  it("CONTENT-R22 a photo reserves its space, loads lazily and shows a placeholder", () => {
    const html = renderToStaticMarkup(<Photo image={images.rack} sizes="42rem" />);
    expect(html).toContain('width="1446"');
    expect(html).toContain('height="1088"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('sizes="42rem"');
    expect(html).toMatch(/srcSet="[^"]+ 720w, [^"]+ 1446w"/i);
    expect(html).toContain(`alt="${images.rack.alt}"`);
    expect(html).toContain("background-image:url(&quot;data:image/webp;base64,");
  });

  it("CONTENT-R22 a photo on the first screen loads eagerly", () => {
    const html = renderToStaticMarkup(<Photo image={images.me} sizes="11rem" eager />);
    expect(html).toContain('loading="eager"');
  });

  it("CONTENT-R22 copy shows a photo by name, with a caption", () => {
    const html = renderToStaticMarkup(<Figure image="rack" caption="The rack." />);
    expect(html).toMatch(/^<figure data-figure="true"[^>]*><img data-photo="true"/);
    expect(html).toContain("<figcaption");
    expect(html).toContain("The rack.</figcaption>");
  });
});
