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
  if (!review && !entry.id.includes("switch")) {
    await scope.getByRole("textbox", { name: /^Marca/ }).fill("Marca Fictícia");
    await scope.getByRole("textbox", { name: /^Modelo FIPE/ }).fill("Modelo FIPE Fictício 1.0 Flex");
    await scope.getByRole("spinbutton", { name: /^Ano de fabricação/ }).fill("2020");
    await scope.getByRole("spinbutton", { name: "Ano do modelo", exact: true }).fill("2021");
    await scope.getByRole("textbox", { name: "Combustível", exact: true }).fill("Flex");
  }
  const association = scope.locator(".vehicle-technical-association details");
  await expect(association).not.toHaveAttribute("open");
  await association.locator("summary").click();
  await expect(scope.getByRole("button", { name: "Sem associação", exact: true })).toBeVisible();
  if (entry.id.includes("review-catalog")) {
    await scope.getByRole("button", { name: "Sem associação", exact: true }).click();
    await scope.getByRole("button", { name: "Associação automática", exact: true }).click();
    await expect(scope.getByText("Sem correspondência única e confiável. Pesquise e escolha manualmente, se desejar.")).toBeVisible();
    await scope.getByRole("combobox", { name: "Marca", exact: true }).fill("Marca");
    // A real pointer click must work inside the modal, without force or JS click.
    await page.locator(".catalog-dropdown-option").filter({ hasText: "Marca Fictícia" }).click({ timeout: 5000 });
    await scope.getByRole("combobox", { name: "Veículo", exact: true }).fill("Modelo");
    await page.locator(".catalog-dropdown-option").filter({ hasText: "Modelo Fictício" }).click();
    await expect(scope.getByRole("textbox", { name: /^Modelo FIPE/ })).toHaveValue("Modelo FIPE Fictício 1.0 Flex");
    await scope.getByRole("button", { name: "Salvar cadastro", exact: true }).click();
    await expect(scope).toHaveCount(0);
    const workspaceResponse = await page.request.get(new URL("/api/workspace", page.url()).toString());
    expect(workspaceResponse.ok()).toBeTruthy();
    const workspace = await workspaceResponse.json();
    const savedVehicle = workspace.vehicles.find(vehicle => vehicle.id === "cad005-visual-vehicle");
    expect(savedVehicle.service_model_id).toBe("00000000-0000-4000-8000-000000000005");
    expect(savedVehicle.service_link_mode).toBe("manual");
    expect(savedVehicle.fipe_model).toBe("Modelo FIPE Fictício 1.0 Flex");
    await page.getByRole("button", { name: "Editar CAD0A05", exact: true }).click();
    await association.locator("summary").click();
    await expect(scope.getByRole("combobox", { name: "Veículo", exact: true })).toHaveValue("Modelo Fictício");
    await scope.getByRole("button", { name: "Abrir marcas", exact: true }).click();
    await expect(page.getByRole("option", { name: /Marca Fictícia/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    return;
  }
  await association.locator("summary").click();
  if (entry.id.includes("switch")) {
    const currentPlate = await page.getByRole("textbox", { name: "Placa do veículo vinculado" }).inputValue();
    await page.getByPlaceholder("Placa, modelo ou proprietário...").fill("CAD0A05");
    const alternate = page.locator(".order-vehicle-card").filter({ hasText: "CAD0A05" });
    page.once("dialog", dialog => dialog.dismiss());
    await alternate.click();
    await expect(page.getByRole("textbox", { name: "Placa do veículo vinculado" })).toHaveValue(currentPlate);
    page.once("dialog", dialog => dialog.accept());
    await alternate.click();
    await expect(page.getByRole("textbox", { name: "Placa do veículo vinculado" })).toHaveValue("CAD0A05");
    await expect(page.getByRole("textbox", { name: "Relato do cliente / problema" })).toHaveValue("Relato fictício preservado");
    await page.getByPlaceholder("Placa, modelo ou proprietário...").fill("");
  }
  await expect(scope.getByRole("textbox", { name: /^Modelo FIPE/ })).toHaveValue("Modelo FIPE Fictício 1.0 Flex");
  if (entry.id.includes("-footer-")) await scope.evaluate(element => { element.scrollTop = element.scrollHeight; });
  else if (register || review) await scope.evaluate(element => { element.scrollTop = 0; });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  if (overflow) throw new Error(`Horizontal overflow in ${entry.id}`);
}
