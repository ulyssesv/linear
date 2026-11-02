import { useRouter } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "@/components/icons";
import { type Theme, themePath } from "@/theme";

const options = [
  { value: "light", label: "Light theme", Icon: SunIcon },
  { value: "dark", label: "Dark theme", Icon: MoonIcon },
  { value: "system", label: "System theme", Icon: MonitorIcon },
] as const satisfies readonly { value: Theme; label: string; Icon: unknown }[];

// The theme control in the header (CONTENT-R18): light, dark or system. A plain form that
// posts to /theme and comes back to this page, so it works without JavaScript; with
// JavaScript it posts in the background and re-renders in place.
export function ThemeControl({ theme, href }: Readonly<{ theme: Theme; href: string }>) {
  const router = useRouter();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (!(submitter instanceof HTMLButtonElement)) return;
    event.preventDefault();
    const body = new FormData(event.currentTarget, submitter);
    await fetch(themePath, { method: "POST", body, redirect: "manual" });
    await router.invalidate();
  }

  return (
    <form
      method="post"
      action={themePath}
      aria-label="Theme"
      onSubmit={onSubmit}
      className="flex items-center rounded-md border p-0.5"
    >
      <input type="hidden" name="next" value={href} />
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="submit"
          name="theme"
          value={value}
          aria-label={label}
          aria-pressed={theme === value}
          title={label}
          className="grid size-6 place-items-center rounded-[5px] text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground"
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </form>
  );
}
