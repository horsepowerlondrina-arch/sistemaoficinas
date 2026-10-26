export function shouldShowWorkshopServices(mode: string, vehicleOnly: boolean) {
  return !vehicleOnly && mode === "manual";
}

export function shouldShowVehicleCatalog(mode: string, vehicleOnly: boolean, enabled: boolean) {
  return enabled && (vehicleOnly || mode === "catalog");
}

export function shouldLoadRepairServiceSearch(
  mode: string,
  vehicleOnly: boolean,
  modelId: string,
  serviceOpen: boolean,
) {
  if (vehicleOnly) return false;
  return mode === "manual" || (!!modelId && serviceOpen);
}
