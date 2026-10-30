import assert from "node:assert/strict";
import test from "node:test";
import { vehicleDisplayModel, vehicleModelYear } from "../shared/vehicleIdentity";
import { candidateFields } from "../shared/vehicleFipe";

test("FIPE description is primary and old vehicles retain their legacy description", () => {
  assert.equal(vehicleDisplayModel({ model: "Uno antigo", fipe_model: "Uno Mille" }), "Uno Mille");
  assert.equal(vehicleDisplayModel({ model: "Uno antigo", fipe_model: "" }), "Uno antigo");
  assert.equal(vehicleModelYear({ fipe_year_id: "2004-1" }), 2004);
});

test("FIPE candidate keeps fuel and model year independent from technical model", () => {
  assert.deepEqual(candidateFields({ codigoFipe: "001109-6", modelo: "Brava SX", anoModelo: 2002, anoId: "2002-1", combustivel: "Gasolina", confianca: "alta", matchAno: true, matchCombustivel: true }), {
    fipe_code: "001109-6", fipe_model: "Brava SX", fipe_year_id: "2002-1", model_year: 2002, fuel: "Gasolina",
  });
});
