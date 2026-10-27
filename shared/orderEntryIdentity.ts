export type OrderVehicleOption = {
  id: string;
  customer_id: string;
  active: boolean | number;
  plate: string;
  brand: string;
  model: string;
  year: number;
  km: number;
};

export function orderVehiclesForCustomer<T extends OrderVehicleOption>(
  vehicles: T[],
  customerId: string,
  selectedVehicleId = "",
): T[] {
  return vehicles.filter(
    (vehicle) =>
      vehicle.customer_id === customerId &&
      (!!vehicle.active || vehicle.id === selectedVehicleId),
  );
}

export function selectOrderCustomer(customerId: string) {
  return { customer_id: customerId, vehicle_id: "" };
}

export function selectOrderVehicleFromCard<T extends OrderVehicleOption>(
  vehicle: T,
) {
  return {
    vehicle_id: vehicle.id,
    plate: vehicle.plate,
    brand: vehicle.brand,
    model: vehicle.model,
    year: vehicle.year,
    km: vehicle.km,
  };
}
