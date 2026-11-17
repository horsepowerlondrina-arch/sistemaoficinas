import assert from "node:assert/strict";
import test from "node:test";
import { vehicleDisplayModel, vehicleModelYear, mergeVehicleLookup, lookupWouldReplace, lookupWouldReplaceDraft } from "../shared/vehicleIdentity";
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

test("provider omissions preserve manual data and never replace the technical association", () => {
  const current = { brand: "Fiat", model: "Uno", year: 2004, color: "Prata", fuel: "Flex", service_model_id: "manual-model", service_link_mode: "manual" };
  const incoming = { brand: "FIAT", model: "Uno Mille", year: null, color: "", service_model_id: "other" };
  assert.equal(lookupWouldReplace(current, incoming), true);
  assert.deepEqual(mergeVehicleLookup(current, incoming), { ...current, brand: "FIAT", model: "Uno Mille" });
  assert.deepEqual(mergeVehicleLookup(current, null), current);
  assert.equal(lookupWouldReplace({ chassis: "manual" }, { chassis: "provider" }), true);
  assert.equal(lookupWouldReplace({ fipe_year_id: "2020-1" }, { fipe_year_id: "2021-1" }), true);
});

test("a primeira consulta de um veículo novo não trata o ano padrão como dado preenchido", () => {
  const draft = { brand: "", model: "", year: new Date().getFullYear(), color: "", chassis: "" };
  const lookup = { brand: "FIAT", model: "Uno Mille", year: 2004 };
  assert.equal(lookupWouldReplace(draft, lookup), true);
  assert.equal(lookupWouldReplaceDraft(draft, lookup), false);
  assert.equal(lookupWouldReplaceDraft({ ...draft, model: "Outro modelo" }, lookup), true);
  assert.equal(lookupWouldReplaceDraft({ ...draft, year: 2003 }, lookup), true);
});
