import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppContext } from "../src/lib/context";
import { OrderView } from "../src/pages/OrderView";
import type { Order } from "../src/lib/types";

const baseOrder = (overrides: Partial<Order> = {}): Order => ({
  id: "order-test",
  number: 42,
  status: "open",
  kind: "order",
  display_status: "open",
  customer_id: "customer-test",
  vehicle_id: "vehicle-test",
  customer_name: "Cliente Fictício",
  plate: "ABC1D23",
  brand: "Honda",
  model: "Civic",
  entered_on: "2026-10-10",
  due_on: "2026-10-20",
  km: 45000,
  problem: "",
  notes: "",
  discount: 0,
  total: 125000,
  items: [],
  ...overrides,
});

function renderOrder(order: Order, options: { role?: string; vehicle?: Record<string, any>; modules?: Record<string, boolean> } = {}) {
  const context: any = {
    session: {
      role: options.role || "owner",
      modules: options.modules,
      user: { id: "user-test", name: "Admin Teste", email: "admin@example.test" },
      tenant: { id: "tenant-test", name: "Oficina Fictícia" },
      tenants: [],
    },
    data: {
      orders: [order],
      customers: [{ id: "customer-test", name: "Cliente do Cadastro" }],
      vehicles: options.vehicle ? [{ id: "vehicle-test", ...options.vehicle }] : [],
      catalog: [],
      professionals: [],
      receivables: [],
      cash: [],
      installments: [],
    },
    refresh: async () => {},
    notify: () => {},
  };
  return renderToStaticMarkup(
    h(AppContext.Provider, {
      value: context,
      children: h(MemoryRouter, {
        initialEntries: ["/ordens/order-test"],
        children: h(Routes, {
          children: h(Route, { path: "/ordens/:id", element: h(OrderView) }),
        }),
      }),
    }),
  );
}

test("OS details show the requested vehicle and order summary and keep issue controls with OS actions", () => {
  const html = renderOrder(baseOrder(), {
    vehicle: { manufacture_year: 2020, model_year: 2021, engine: "2.0 Flex", km: 45000 },
  });

  for (const value of [
    "Detalhes da OS",
    "#42",
    "ABC1D23",
    "Cliente Fictício",
    "Honda",
    "Civic",
    "2.0 Flex",
    "2020 / 2021",
    "45.000 km",
    "10/10",
    "20/10",
    "Aberta",
    "R$ 1.250,00",
  ]) assert.ok(html.includes(value), `Expected order details to show ${value}`);

  assert.doesNotMatch(html, /Documento emitido|Emissões são imutáveis/);
  const title = html.indexOf("<h1>Detalhes da OS</h1>");
  const actionsStart = html.indexOf('class="no-print order-view-toolbar"');
  assert.ok(title >= 0 && title < actionsStart, "The title stays independent from the action row");
  const actionLabels = [
    "Checklist de entrada",
    "WhatsApp",
    "Alterar status",
    "Imprimir PDF",
    "Editar atendimento",
    "Iniciar execução",
  ];
  const positions = actionLabels.map((label) => html.indexOf(label));
  assert.ok(positions.every((position) => position > actionsStart));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.doesNotMatch(html, /Reimprimir revisão|Emitir e imprimir|Emitir nova revisão com dados atuais|Revisão \\d/);

  const quoteHtml = renderOrder(baseOrder({ status: "quote" }));
  const quoteActionsStart = quoteHtml.indexOf('class="no-print order-view-toolbar"');
  const quoteLabels = [
    "Checklist de entrada",
    "WhatsApp",
    "Alterar status",
    "Imprimir PDF",
    "Editar atendimento",
    "Aprovar OS",
  ];
  const quotePositions = quoteLabels.map((label) => quoteHtml.indexOf(label));
  assert.ok(quotePositions.every((position) => position > quoteActionsStart));
  assert.deepEqual(quotePositions, [...quotePositions].sort((a, b) => a - b));
  assert.doesNotMatch(quoteHtml, /Reimprimir revisão|Emitir e imprimir|Emitir nova revisão com dados atuais|Revisão \\d/);
});

test("missing vehicle and order values display Não informado", () => {
  const html = renderOrder(baseOrder({
    customer_name: "",
    plate: "",
    brand: "",
    model: "",
    entered_on: "",
    due_on: "",
    km: 0,
  }), { vehicle: {} });

  assert.match(html, /Não informado/);
  assert.match(html, /Ano fabricação \/ modelo/);
  assert.match(html, /Previsão de entrega/);
});

test("order total remains hidden from non-owner roles", () => {
  const html = renderOrder(baseOrder(), { role: "operator", vehicle: {} });
  assert.doesNotMatch(html, /Valor total|R\$ 1\.250,00/);
});

test("owner can change a completed OS status; mechanic cannot", () => {
  const completed = baseOrder({ status: "completed", receivable_id: "receivable-test" });
  const ownerHtml = renderOrder(completed);
  assert.match(ownerHtml, /Alterar status/);
  assert.match(ownerHtml, /Receber OS/);
  const mechanicHtml = renderOrder(completed, { role: "operator" });
  assert.doesNotMatch(mechanicHtml, /Alterar status/);
});

test("plano Básico mantém OS finalizada e oferece recebimento apenas ao administrador", () => {
  const pending = renderOrder(baseOrder({
    status: "completed", display_status: "completed", payment_status: "open",
  }), { modules: { orders: true, finance: false } });
  assert.match(pending, /Finalizada/);
  assert.match(pending, /Recebimento/);
  assert.match(pending, /Pendente/);
  assert.match(pending, /Registrar recebimento/);
  assert.doesNotMatch(pending, /Receber OS|Ver recebimento/);

  const received = renderOrder(baseOrder({
    status: "completed", display_status: "completed", payment_status: "paid",
    payment_method: "Pix", payment_paid_at: "2026-11-10T12:00:00Z",
  }), { modules: { orders: true, finance: false } });
  assert.match(received, /Recebido em 10\/11.*Pix/);
  assert.doesNotMatch(received, /Registrar recebimento/);

  const operator = renderOrder(baseOrder({
    status: "completed", display_status: "completed", payment_status: "open",
  }), { role: "operator", modules: { orders: true, finance: false } });
  assert.doesNotMatch(operator, /Registrar recebimento|Valor total/);
});

test("service and parts totals appear beneath their respective item lists", () => {
  const html = renderOrder(baseOrder({
    items: [
      { id: "service-1", kind: "service", name: "Alinhamento", quantity: 1, price: 8000 },
      { id: "service-2", kind: "service", name: "Balanceamento", quantity: 2, price: 2000 },
      { id: "part-1", kind: "product", name: "Peça de teste", quantity: 1, price: 3500 },
    ] as Order["items"],
  }));
  const service = html.slice(html.indexOf("<h2>Serviços"), html.indexOf("<h2>Produtos e peças"));
  const products = html.slice(html.indexOf("<h2>Produtos e peças"), html.indexOf("<h2>Observações para a equipe"));
  assert.ok(service.indexOf("Balanceamento") < service.indexOf("Total de serviços"));
  assert.match(service, /Total de serviços.*R\$\s?120,00/);
  assert.ok(products.indexOf("Peça de teste") < products.indexOf("Total de peças"));
  assert.match(products, /Total de peças.*R\$\s?35,00/);
  const operator = renderOrder(baseOrder({ items: [{ id: "part-1", kind: "product", name: "Peça", quantity: 1, price: 3500 }] as Order["items"] }), { role: "operator" });
  assert.doesNotMatch(operator, /Total de peças|R\$\s?35,00/);
});
