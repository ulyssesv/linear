// The site's photos (CONTENT-R22). Each source was converted once to WebP at the widths its
// layout needs, kept in apps/web/content/images next to the copy; Vite serves them from
// /assets with a content hash. The placeholder is a tiny WebP of the same photo, shown
// blurred behind the image until it loads.
import me160 from "../content/images/me-160.webp";
import me281 from "../content/images/me-281.webp";
import rack720 from "../content/images/rack-720.webp";
import rack1446 from "../content/images/rack-1446.webp";

export type SiteImage = {
  /** The smallest width, for browsers that ignore srcset. */
  src: string;
  srcSet: string;
  /** Intrinsic size of the largest file, so the layout reserves the space (no shift). */
  width: number;
  height: number;
  alt: string;
  placeholder: string;
};

export const images = {
  rack: {
    src: rack720,
    srcSet: `${rack720} 720w, ${rack1446} 1446w`,
    width: 1446,
    height: 1088,
    alt: "The rack the site runs on: UniFi gateway and switch, a Lenovo ThinkCentre mini PC and a UniFi UPS, cabled with blue-lit ports.",
    placeholder:
      "data:image/webp;base64,UklGRqoAAABXRUJQVlA4IJ4AAADwBACdASoYABMAPu1osVAppiUiqAqpMB2JZQDG9BEYtfEvggKWI9UH9WT6Pc50O0AA/ielqC3nCg3snZzo9tcKFVmxEu1QDfADxXGQ36EBPVysjoyN0m5Y/PiU6CwYbrcRK5tzcd3uLmoT1ZXo4o4OEGQr0wM3aOAOqz1CfPqAbTQ34/b7jwlLhM3YU7MQM9AA+E96Nl52ik1YAAAAAA==",
  },
  me: {
    src: me160,
    srcSet: `${me160} 160w, ${me281} 281w`,
    width: 281,
    height: 784,
    alt: "Ulysses standing on a hillside below snow-covered mountains.",
    placeholder:
      "data:image/webp;base64,UklGRooAAABXRUJQVlA4IH4AAACQAwCdASoMACIAPt1cpU2opSOiNUgBEBuJSl8p2ZIvhMUcjZgAAP1GXj6wf1zs6d+zqfb2A1pNe+V1TkwWtFVY7LzGJKvIjEere3Sc6C3uNV4YdWrtXUHAmUJPNJJkwQjGb5QBIMUvkd/+wB3AiUPKzLSNag5qC/OmXj8sEAA=",
  },
} as const satisfies Record<string, SiteImage>;

export type ImageName = keyof typeof images;
