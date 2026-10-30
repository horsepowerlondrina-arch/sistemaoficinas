import test from "node:test";
import assert from "node:assert/strict";
import { lookupFipePlaca, fipePlacaToken } from "../server/services/fipePlaca";
const token = "test-only-secret";
test("FipePlaca usa HTTPS, Bearer e retorna apenas dados do cadastro", async () => {
  const result = await lookupFipePlaca("ABC1D23", token, (async (
    url,
    options,
  ) => {
    assert.equal(url, "https://api.fipeplaca.com.br/gateway/v1/placa/ABC1D23");
    assert.equal(options?.method, "GET");
    assert.equal(
      (options?.headers as Record<string, string>).Authorization,
      `Bearer ${token}`,
    );
    assert.equal(options?.redirect, "error");
    return Response.json({
      marca: "Honda",
      modelo: "Fit",
      anoFabricacao: 2020,
      anoModelo: 2021,
      cor: "Preto",
      chassi: "****1234",
      proprietario: "Não importar",
    });
  }) as typeof fetch);
  assert.deepEqual(result.vehicle, {
    plate: "ABC1D23",
    brand: "Honda",
    model: "Fit",
    year: 2020,
    model_year: 2021,
    color: "Preto",
  });
  assert.ok(!JSON.stringify(result).includes(token));
});
test("dados ausentes não inventam ano nem apagam os valores manuais", async () => {
  const result = await lookupFipePlaca("ABC1D23", token, (async () =>
    Response.json({
      marca: null,
      modelo: "Fit",
      anoFabricacao: null,
      anoModelo: null,
      cor: null,
    })) as typeof fetch);
  assert.deepEqual(result.vehicle, { plate: "ABC1D23", model: "Fit" });
});
test("erros do provedor são tratados sem propagar mensagens ou credenciais", async () => {
  for (const [code, status] of [
    ["SEM_SALDO", 402],
    ["CHAVE_INVALIDA", 401],
    ["FORNECEDOR_INDISPONIVEL", 503],
    ["ERRO_403", 403],
  ] as const) {
    await assert.rejects(
      () =>
        lookupFipePlaca("ABC1D23", token, (async () =>
          Response.json(
            { erro: { codigo: code, mensagem: token } },
            { status },
          )) as typeof fetch),
      (e) => e instanceof Error && !e.message.includes(token),
    );
  }
  const result = await lookupFipePlaca("ABC1D23", token, (async () =>
    Response.json(
      { erro: { codigo: "PLACA_NAO_ENCONTRADA" } },
      { status: 404 },
    )) as typeof fetch);
  assert.equal(result.source, "not_found");
  await assert.rejects(
    () =>
      lookupFipePlaca("ABC1D23", token, (async () => {
        throw new Error(token);
      }) as typeof fetch),
    (e) => e instanceof Error && !e.message.includes(token),
  );
});
test("FipePlaca exige allowlist e isola chaves por oficina", () => {
  const priorTokens = process.env.FIPEPLACA_TOKENS_JSON;
  const priorAllowlist = process.env.FIPEPLACA_ALLOWED_TENANT_IDS;
  try {
    process.env.FIPEPLACA_TOKENS_JSON = JSON.stringify({
      a: token,
      b: "other-test-secret",
    });
    delete process.env.FIPEPLACA_ALLOWED_TENANT_IDS;
    assert.equal(fipePlacaToken("a"), null);
    process.env.FIPEPLACA_ALLOWED_TENANT_IDS = " a ";
    assert.equal(fipePlacaToken("a"), token);
    assert.equal(fipePlacaToken("b"), null);
  } finally {
    if (priorTokens === undefined) delete process.env.FIPEPLACA_TOKENS_JSON;
    else process.env.FIPEPLACA_TOKENS_JSON = priorTokens;
    if (priorAllowlist === undefined)
      delete process.env.FIPEPLACA_ALLOWED_TENANT_IDS;
    else process.env.FIPEPLACA_ALLOWED_TENANT_IDS = priorAllowlist;
  }
});
