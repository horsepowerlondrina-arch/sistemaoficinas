export function shouldShowWorkshopServices(mode: string, vehicleOnly: boolean) {
  return !vehicleOnly && mode === "manual";
}

export function shouldShowVehicleCatalog(mode: string, vehicleOnly: boolean, enabled: boolean) {
  return enabled && (vehicleOnly || mode === "catalog");
}
