import test from "node:test";
import assert from "node:assert/strict";
import {
  automaticFipe,
  candidateFields,
  emptyFipe,
  type FipeCandidate,
} from "../shared/vehicleFipe";
import { lookupFipePlaca } from "../server/services/fipePlaca";
import { lookupVehicle, lookupVehicleExternal } from "../server/services/vehicleLookup";
import { createDatabase } from "../server/db/database";
import { saveOrder } from "../server/services/workshop";
import {
  createChecklist,
  finalizeChecklist,
  updateChecklist,
} from "../server/services/checklists";
import { vehicleFipeFields } from "../server/services/vehicleFipeFields";
import { z } from "zod";
import { normalizeVehicleModelLink, serviceModelIdSchema } from "../server/services/vehicleModelLink";
const candidate: FipeCandidate = {
  codigoFipe: "001235-1",
  modelo: "Modelo 1.0",
  anoModelo: 2021,
  anoId: "2021-1",
  combustivel: "Gasolina",
  confianca: "alta",
  matchAno: true,
  matchCombustivel: null,
};
const vehicle = {
  marca: "Marca",
  modelo: "Modelo",
  anoFabricacao: 2020,
  anoModelo: 2021,
  cor: "Prata",
};
function fixture() {
  const db = createDatabase(":memory:");
  db.exec(
    "INSERT INTO tenants(id,name) VALUES('a','A'),('b','B'); INSERT INTO users(id,name,email,password_hash) VALUES('u','Admin','u@example.invalid','disabled'); INSERT INTO memberships VALUES('u','a','owner'); INSERT INTO customers(id,tenant_id,name) VALUES('c','a','Cliente');",
  );
  return db;
}
test("FIPE requires one compatible high-confidence candidate, preserving ambiguity and null fuel match", () => {
  assert.equal(
    automaticFipe([candidate], 2021).fipe_code,
    candidate.codigoFipe,
  );
  for (const candidates of [
    [candidate, { ...candidate, codigoFipe: null }],
    [{ ...candidate, confianca: "baixa" as const }],
    [{ ...candidate, matchAno: false }],
    [{ ...candidate, matchCombustivel: false }],
  ])
    assert.deepEqual(automaticFipe(candidates, 2021), emptyFipe);
  assert.deepEqual(automaticFipe([candidate], 2020), emptyFipe);
  assert.deepEqual(
    candidateFields({ ...candidate, codigoFipe: null }),
    emptyFipe,
  );
});
test("vehicle lookup calls both paid routes, strips unrelated provider fields and keeps candidates", async () => {
  const calls: string[] = [];
  const result = await lookupFipePlaca(
    "ABC1D23",
    "test-secret",
    (async (url, options) => {
      calls.push(String(url));
      assert.equal(
        (options?.headers as Record<string, string>).Authorization,
        "Bearer test-secret",
      );
      return Response.json(
        String(url).endsWith("/fipe")
          ? [{ ...candidate, valorFipe: "R$ 10.000", proprietario: "discard" }]
          : vehicle,
      );
    }) as typeof fetch,
    true,
  );
  assert.deepEqual(calls, [
    "https://api.fipeplaca.com.br/gateway/v1/placa/ABC1D23",
    "https://api.fipeplaca.com.br/gateway/v1/placa/ABC1D23/fipe",
  ]);
  assert.equal(result.vehicle?.fipe_code, "001235-1");
  assert.ok(!JSON.stringify(result).includes("discard"));
  assert.ok(!JSON.stringify(result).includes("test-secret"));
});
test("FIPE errors preserve paid vehicle data, missing codes and multiple candidates never select silently", async () => {
  for (const response of [
    () => Response.json({ erro: { mensagem: "secret" } }, { status: 402 }),
    () => Response.json([]),
    () => Response.json([candidate, { ...candidate, codigoFipe: null }]),
    () => Response.json([{ unexpected: true }]),
  ]) {
    const result = await lookupFipePlaca(
      "ABC1D23",
      "secret",
      (async (url) =>
        String(url).endsWith("/fipe")
          ? response()
          : Response.json(vehicle)) as typeof fetch,
      true,
    );
    assert.equal(result.vehicle?.brand, "Marca");
    assert.equal(result.vehicle?.fipe_code, "");
    assert.ok(!JSON.stringify(result).includes("secret"));
  }
});
test("persistent cache survives another lookup call, is tenant scoped, expires, and local vehicles avoid provider charges", async () => {
  const db = fixture(),
    prior = process.env.FIPEPLACA_TOKENS_JSON,
    priorAllowlist = process.env.FIPEPLACA_ALLOWED_TENANT_IDS;
  process.env.FIPEPLACA_TOKENS_JSON = JSON.stringify({ a: "fake", b: "fake" });
  process.env.FIPEPLACA_ALLOWED_TENANT_IDS = "a,b";
  let calls = 0;
  const provider = (async (url) => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return Response.json(String(url).endsWith("/fipe") ? [candidate] : vehicle);
  }) as typeof fetch;
  try {
    await Promise.all([
      lookupVehicle(db, "a", "ABC1D23", provider),
      lookupVehicle(db, "a", "ABC1D23", provider),
    ]);
    assert.equal(calls, 2);
    await lookupVehicle(db, "a", "ABC1D23", provider);
    assert.equal(calls, 2);
    await lookupVehicle(db, "b", "ABC1D23", provider);
    assert.equal(calls, 4);
    db.prepare(
      "UPDATE vehicle_lookup_cache SET expires_at=0 WHERE tenant_id='a'",
    ).run();
    await lookupVehicle(db, "a", "ABC1D23", provider);
    assert.equal(calls, 6);
    db.exec(
      "INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year,fipe_code) VALUES('v','a','c','ABC1D23','Marca','Modelo',2021,'001235-1');",
    );
    const serviceModelId = "11111111-1111-4111-8111-111111111111";
    db.prepare("UPDATE vehicles SET service_model_id=? WHERE id='v'").run(serviceModelId);
    const local = await lookupVehicle(db, "a", "ABC1D23", provider);
    assert.equal(calls, 6);
    assert.equal(local.vehicle?.fipe_code, "001235-1");
    assert.equal(local.vehicle?.service_model_id, serviceModelId);
  } finally {
    if (prior === undefined) delete process.env.FIPEPLACA_TOKENS_JSON;
    else process.env.FIPEPLACA_TOKENS_JSON = prior;
    if (priorAllowlist === undefined)
      delete process.env.FIPEPLACA_ALLOWED_TENANT_IDS;
    else process.env.FIPEPLACA_ALLOWED_TENANT_IDS = priorAllowlist;
    db.close();
  }
});
test("new OS vehicle persists FIPE identity and local lookup reuses it", async () => {
  const db = fixture();
  try {
    await saveOrder(
      db,
      { tenantId: "a", userId: "u", role: "owner" },
      {
        customer_id: "c",
        new_vehicle: {
          plate: "ABC1D23",
          brand: "Marca",
          model: "Modelo",
          year: 2021,
          ...candidateFields(candidate),
        },
        status: "quote",
        entered_on: "2026-10-18",
        due_on: "2026-10-18",
        km: 0,
        problem: "",
        notes: "",
        discount: 0,
        items: [],
      },
    );
    const v = db.prepare("SELECT * FROM vehicles WHERE tenant_id='a'").get()!;
    assert.equal(v.fipe_code, "001235-1");
    assert.equal(v.fipe_year_id, "2021-1");
    const result = await lookupVehicle(db, "a", "ABC1D23", (async () => {
      throw new Error("Must not call provider");
    }) as typeof fetch);
    assert.equal(result.vehicle?.fipe_model, "Modelo 1.0");
  } finally {
    db.close();
  }
});
test("checklist preserves selected FIPE through draft and vehicle creation", async () => {
  const db = fixture(),
    ctx = { tenantId: "a", userId: "u", role: "owner" };
  try {
    const draft = await createChecklist(db, ctx, {
      plate: "ABC1D23",
      lookup_source: "external",
      customer_id: "c",
      vehicle_data: {
        brand: "Marca",
        model: "Modelo",
        year: 2021,
        ...candidateFields(candidate),
      },
      inspector: "Responsável",
    });
    const saved = db
      .prepare("SELECT vehicle_data_json FROM checklists WHERE id=?")
      .get(draft.id)!;
    assert.equal(JSON.parse(String(saved.vehicle_data_json)).fipe_code, "001235-1");
    await updateChecklist(db, ctx, draft.id, {
      km: 0,
      fuel_level: 0,
      inspector: "Responsável",
      signature_absent_reason: "Teste sem assinatura",
    });
    await finalizeChecklist(db, ctx, draft.id);
    const vehicle = db
      .prepare(
        "SELECT fipe_code,fipe_model,fipe_year_id,model_year,fuel FROM vehicles WHERE tenant_id='a'",
      )
      .get()!;
    assert.deepEqual({ ...vehicle }, candidateFields(candidate));
  } finally {
    db.close();
  }
});
test("vehicle FIPE validation preserves leading zeroes and rejects malformed codes", () => {
  const schema = z.object(vehicleFipeFields);
  assert.equal(schema.parse(candidateFields(candidate)).fipe_code, "001235-1");
  assert.deepEqual(schema.parse({}), emptyFipe);
  assert.throws(() => schema.parse({ fipe_code: "1235" }));
});

test("consulta explícita de veículo já cadastrado reutiliza cache e só gera prévia sem escrever", async () => {
  const db = fixture();
  const prior = process.env.FIPEPLACA_TOKENS_JSON,
    priorAllowlist = process.env.FIPEPLACA_ALLOWED_TENANT_IDS;
  process.env.FIPEPLACA_TOKENS_JSON = JSON.stringify({ a: "fake", b: "fake" });
  process.env.FIPEPLACA_ALLOWED_TENANT_IDS = "a,b";
  let calls = 0;
  const provider = (async (url) => {
    calls++;
    return Response.json(String(url).endsWith("/fipe") ? [candidate] : { ...vehicle, modelo: "Modelo atualizado" });
  }) as typeof fetch;
  try {
    db.exec("INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year,color) VALUES('v','a','c','ABC1D23','Marca','Modelo antigo',2021,'Azul')");
    const local = await lookupVehicle(db, "a", "ABC1D23", provider);
    assert.equal(local.source, "local");
    assert.equal(calls, 0);
    const first = await lookupVehicleExternal(db, "a", "ABC1D23", provider);
    assert.equal(first.source, "external");
    assert.equal(calls, 2);
    const cached = await lookupVehicleExternal(db, "a", "ABC1D23", provider);
    assert.equal(cached.source, "external");
    assert.equal(calls, 2);
    assert.equal(db.prepare("SELECT model FROM vehicles WHERE tenant_id='a' AND id='v'").get()?.model, "Modelo antigo");
    assert.equal((await lookupVehicleExternal(db, "b", "ABC1D23", provider)).source, "external");
    assert.equal(calls, 4);
  } finally {
    if (prior === undefined) delete process.env.FIPEPLACA_TOKENS_JSON;
    else process.env.FIPEPLACA_TOKENS_JSON = prior;
    if (priorAllowlist === undefined)
      delete process.env.FIPEPLACA_ALLOWED_TENANT_IDS;
    else process.env.FIPEPLACA_ALLOWED_TENANT_IDS = priorAllowlist;
    db.close();
  }
});

test("vínculo de modelo trata string vazia legada como ausente e mantém null explícito", () => {
  const modelId = "d6fa2a0d-947c-4f02-b8d6-c1f3af8e79b2";
  assert.equal(serviceModelIdSchema.parse(""), undefined);
  assert.equal(serviceModelIdSchema.parse(null), null);
  assert.equal(serviceModelIdSchema.parse(modelId), modelId);
  assert.throws(() => serviceModelIdSchema.parse("modelo-invalido"));

  const legacy = normalizeVehicleModelLink({
    service_model_id: serviceModelIdSchema.parse(""),
  });
  assert.equal(Object.hasOwn(legacy, "service_model_id"), false);

  const explicitClear = normalizeVehicleModelLink({
    service_model_id: serviceModelIdSchema.parse(null),
  });
  assert.equal(Object.hasOwn(explicitClear, "service_model_id"), true);
  assert.equal(explicitClear.service_model_id, null);
});
