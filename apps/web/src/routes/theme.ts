import { createFileRoute } from "@tanstack/react-router";
import { handleSetTheme } from "@/server/theme";

// Sets the theme cookie from the header's theme control (CONTENT-R18). POST only.
export const Route = createFileRoute("/theme")({
  server: { handlers: { POST: ({ request }) => handleSetTheme(request) } },
});
