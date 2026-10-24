type PlatformAdminAvailabilityOptions = {
  development: boolean;
  enabled?: string;
  allowedHosts?: string;
  hostname: string;
};

export function isPlatformAdminAvailable({
  development,
  enabled,
  allowedHosts,
  hostname,
}: PlatformAdminAvailabilityOptions): boolean {
  if (development) return true;
  if (enabled !== "true") return false;

  const host = hostname.trim().toLowerCase();
  if (!host) return false;

  return (allowedHosts || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(host);
}
