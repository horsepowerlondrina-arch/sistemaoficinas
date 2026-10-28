import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { AppContext } from "../src/lib/context";
import { Payment } from "../src/pages/Payment";

test("new receipt plan does not render a stray zero and keeps save actions right-aligned", () => {
  const context: any = {
    session: {
      role: "owner",
      user: { id: "user-test", name: "Admin", email: "admin@example.test" },
      tenant: { id: "tenant-test", name: "Oficina Fictícia" },
      tenants: [],
    },
    data: {
      orders: [{
        id: "order-test",
        number: 12,
        status: "completed",
        kind: "order",
        display_status: "Finalizada",
        customer_id: "customer-test",
        vehicle_id: "vehicle-test",
        customer_name: "Cliente Teste",
        plate: "ABC1D23",
        brand: "Fiat",
        model: "Uno",
        entered_on: "2026-10-27",
        due_on: "2026-10-27",
        km: 1000,
        problem: "",
        notes: "",
        discount: 0,
        total: 58244,
        items: [{ id: "item-test", price: 58244, quantity: 1 }],
      }],
      receivables: [{
        id: "receivable-test",
        order_id: "order-test",
        order_number: 12,
        amount: 58244,
        status: "open",
        plan_configured: 0,
        customer_name: "Cliente Teste",
      }],
      installments: [],
      cash_accounts: [],
      card_rates: [],
      payment_settings: null,
    },
    refresh: async () => {},
    refreshSession: async () => {},
    notify: () => {},
  };

  const html = renderToStaticMarkup(h(AppContext.Provider, {
    value: context,
    children: h(MemoryRouter, {
      initialEntries: ["/ordens/order-test/receber"],
      children: h(Routes, {
        children: h(Route, { path: "/ordens/:id/receber", element: h(Payment) }),
      }),
    }),
  }));

  assert.doesNotMatch(html, />0<\/section>/);
  assert.match(html, /class="receipt-plan-actions">.*Salvar condições de pagamento/);

  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.receipt-plan-actions\s*\{[^}]*justify-content:\s*flex-end/s);
  assert.match(styles, /\.receipt-plan-actions\s*\{[^}]*margin-top:\s*30px/s);
});
