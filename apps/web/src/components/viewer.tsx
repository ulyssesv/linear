import { createContext, useContext } from "react";
import type { SessionUser } from "@/server/auth/sessions";

// The signed-in user for components deep in a page, such as the demo link in content
// files (CONTENT-R12). The root route provides it; without a provider nobody is signed in.
export const ViewerContext = createContext<SessionUser | null>(null);

export function useViewer(): SessionUser | null {
  return useContext(ViewerContext);
}
