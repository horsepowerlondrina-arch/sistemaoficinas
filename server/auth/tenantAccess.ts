const deniedStates = new Set(["pending_verification", "blocked", "archived"]);
const readMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function tenantAccessDecision(state: string, method: string, path: string) {
  if (deniedStates.has(state)) return "unavailable" as const;
  if (state === "read_only" && !readMethods.has(method) && path !== "/logout" && !["/account/billing/checkout","/account/billing/refresh","/account/billing/cancel"].includes(path)) return "read_only" as const;
  return "allow" as const;
}
