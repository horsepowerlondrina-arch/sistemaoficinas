import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppContext } from "../src/lib/context";
import { Orders } from "../src/pages/Orders";
import { OrderTable } from "../src/components/OrderTable";
import type { Order } from "../src/lib/types";
import { isOrderOverdue, sortOrderList } from "../src/lib/orderList";

const order = (overrides: Partial<Order> = {}): Order => ({
  id: "os-1",
  number: 1,
  status: "open",
  kind: "order",
  display_status: "open",
  customer_id: "customer-1",
  vehicle_id: "vehicle-1",
  customer_name: "Cliente Teste",
  plate: "ABC1D23",
  brand: "Honda",
  model: "Civic",
  entered_on: "2026-10-10",
  due_on: "2026-10-12",
  km: 100,
  problem: "",
  notes: "",
  discount: 0,
  total: 125000,
  items: [],
  ...overrides,
});

function renderOrderTable(orders: Order[], role = "owner") {
  return renderToStaticMarkup(
    h(AppContext.Provider, {
      value: { session: { role } } as any,
      children: h(MemoryRouter, { children: h(OrderTable, { orders }) }),
    }),
  );
}

function renderOrders(role = "owner") {
  const context: any = {
    session: {
      role,
      user: { id: "user", name: "Admin", email: "admin@example.test" },
      tenant: { id: "tenant", name: "Oficina Teste" },
      tenants: [],
    },
    data: {
      orders: [order()],
      customers: [],
      vehicles: [],
      catalog: [],
      professionals: [],
      receivables: [],
      cash: [],
      installments: [],
    },
    notify: () => {},
  };
  return renderToStaticMarkup(
    h(AppContext.Provider, {
      value: context,
      children: h(MemoryRouter, {
        initialEntries: ["/ordens"],
        children: h(Routes, {
          children: h(Route, { path: "/ordens", element: h(Orders) }),
        }),
      }),
    }),
  );
}

test("orders search stays visible and all filter controls are in one closed-by-default details panel", () => {
  const html = renderOrders();
  const searchIndex = html.indexOf('placeholder="Buscar cliente, placa ou número..."');
  const panelIndex = html.indexOf('<details class="order-filter-panel">');
  assert.ok(searchIndex >= 0 && searchIndex < panelIndex);
  assert.ok(html.slice(panelIndex).includes("Filtros da consulta"));
  assert.match(html.slice(panelIndex), /Status da OS/);
  assert.match(html.slice(panelIndex), /Filtrar período por/);
  assert.match(html.slice(panelIndex), /type="date"/);
  assert.doesNotMatch(html.slice(panelIndex, html.indexOf("</details>", panelIndex)), /<details[^>]*open/);
});

test("orders table has requested columns, sorting controls, row navigation and mobile cards", () => {
  const html = renderOrderTable([order()]);
  const headers = ["OS / Cliente", "Veículo / Placa", "Abertura", "Previsão de entrega", "Status", "Valor"];
  let prior = -1;
  for (const header of headers) {
    const next = html.indexOf(header);
    assert.ok(next > prior, `Expected column ${header} in order`);
    prior = next;
  }
  assert.match(html, /order-sort-button/);
  assert.match(html, /<tr[^>]*role="link"[^>]*tabindex="0"/);
  assert.match(html, /class="orders-mobile-list"/);
  assert.match(html, /OS #1 · Cliente Teste/);
  assert.ok(html.includes("10/10/2026") && html.includes("12/10/2026"));
});

test("non-owner order lists do not expose order values", () => {
  const html = renderOrderTable([order()], "operator");
  assert.doesNotMatch(html, />Valor</);
  assert.doesNotMatch(html, /data-label="Valor"/);
  assert.match(html, /class="order-list-table order-list-table-no-value"/);
});

test("sort controls order OS numbers, vehicles, statuses, dates and amounts", () => {
  const low = order({ id: "low", number: 2, brand: "Chevrolet", status: "open", display_status: "open", entered_on: "2026-10-01", due_on: "2026-10-03", total: 100 });
  const high = order({ id: "high", number: 10, brand: "Honda", status: "ready", display_status: "ready", entered_on: "2026-10-04", due_on: "2026-10-05", total: 900 });
  assert.deepEqual(sortOrderList([low, high], "number", "asc").map((item) => item.id), ["low", "high"]);
  assert.deepEqual(sortOrderList([low, high], "vehicle", "asc").map((item) => item.id), ["low", "high"]);
  assert.deepEqual(sortOrderList([low, high], "status", "asc").map((item) => item.id), ["low", "high"]);
  assert.deepEqual(sortOrderList([high, low], "opening", "asc").map((item) => item.id), ["low", "high"]);
  assert.deepEqual(sortOrderList([low, high], "due", "desc").map((item) => item.id), ["high", "low"]);
  assert.deepEqual(sortOrderList([low, high], "total", "desc").map((item) => item.id), ["high", "low"]);
});

test("only overdue delivery dates on unfinished, uncancelled OS are marked", () => {
  assert.equal(isOrderOverdue(order({ due_on: "2026-10-13" }), "2026-10-14"), true);
  assert.equal(isOrderOverdue(order({ due_on: "2026-10-14" }), "2026-10-14"), false);
  assert.equal(isOrderOverdue(order({ status: "completed", due_on: "2026-10-01" }), "2026-10-14"), false);
  assert.equal(isOrderOverdue(order({ status: "cancelled", due_on: "2026-10-01" }), "2026-10-14"), false);
  assert.equal(isOrderOverdue(order({ status: "working", due_on: "2026-10-13" }), "2026-10-14"), true);
});
