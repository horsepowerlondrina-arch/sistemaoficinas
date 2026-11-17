import assert from "node:assert/strict";
import test from "node:test";
import { vehicleDisplayModel, mergeVehicleLookup } from "../shared/vehicleIdentity";
import { candidateFields } from "../shared/vehicleFipe";

test("o modelo detalhado escolhido ocupa o campo canônico e mantém a origem FIPE", () => {
  const vehicle = { model: "Celta Spirit/ LT 1.0 MPFI 8V FlexP. 5p", fipe_model: "Celta Spirit/ LT 1.0 MPFI 8V FlexP. 5p" };
  assert.equal(vehicleDisplayModel(vehicle), vehicle.model);
});

test("a versão FIPE detalhada permanece disponível sem criar outra escolha visível", () => {
  const candidate = candidateFields({
    codigoFipe: "004321-4",
    modelo: "Celta Spirit/ LT 1.0 MPFI 8V FlexP. 5p",
    anoModelo: 2007,
    anoId: "2007-1",
    combustivel: "Flex",
    confianca: "alta",
    matchAno: true,
    matchCombustivel: true,
  });
  const vehicle = mergeVehicleLookup({ model: "CELTA", service_model_id: "existing-link" }, candidate);
  assert.equal(vehicle.fipe_model, "Celta Spirit/ LT 1.0 MPFI 8V FlexP. 5p");
  assert.equal(vehicle.service_model_id, "existing-link");
});
