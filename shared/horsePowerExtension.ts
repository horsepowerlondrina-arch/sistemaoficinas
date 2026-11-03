export const HORSE_POWER_EXTENSION_TENANT_ID = "59c85eea-7112-40de-b77f-c5627c541b48";

export function horsePowerExtensionEnabled(tenantId: string): boolean {
  return tenantId === HORSE_POWER_EXTENSION_TENANT_ID;
}
