import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AppContext } from "../src/lib/context";
import { OrderEditor } from "../src/pages/OrderEditor";
import { ServiceExecutionFields } from "../src/components/RepairServicePicker";

const customer = {
  id: "c",
  name: "Cliente Nome Completo",
  phone: "(43) 99999-1111",
  active: 1,
};
const vehicle = {
  id: "v",
  customer_id: "c",
  plate: "ABC1D23",
  brand: "Marca",
  model: "Modelo",
  km: 1234,
  active: 1,
};
function render(path: string, order?: Record<string, unknown>) {
  const context: any = {
    session: {
      role: "owner",
      user: { name: "Admin" },
      tenant: { id: "t", name: "Oficina" },
    },
    data: {
      customers: [customer],
      vehicles: [vehicle],
      orders: order ? [order] : [],
      catalog: [],
      professionals: [],
    },
    refresh: async () => {},
    notify: () => {},
  };
  return renderToStaticMarkup(
    h(
      AppContext.Provider,
      { value: context },
      h(
        MemoryRouter,
        { initialEntries: [path] },
        h(
          Routes,
          null,
          h(Route, { path: "/ordens/:id", element: h(OrderEditor) }),
        ),
      ),
    ),
  );
}
test("new quote and OS open directly with customer and plate fields in order", () => {
  for (const path of ["/ordens/nova?status=quote", "/ordens/nova"]) {
    const html = render(path);
    assert.doesNotMatch(html, /Continuar sem informar a placa/);
    assert.doesNotMatch(html, /Qual é a placa do veículo/);
    const fields = [
      "Nome do cliente",
      "Placa",
      "Marca do veículo",
      "Modelo do veículo",
      "Ano fabricação/modelo",
      "Quilometragem",
      "Telefone / WhatsApp",
    ];
    let previousIndex = -1;
    for (const field of fields) {
      const index = html.indexOf(field);
      assert.ok(index > previousIndex, `Expected ${field} in requested order`);
      previousIndex = index;
    }
    assert.match(html, /Salvar atendimento/);
    assert.match(html, /class="button primary">/);
    assert.doesNotMatch(html, /class="button primary" disabled=/);
  }
});
test("editing a linked quote shows its registered customer without a duplicate guest name", () => {
  const html = render("/ordens/o", {
    id: "o",
    status: "quote",
    kind: "quote",
    number: 1,
    customer_id: "c",
    vehicle_id: "v",
    plate: vehicle.plate,
    items: [],
  });
  assert.match(html, /Cliente Nome Completo/);
  assert.match(html, /value="\(43\) 99999-1111"/);
  assert.doesNotMatch(html, /Cadastrar cliente sem sair/);
  assert.doesNotMatch(html, /Sem cliente cadastrado/);
  assert.doesNotMatch(html, /Nome do cliente \(opcional\)/);
  assert.doesNotMatch(html, /Nome para o orçamento/);
  assert.match(html, /value="ABC1D23"/);
});
test("service items retain saved pricing settings without OS execution or billing selectors", () => {
  const html = renderToStaticMarkup(h(ServiceExecutionFields, {
    item: {
      id: "service-item",
      kind: "service",
      name: "Serviço terceirizado",
      price: 6500,
      repair_service_id: "catalog-service",
      repair_model_id: "catalog-model",
      commercial_category_id: "premium",
      service_execution: "outsourced",
      service_cost: 5000,
      service_details: {
        commercial_category_id: "premium",
        execution: "outsourced",
        cost: 5000,
        markup_bps: 3000,
        hourly_rate: 18000,
        minutes: 30,
      },
    },
    onChange: () => {},
  }));
  assert.doesNotMatch(html, /Porte de cobrança nesta OS/);
  assert.doesNotMatch(html, /Execução nesta OS/);
  assert.match(html, /Custo do terceiro/);
  assert.match(html, /value="50"/);
});

test("a guest quote preserves optional name and vehicle with a single plate input", () => {
  const html = render("/ordens/o", {
    id: "o",
    status: "quote",
    kind: "quote",
    number: 1,
    guest_name: "Nome completo avulso",
    guest_plate: "DEF4G56",
    guest_vehicle: "Veículo avulso",
    items: [],
  });
  assert.match(html, /value="Nome completo avulso"/);
  assert.match(html, /Telefone \/ WhatsApp \*/);
  assert.match(html, /O cliente será cadastrado ao salvar/);
  assert.match(html, /value="DEF4G56"/);
  assert.match(html, /Marca do veículo \*/);
  assert.match(html, /Modelo do veículo \*/);
  assert.match(html, /Ano fabricação\/modelo \*/);
  assert.match(html, /Cor do veículo/);
  assert.match(html, /Chassi \(se disponível\)/);
  assert.equal((html.match(/value="DEF4G56"/g) || []).length, 1);
  assert.doesNotMatch(html, /Veículo cadastrado \(opcional\)/);
});
test("a saved quote without plate remains available without registering a vehicle", () => {
  const html = render("/ordens/o", {
    id: "o",
    status: "quote",
    kind: "quote",
    number: 1,
    guest_vehicle: "Veículo de exemplo",
    items: [],
  });
  assert.match(html, /value="Veículo de exemplo"/);
  assert.doesNotMatch(html, /Marca do veículo \*/);
});

test("editing a linked OS hides customer vehicle choices and offers explicit editing of its vehicle", () => {
  const html = render("/ordens/o", {
    id: "o",
    status: "quote",
    kind: "quote",
    number: 1,
    customer_id: "c",
    vehicle_id: "v",
    plate: vehicle.plate,
    brand: vehicle.brand,
    model: vehicle.model,
    items: [],
  });

  assert.match(html, /Placa do veículo vinculado/);
  assert.match(html, /value="ABC1D23"/);
  assert.match(html, /value="Marca"/);
  assert.match(html, /value="Modelo"/);
  assert.match(html, /Editar veículo vinculado/);
  assert.doesNotMatch(html, /order-vehicle-cards/);
  assert.doesNotMatch(html, /\+ Novo veículo/);
});
