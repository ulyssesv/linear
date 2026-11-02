import type { SiteImage } from "@/images";
import { cn } from "@/lib/utils";

/**
 * One photo (CONTENT-R22): WebP at the widths in its srcset, width and height set so the
 * page does not shift, a blurred placeholder until it loads, and lazy loading unless it is
 * on the first screen.
 */
export function Photo({
  image,
  sizes,
  eager = false,
  className,
}: Readonly<{ image: SiteImage; sizes: string; eager?: boolean; className?: string }>) {
  return (
    <img
      data-photo
      src={image.src}
      srcSet={image.srcSet}
      sizes={sizes}
      width={image.width}
      height={image.height}
      alt={image.alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={cn("h-auto w-full rounded-lg border bg-muted bg-cover", className)}
      style={{ backgroundImage: `url("${image.placeholder}")` }}
    />
  );
}
