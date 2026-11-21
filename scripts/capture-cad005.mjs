import { expect } from "@playwright/test";

export async function captureCad005(page, entry) {
  if (!entry.id.startsWith("cad005-")) return;
  const register = entry.id.includes("register"), review = entry.id.includes("review");
  if (register) await page.getByRole("button", { name: "Novo veículo", exact: true }).click();
  if (review) await page.getByRole("button", { name: "Editar CAD0A05", exact: true }).click();
  if (entry.id.includes("checklist")) {
    await page.getByRole("textbox", { name: "Placa", exact: true }).fill("CAD0B06");
    await page.getByRole("button", { name: "Consultar placa" }).click();
    await page.getByText("Veículo ainda não cadastrado", { exact: true }).waitFor();
  }
  const scope = register || review ? page.getByRole("dialog") : page;
  if (register || review) {
    if (register) {
      await scope.getByRole("textbox", { name: /^Marca/ }).fill("Marca Fictícia");
      await scope.getByRole("combobox", { name: /^Modelo/ }).fill("Modelo Fictício");
      await scope.getByRole("listbox", { name: "Modelos do veículo" }).getByRole("option").first().click();
      await expect(scope.getByRole("listbox", { name: "Modelos do veículo" })).toHaveCount(0);
      await scope.getByRole("combobox", { name: /^Modelo/ }).click();
      await expect(scope.getByRole("listbox", { name: "Modelos do veículo" })).toBeVisible();
      await scope.getByRole("combobox", { name: /^Modelo/ }).press("Escape");
      await expect(scope.getByRole("listbox", { name: "Modelos do veículo" })).toHaveCount(0);
      await scope.getByRole("spinbutton", { name: /^Ano de fabricação/ }).fill("2020");
      await scope.getByRole("spinbutton", { name: "Ano do modelo", exact: true }).fill("2021");
      await scope.getByRole("textbox", { name: "Combustível", exact: true }).fill("Flex");
    }
    await expect(scope.getByRole("combobox", { name: /^Modelo/ })).toBeVisible();
    if (entry.id.includes("review-catalog")) {
      await scope.getByRole("textbox", { name: "Código FIPE" }).fill("999999-9");
      await scope.getByRole("combobox", { name: /^Modelo/ }).fill("Modelo Fictício");
      const firstOption = scope.getByRole("listbox", { name: "Modelos do veículo" }).getByRole("option").first();
      await expect(firstOption).toBeVisible();
      await firstOption.click();
      await expect(scope.getByRole("listbox", { name: "Modelos do veículo" })).toHaveCount(0);
      await expect(scope.getByRole("textbox", { name: "Código FIPE" })).toHaveValue("999999-9");
      await scope.getByRole("button", { name: "Salvar cadastro", exact: true }).click();
      await expect(scope).toHaveCount(0);
      await page.getByRole("button", { name: "Editar CAD0A05", exact: true }).click();
      await expect(scope.getByRole("textbox", { name: "Código FIPE" })).toHaveValue("999999-9");
      await expect(scope.getByRole("combobox", { name: /^Modelo/ })).toHaveValue("Modelo Fictício");
      await expect(page.getByText("Cadastro salvo com sucesso.", { exact: true })).toHaveCount(0, { timeout: 10000 });
    }
    if (entry.id.includes("-footer-")) await scope.evaluate(element => { element.scrollTop = element.scrollHeight; });
    else if (!entry.id.includes("review-catalog")) await scope.evaluate(element => { element.scrollTop = 0; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    return;
  }
  if (!review && !entry.id.includes("switch")) {
    await scope.getByRole("textbox", { name: /^Marca/ }).fill("Marca Fictícia");
    await scope.getByRole("combobox", { name: /^Modelo/ }).fill("Modelo FIPE Fictício 1.0 Flex");
    await scope.getByRole("button", { name: /Usar modelo informado/ }).click();
    await scope.getByRole("spinbutton", { name: /^Ano de fabricação/ }).fill("2020");
    await scope.getByRole("spinbutton", { name: "Ano do modelo", exact: true }).fill("2021");
    await scope.getByRole("textbox", { name: "Combustível", exact: true }).fill("Flex");
  }
  await expect(scope.getByText("Associação ao Catálogo Técnico", { exact: true })).toHaveCount(0);
  if (!entry.id.includes("switch")) {
    await expect(scope.getByRole("combobox", { name: /^Modelo/ })).toHaveValue("Modelo FIPE Fictício 1.0 Flex");
    await expect(scope.getByRole("listbox", { name: "Modelos do veículo" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    return;
  }
  if (entry.id.includes("switch")) {
    const linkedPlate = page.locator(".field").filter({ hasText: "Placa do veículo vinculado" }).getByRole("img");
    const currentPlate = await linkedPlate.getAttribute("aria-label");
    await page.getByPlaceholder("Placa, modelo ou proprietário...").fill("CAD0A05");
    const alternate = page.locator(".order-vehicle-card").filter({ hasText: "CAD0A05" });
    page.once("dialog", dialog => dialog.dismiss());
    await alternate.click();
    await expect(linkedPlate).toHaveAttribute("aria-label", currentPlate);
    page.once("dialog", dialog => dialog.accept());
    await alternate.click();
    await expect(linkedPlate).toHaveAttribute("aria-label", "Placa do veículo CAD0A05");
    await expect(page.getByRole("textbox", { name: "Relato do cliente / problema" })).toHaveValue("Relato fictício preservado");
    await page.getByPlaceholder("Placa, modelo ou proprietário...").fill("");
  }
  await expect(scope.getByRole("textbox", { name: /^Modelo(?: FIPE)?/ })).toHaveValue("Modelo FIPE Fictício 1.0 Flex");
  if (entry.id.includes("-footer-")) await scope.evaluate(element => { element.scrollTop = element.scrollHeight; });
  else if (register || review) await scope.evaluate(element => { element.scrollTop = 0; });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  if (overflow) throw new Error(`Horizontal overflow in ${entry.id}`);
}
