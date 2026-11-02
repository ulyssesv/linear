import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The column every page sits in, inside the shell's <main>. */
export function PageContainer({
  className,
  children,
}: Readonly<{ className?: string; children: ReactNode }>) {
  return <div className={cn("mx-auto w-full max-w-4xl px-6 py-12", className)}>{children}</div>;
}
