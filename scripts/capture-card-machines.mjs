import { expect } from "@playwright/test";
export const capturedOrders=[];
export const capturedProducts=[];
export async function captureCardMachines(page, entry) {
  if (!entry.route.includes("aba=geral") && !entry.id.startsWith("ops002-"))
    return;
  if (!["localhost", "127.0.0.1"].includes(new URL(page.url()).hostname))
    throw new Error("OPS-002 somente em teste isolado.");
  const request = async (path, data, method = "POST") => {
    const r = await page.request.fetch(
      new URL("/api" + path, page.url()).toString(),
      { method, data },
    );
    if (!r.ok())
      throw new Error(`OPS-002 ${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const machines = await request("/card-machines", undefined, "GET");
  let machine = machines.find((m) => m.name === "Máquina Fictícia Visual");
  if (!machine) {
    const input = {
      name: "Máquina Fictícia Visual",
      operator: "Operadora Fictícia",
      active: true,
      is_default: true,
      max_installments: 3,
      rates: [
        { method: "Cartão de débito", installments: 1, fee_bps: 150 },
        { method: "Cartão de crédito", installments: 1, fee_bps: 250 },
        { method: "Cartão de crédito", installments: 3, fee_bps: 350 },
      ],
    };
    const created = await request("/card-machines", input);
    machine = { ...input, id: created.id };
  }
  let secondary=machines.find(m=>m.name==='Máquina Secundária Fictícia');
  if(!secondary){const input={name:'Máquina Secundária Fictícia',operator:'Outra Operadora Fictícia',active:true,is_default:false,max_installments:3,rates:[{method:'Cartão de crédito',installments:1,fee_bps:400},{method:'Cartão de crédito',installments:3,fee_bps:500}]};secondary={...input,...await request('/card-machines',input)};}
  if (entry.route.includes("aba=geral")) {
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Máquinas de cartão", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Editar Máquina Fictícia Visual",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("spinbutton", { name: "Crédito 3x (%)", exact: true }),
    ).toHaveValue("3.5");
    if (entry.id === "config-geral-taxas-desktop") {
      await page
        .getByRole("spinbutton", { name: "Crédito 3x (%)", exact: true })
        .fill("3.6");
      const [saved] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes("/api/card-machines/") &&
            r.request().method() === "PUT",
        ),
        page
          .getByRole("button", { name: "Salvar máquina", exact: true })
          .click(),
      ]);
      expect(saved.status()).toBe(200);
      await page
        .getByRole("button", {
          name: "Editar Máquina Fictícia Visual",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("spinbutton", { name: "Crédito 3x (%)", exact: true }),
      ).toHaveValue("3.6");
      await page
        .getByRole("spinbutton", { name: "Crédito 3x (%)", exact: true })
        .fill("3.5");
      await page
        .getByRole("button", { name: "Salvar máquina", exact: true })
        .click();
      await expect(
        page.getByRole("textbox", { name: "Nome da máquina", exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("button", {
          name: "Editar Máquina Fictícia Visual",
          exact: true,
        })
        .click();

      const name = page.getByRole("textbox", {
        name: "Nome da máquina",
        exact: true,
      });
      await name.fill("Rascunho fictício");
      page.once("dialog", (d) => d.dismiss());
      await page.locator('[data-settings-tab="conta"]').click();
      await expect(name).toHaveValue("Rascunho fictício");
      page.once("dialog", (d) => d.accept());
      await page.getByRole("button", { name: "Cancelar edição" }).click();
      await expect(
        page.getByRole("textbox", { name: "Nome da máquina", exact: true }),
      ).toHaveCount(0);
    } else if (!entry.id.startsWith("ops002-machine-editor"))
      await page.getByRole("button", { name: "Cancelar edição" }).click();
    return;
  }
  if (!entry.id.startsWith("ops002-receipt")) return;
  const workspace = await request("/workspace", undefined, "GET");
  const vehicle = workspace.vehicles.find((v) =>
    workspace.customers.some((c) => c.id === v.customer_id),
  );
  let product = workspace.catalog.find(p => p.sku === 'OPS002-VISUAL');
  if (!product) {
    product = await request('/catalog', {kind:'product',name:'Produto Fictício OPS-002',sku:'OPS002-VISUAL',category:'',cost:1000,price:10000,stock:0,minimum_stock:0});
    capturedProducts.push(product.id);
  }
  if (!vehicle || !product)
    throw new Error("Fixture fictícia de recebimento ausente.");
  const order = await request("/orders", {
    customer_id: vehicle.customer_id,
    vehicle_id: vehicle.id,
    status: "open",
    entered_on: "2026-10-01",
    due_on: "2026-10-01",
    km: 0,
    problem: "OPS-002 fictício",
    notes: "",
    discount: 0,
    items: [{ catalog_id: product.id, quantity: 1, price: 10000 }],
  });
  capturedOrders.push(order.id);
  for (const status of ["working", "ready", "completed"])
    await request("/orders/" + order.id + "/status", { status });
  await page.goto(
    new URL("/ordens/" + order.id + "/receber", page.url()).toString(),
  );
  await page
    .getByRole("combobox", { name: "Forma de pagamento", exact: true })
    .selectOption("Cartão de crédito");
  await expect(
    page.getByRole("combobox", { name: "Máquina de cartão", exact: true }),
  ).toHaveValue(machine.id);
  await expect(
    page.getByRole("checkbox", {
      name: "Repassar taxa ao cliente",
      exact: true,
    }),
  ).not.toBeChecked();
  await page
    .getByRole("spinbutton", { name: "Parcelas", exact: true })
    .fill("2");
  await expect(
    page.getByText(
      "Cadastre ou selecione uma máquina ativa com taxa para esta modalidade e parcelas.",
    ),
  ).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "Parcelas", exact: true })
    .fill("3");
  await expect(page.getByText("Taxa total da operação: 3.50%")).toBeVisible();
  await page.getByRole('combobox',{name:'Máquina de cartão',exact:true}).selectOption(secondary.id);
  await expect(page.getByText('Taxa total da operação: 5.00%')).toBeVisible();
  await page.getByRole('combobox',{name:'Máquina de cartão',exact:true}).selectOption(machine.id);
  await expect(page.getByText('Taxa total da operação: 3.50%')).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Repassar taxa ao cliente", exact: true })
    .check();
  await expect(
    page.getByRole("button", { name: "Salvar condições de pagamento" }),
  ).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}
