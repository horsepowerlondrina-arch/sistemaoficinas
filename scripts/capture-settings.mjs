import { expect } from "@playwright/test";
export async function captureSettings(page, entry) {
  if (entry.module !== "14-configuracoes") return;
  await expect(
    page.getByRole("heading", { name: "Configurações", exact: true }),
  ).toBeVisible();
  if (entry.route.includes("aba=conta")) {
    await expect(page.locator('[data-settings-tab="conta"]')).toHaveText("Conta");
    await expect(page.getByRole("heading",{name:"Administrador da conta"})).toBeVisible();
    await expect(page.getByRole("heading",{name:"Plano da oficina"})).toBeVisible();
    await expect(page.getByRole("button",{name:"Enviar link para alterar senha"})).toBeEnabled();
    const checkout = page.getByRole("button",{name:"Continuar para o pagamento"});
    if (await checkout.count()) {
      await expect(checkout).toBeDisabled();
      await expect(page.getByText("Mensalidade:",{exact:false})).toBeVisible();
    } else {
      await expect(page.getByText("A contratação online ainda não está disponível.",{exact:false})).toBeVisible();
    }
  }
  if (entry.id === "config-dados-oficina-desktop") {
    const name = page.getByRole("textbox", {
      name: "Nome fantasia *",
      exact: true,
    });
    const initial = await name.inputValue();
    await name.fill("Oficina Rascunho Fictícia");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.locator('[data-settings-tab="pecas"]').click();
    await expect(name).toHaveValue("Oficina Rascunho Fictícia");
    await name.fill(initial);
    await page.goto(
      new URL("/configuracoes?aba=inexistente", page.url()).toString(),
    );
    await expect(page.locator('[data-settings-tab="oficina"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
  if (entry.id === "config-lucro-pecas-desktop") {
    const response = await page.request.get(
      new URL("/api/workspace", page.url()).toString(),
    );
    const workspace = await response.json();
    const route = (route) =>
      route.fulfill({
        json: {
          ...workspace,
          parts_pricing: {
            ...workspace.parts_pricing,
            mode: "margin",
            rate_bps: 2500,
          },
        },
      });
    await page.route("**/api/workspace", route);
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Regra de preço das peças" }),
    ).toHaveValue("margin");
    let submitted;
    const saveRoute = async (route) => {
      submitted = route.request().postDataJSON();
      await route.fulfill({ json: { ok: true } });
    };
    await page.route("**/api/parts-pricing", saveRoute);
    await page
      .getByRole("button", { name: "Salvar política de preços" })
      .click();
    await expect.poll(() => submitted?.mode).toBe("margin");
    expect(submitted.rate_bps).toBe(2500);
    await page.unroute("**/api/parts-pricing", saveRoute);
    await page.unroute("**/api/workspace", route);
    await page.reload();
    await validateProfitTables(page);
  }
  if (entry.id === "config-dados-oficina") {
    const dates = await page
      .locator(".profile-document-preview .hp-print-dates")
      .boundingBox();
    const totals = await page
      .locator(".profile-document-preview .hp-print-totalbox")
      .boundingBox();
    expect(dates).not.toBeNull();
    expect(totals).not.toBeNull();
    expect(totals.y).toBeGreaterThanOrEqual(dates.y + dates.height);
    const monogram = await page
      .locator(".profile-document-preview .document-monogram")
      .boundingBox();
    const company = await page
      .locator(".profile-document-preview .document-company")
      .boundingBox();
    if (monogram && company)
      expect(company.x).toBeGreaterThanOrEqual(monogram.x + monogram.width);
  }
  if (entry.route.includes("aba=servicos"))
    await expect(
      page.getByRole("button", { name: "Salvar valores da hora" }),
    ).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

async function validateProfitTables(page) {
  const origin = new URL(page.url()).origin;
  if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
    throw new Error("OPS-003 exige ambiente isolado local");
  const original = (
    await (await page.request.get(origin + "/api/workspace")).json()
  ).parts_pricing;
  try {
    await page
      .getByRole("button", {
        name: "Adicionar faixa de terceiros",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Lucro de terceiros faixa 1", { exact: true })
      .fill("50");
    await page
      .getByLabel("Lucro de terceiros faixa 2", { exact: true })
      .fill("10");
    await expect(page.getByTestId("service-price-simulation")).toContainText(
      "110,00",
    );
    await page
      .getByLabel("Custo inicial de terceiros faixa 2", { exact: true })
      .fill("100.01");
    await expect(
      page.getByRole("alert").filter({ hasText: "lacuna" }).first(),
    ).toBeVisible();
    await page
      .getByLabel("Custo inicial de terceiros faixa 2", { exact: true })
      .fill("99.99");
    await expect(
      page.getByRole("alert").filter({ hasText: "sobreposição" }).first(),
    ).toBeVisible();
    await page
      .getByLabel("Custo inicial de terceiros faixa 2", { exact: true })
      .fill("100");
    page.once("dialog", (d) => d.dismiss());
    await page.locator('[data-settings-tab="oficina"]').click();
    await expect(
      page.getByLabel("Lucro de terceiros faixa 2", { exact: true }),
    ).toHaveValue("10");
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/parts-pricing") &&
        r.request().method() === "PUT",
    );
    await page
      .getByRole("button", { name: "Salvar política de preços" })
      .click();
    expect((await saved).status()).toBe(200);
    await expect(
      page.getByText("Alterações não salvas.", { exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByLabel("Lucro de terceiros faixa 2", { exact: true }),
    ).toHaveValue("10");
    const actual = (
      await (await page.request.get(origin + "/api/workspace")).json()
    ).parts_pricing;
    expect(actual.rules.map(({ from, ...r }) => r)).toEqual(
      original.rules.map(({ from, ...r }) => r),
    );
    expect(actual.service_rules[1].markup_bps).toBe(1000);
    await page
      .getByRole("button", {
        name: "Excluir faixa 2 de terceiros",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Sem limite máximo de terceiros", { exact: true })
      .check();
    await expect(page.getByTestId("service-price-simulation")).toContainText(
      "150,00",
    );
    page.once("dialog", (d) => d.accept());
  } finally {
    const restored = await page.request.put(origin + "/api/parts-pricing", {
      data: {
        ...original,
        service_rules: original.service_rules ?? [
          {
            from: 0,
            up_to: null,
            markup_bps: original.service_markup_bps ?? 3000,
            minimum_profit: 0,
          },
        ],
      },
    });
    expect(restored.status()).toBe(200);
    await page.reload();
  }
}
