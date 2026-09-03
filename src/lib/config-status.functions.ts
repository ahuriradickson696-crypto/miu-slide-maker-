import { createServerFn } from "@tanstack/react-start";
import { getConfigStatus } from "@/lib/config-status";

// Booleans only — never leak actual env var values to the client, just
// whether each optional integration is wired up.
export const getPublicConfigStatus = createServerFn({ method: "GET" }).handler(async () => {
  return getConfigStatus();
});
