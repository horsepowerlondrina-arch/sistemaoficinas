undefined
export function shouldLoadRepairServiceSearch(
  mode: string,
  vehicleOnly: boolean,
  modelId: string,
  serviceOpen: boolean,
) {
  if (vehicleOnly) return false;
  return mode === "manual" || (!!modelId && serviceOpen);
}
