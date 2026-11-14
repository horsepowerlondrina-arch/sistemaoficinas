import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWorkshopNavigation } from "../src/lib/workshopNavigation";
import type { Session } from "../src/lib/types";

const session = (overrides: Partial<Session> = {}) => ({
  role: "owner",
  user: { id: "user-a", name: "Pessoa Fictícia", email: "ficticia@example.test" },
  tenant: { id: "office-a", name: "Oficina Fictícia A" },
  tenants: [],
  support_available: true,
  ...overrides,
} as Session);

const paths = (value: ReturnType<typeof visibleWorkshopNavigation>) => [
  ...value.groups.flatMap((group) => group.items.map((item) => item.path)),
  ...value.footer.map((item) => item.path),
];

test("Início e menu compartilham todos os destinos disponíveis ao proprietário", () => {
  assert.deepEqual(paths(visibleWorkshopNavigation(session())), [
    "/dashboard", "/ordens", "/checklists",
    "/cadastros", "/catalogo", "/servicos", "/profissionais", "/fornecedores",
    "/resultados", "/estoque", "/financeiro", "/suporte", "/configuracoes",
  ]);
});

test("oficina sem acesso administrativo vê apenas os mesmos destinos operacionais", () => {
  const visible = visibleWorkshopNavigation(session({ role: "mechanic" }));
  assert.deepEqual(visible.groups.map((group) => group.title), ["OPERAÇÃO"]);
  assert.deepEqual(paths(visible), ["/ordens", "/suporte"]);
});

test("módulos desligados não aparecem nos atalhos nem no menu", () => {
  const visible = visibleWorkshopNavigation(session({
    support_available: false,
    modules: { orders: false, catalog: false, inventory: false },
  }));
  const links = paths(visible);
  for (const path of ["/ordens", "/resultados", "/catalogo", "/servicos", "/estoque", "/suporte"])
    assert.equal(links.includes(path), false, path);
  assert.equal(links.includes("/configuracoes"), true);
});

test("acesso exclusivo ao catálogo técnico mantém apenas Serviços", () => {
  const visible = visibleWorkshopNavigation(session({
    access: { permissions: { "technical.view": true } } as Session["access"],
    modules: { catalog: false, technical_catalog: true },
    support_available: false,
  }));
  assert.deepEqual(paths(visible), ["/servicos"]);
});
