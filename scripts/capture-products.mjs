import { expect } from "@playwright/test";

// Only used by the loopback-only visual runner, with fictional response data.
export async function captureProducts(page, entry) {
  const workspaceUrl = new URL("/api/workspace", page.url()).toString();
  const response = await page.request.get(workspaceUrl);
  expect(response.ok()).toBeTruthy();
  const workspace = await response.json();
  const name = "Filtro de óleo fictício para motores flex com descrição extensa e aplicações em diversos veículos de teste";
  const fixture = {
    id: "visual-product-layout", kind: "product", active: 1, name,
    sku: "REFERENCIA-FICTICIA-ABCDEFGHIJKLMNOPQRSTUVWXYZ-1234567890",
    category: "Filtros e componentes de manutenção preventiva",
    cost: 80.5, price: 125.9, stock: 12, minimum_stock: 2,
    cost_known: 1, stock_verified: 1, brand: "", manufacturer_code: "",
    application: "", usage_vehicles: "", search_aliases: "",
  };
  const route = async route => route.fulfill({ json: { ...workspace, catalog: [fixture] } });
  await page.route(workspaceUrl, route);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    const table = page.locator(".products-register-table");
    await expect(table.getByRole("button", { name, exact: true })).toBeVisible();
    const viewport = entry.viewport === "desktop" ? { width: 1366, height: 900 } : { width: 390, height: 844 };
    await page.setViewportSize(viewport);
    const dimensions = await page.locator(".products-register-panel .table-scroll").evaluate(el => ({
      client: el.clientWidth, scroll: el.scrollWidth,
      right: el.getBoundingClientRect().right,
      viewport: document.documentElement.clientWidth,
      pageWidth: document.documentElement.scrollWidth,
    }));
    if (dimensions.pageWidth > dimensions.viewport) console.log("Overflow diagnostics", await page.locator("body *").evaluateAll(elements => elements.filter(el => el.getBoundingClientRect().right > document.documentElement.clientWidth && !el.closest(".table-scroll")).map(el => ({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right,width:el.getBoundingClientRect().width})).slice(0,30)));
    expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.pageWidth).toBeLessThanOrEqual(dimensions.viewport);
    if (entry.viewport === "desktop") expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
    else {
      expect(dimensions.scroll).toBeGreaterThan(dimensions.client);
      await page.getByRole("region", { name: "Tabela de produtos" }).evaluate(el => { el.scrollLeft = el.scrollWidth; });
      const edit = table.locator("tbody tr").first().getByRole("button", { name: /Editar/ });
      await expect(edit).toBeInViewport();
      await edit.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: "Cancelar", exact: true }).click();
      await page.getByRole("region", { name: "Tabela de produtos" }).evaluate(el => { el.scrollLeft = 0; });
    }
    await expect(table.getByText("R$ 125,90", { exact: true })).toHaveCount(1);
    await page.getByPlaceholder("Buscar produtos...").fill("inexistente-visual");
    await expect(table).toHaveCount(0);
    await page.getByPlaceholder("Buscar produtos...").fill("");
    await expect(table).toBeVisible();
    console.log("Products table: long identity, viewport bounds, internal scroll, edit and search verified (" + entry.viewport + ").");
  } finally { await page.unroute(workspaceUrl, route); }
}
