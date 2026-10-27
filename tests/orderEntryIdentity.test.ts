import assert from "node:assert/strict";
import test from "node:test";
import {
  orderVehiclesForCustomer,
  selectOrderCustomer,
  selectOrderVehicleFromCard,
} from "../shared/orderEntryIdentity.js";

const vehicle = (overrides: Partial<{
  id: string;
  customer_id: string;
  active: boolean | number;
  plate: string;
  brand: string;
  model: string;
  year: number;
  km: number;
}> = {}) => ({
  id: "vehicle-1",
  customer_id: "customer-1",
  active: true,
  plate: "ABC1D23",
  brand: "Honda",
  model: "Civic",
  year: 2020,
  km: 42000,
  ...overrides,
});

test("customer selection never chooses a vehicle, including when only one is available", () => {
  const available = orderVehiclesForCustomer(
    [vehicle()],
    "customer-1",
  );
  assert.equal(available.length, 1);
  assert.deepEqual(selectOrderCustomer("customer-1"), {
    customer_id: "customer-1",
    vehicle_id: "",
  });
});

test("customer vehicle cards only include that customer's active vehicles", () => {
  const available = orderVehiclesForCustomer(
    [
      vehicle(),
      vehicle({ id: "vehicle-2", plate: "DEF4G56" }),
      vehicle({ id: "inactive", active: false }),
      vehicle({ id: "other-owner", customer_id: "customer-2" }),
    ],
    "customer-1",
  );
  assert.deepEqual(available.map((item) => item.id), ["vehicle-1", "vehicle-2"]);
});

test("clicking a vehicle card returns its details for the order form", () => {
  assert.deepEqual(selectOrderVehicleFromCard(vehicle()), {
    vehicle_id: "vehicle-1",
    plate: "ABC1D23",
    brand: "Honda",
    model: "Civic",
    year: 2020,
    km: 42000,
  });
});
