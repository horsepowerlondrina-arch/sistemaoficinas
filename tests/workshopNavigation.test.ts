import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWorkshopNavigation } from "../src/lib/workshopNavigation";
import type { Session } from "../src/lib/types";

const session = (overrides: Partial<Session> = {}) => ({
  role: "owner",
  user: { id: "user-a", name: "Pessoa Fictícia", email: "ficticia@example.test" },
  tenant: { id: "office-a", name: "Oficina Fictícia A" },
  tenants: [],
  ...overrides,
} as Session);

const paths = (value: ReturnType<typeof visibleWorkshopNavigation>) => [
  ...value.groups.flatMap((group) => group.items.map((item) => item.path)),
  ...value.footer.map((item) => item.path),
];

test("Início e menu compartilham todos os destinos disponíveis ao proprietário", () => {
  assert.deepEqual(paths(visibleWorkshopNavigation(session())), [
    "/dashboard", "/checklists", "/ordens",
    "/cadastros", "/catalogo", "/servicos", "/profissionais", "/fornecedores",
    "/agenda", "/estoque", "/financeiro", "/configuracoes",
  ]);
});

test("oficina sem acesso administrativo vê apenas os mesmos destinos operacionais", () => {
  const visible = visibleWorkshopNavigation(session({ role: "mechanic" }));
  assert.deepEqual(visible.groups.map((group) => group.title), ["OPERAÇÃO"]);
  assert.deepEqual(paths(visible), ["/ordens"]);
});

test("módulos desligados não aparecem nos atalhos nem no menu", () => {
  const visible = visibleWorkshopNavigation(session({
    modules: { orders: false, catalog: false, inventory: false },
  }));
  const links = paths(visible);
  for (const path of ["/ordens", "/catalogo", "/servicos", "/estoque"])
    assert.equal(links.includes(path), false, path);
  assert.equal(links.includes("/configuracoes"), true);
});

