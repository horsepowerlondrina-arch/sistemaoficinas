export type OrderVehicleOption = {
  id: string;
  customer_id?: string;
  active?: boolean | number;
  plate?: string;
  brand?: string;
  model?: string;
  year?: number;
  km?: number;
};

export function orderVehiclesForCustomer<T extends { id: string }>(
  vehicles: T[],
  customerId: string,
  selectedVehicleId = "",
): T[] {
  return vehicles.filter((vehicle) => {
    const option = vehicle as T & OrderVehicleOption;
    return (
      option.customer_id === customerId &&
      (!!option.active || option.id === selectedVehicleId)
    );
  });
}

export function selectOrderCustomer(customerId: string) {
  return { customer_id: customerId, vehicle_id: "" };
}

export function selectOrderVehicleFromCard<T extends { id: string }>(
  vehicle: T,
) {
  const option = vehicle as T & OrderVehicleOption;
  return {
    vehicle_id: option.id,
    plate: option.plate || "",
    brand: option.brand || "",
    model: option.model || "",
    year: option.year || 0,
    km: option.km || 0,
  };
}
