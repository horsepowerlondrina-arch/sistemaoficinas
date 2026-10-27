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

function renderOrder(order: Order, options: { role?: string; vehicle?: Record<string, any> } = {}) {
  const context: any = {
    session: {
      role: options.role || "owner",
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
    "10/10/2026",
    "20/10/2026",
    "Aberta",
    "R$ 1.250,00",
  ]) assert.ok(html.includes(value), `Expected order details to show ${value}`);

  assert.match(html, /Emitir e imprimir \/ PDF/);
  assert.doesNotMatch(html, /Documento emitido|Emissões são imutáveis/);
  const actionsStart = html.indexOf("Checklist de entrada");
  const issueAction = html.indexOf("Emitir e imprimir / PDF");
  const actionsEnd = html.indexOf("</div>", actionsStart);
  assert.ok(actionsStart >= 0 && issueAction > actionsStart && issueAction < actionsEnd);
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
