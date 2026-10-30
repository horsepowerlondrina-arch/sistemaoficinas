import test from "node:test";
import assert from "node:assert/strict";
import { serviceTabFromSearch, technicalLaborPrice, timesRedirectTarget } from "../shared/serviceTabs.js";

test("serviços próprios iniciam a página e /tempos preserva parâmetros úteis", () => {
  assert.equal(serviceTabFromSearch(""), "private");
  assert.equal(serviceTabFromSearch("?aba=tempos"), "times");
  assert.equal(serviceTabFromSearch("?aba=desconhecida"), "private");
  assert.equal(timesRedirectTarget("?q=freio&aba=proprios", "#resultado"), "/servicos?q=freio&aba=tempos#resultado");
});

test("valor técnico usa minutos e tarifa do porte em centavos", () => {
  assert.equal(technicalLaborPrice(90, 12000), 18000);
  assert.equal(technicalLaborPrice(35, 10000), 5833);
  assert.equal(technicalLaborPrice(0, 12000), null);
  assert.equal(technicalLaborPrice(60, 0), null);
});
