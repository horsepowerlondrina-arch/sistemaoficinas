import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";

if (process.env.VERCEL || process.env.NODE_ENV === "production") throw Error("ISOLATED_ONLY");
const files = ["checklist-photo-fixture.html", "checklist-photo-fixture.tsx"];
if (files.some(existsSync)) throw Error("FIXTURE_ALREADY_EXISTS");
const output = resolve(process.env.RUNNER_TEMP || "/tmp", "checklist-photo-ui");
mkdirSync(output, { recursive: true });
writeFileSync(files[0], '<div id="root"></div><script type="module" src="/checklist-photo-fixture.tsx"></script>');
writeFileSync(files[1], `import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Route,Routes}from'react-router-dom';import{AppContext}from'./src/lib/context';import{ChecklistEditor}from'./src/pages/ChecklistEditor';import'./src/styles.css';const ctx={data:{orders:[],vehicles:[],customers:[]},session:{user:{name:'Responsável Fictício'},role:'owner',tenant:{id:'fictional',name:'Oficina Fictícia'}},notify:()=>{},refresh:async()=>{}};createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/checklists/fictional']}><AppContext.Provider value={ctx as any}><main style={{padding:16}}><Routes><Route path="/checklists/:id" element={<ChecklistEditor/>}/></Routes></main></AppContext.Provider></MemoryRouter>);`);
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5189", "--strictPort"], { stdio: "ignore" });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch("http://127.0.0.1:5189")).ok) { ready = true; break; } } catch {}
    await delay(250);
  }
  if (!ready) throw Error("TEST_SERVER_UNAVAILABLE");
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  let photos = [{ id: "fictional-photo-1", kind: "front" }];
  let uploads = 0;
  await page.route("**/api/**", async route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/checklists/fictional" && route.request().method() === "GET")
      return route.fulfill({ json: { id: "fictional", status: "draft", customer_name: "Cliente Fictício", vehicle_label: "Veículo Fictício", plate: "ABC1D23", inspector: "Responsável Fictício", km: 0, fuel_level: 50, signature_data: "", signature_absent_reason: "", photos } });
    if (pathname === "/api/documents/checklist/fictional") return route.fulfill({ json: { legacy: false, revisions: [] } });
    if (pathname.startsWith("/api/checklist-photos/")) return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9R9C8AAAAASUVORK5CYII=", "base64") });
    if (pathname === "/api/checklists/fictional/photos" && route.request().method() === "POST") {
      expect(route.request().headers()["content-type"]).toBe("image/jpeg");
      expect(route.request().postDataBuffer().length).toBeGreaterThan(100);
      photos = [...photos, { id: `fictional-photo-${++uploads + 1}`, kind: "front" }];
      return route.fulfill({ status: 201, json: { id: photos.at(-1).id } });
    }
    throw Error(`UNEXPECTED_API_REQUEST ${route.request().method()} ${pathname}`);
  });
  await page.goto("http://127.0.0.1:5189/checklist-photo-fixture.html");
  await expect(page.locator(".checklist-photo-grid img")).toHaveCount(1);
  await page.screenshot({ path: resolve(output, "checklist-photo-mobile.png"), fullPage: true });
  const picture = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 200; canvas.height = 150;
    const context = canvas.getContext("2d"); context.fillStyle = "#b3342d"; context.fillRect(0, 0, 200, 150);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  for (const [index, label] of ["Tirar foto", "Escolher da galeria"].entries()) {
    const chooser = page.waitForEvent("filechooser");
    await page.getByText(label, { exact: true }).click();
    const fileChooser = await chooser;
    await expect(page.locator(".checklist-photo-grid img")).toHaveCount(0);
    await fileChooser.setFiles({ name: "foto-ficticia.png", mimeType: "image/png", buffer: Buffer.from(picture, "base64") });
    await expect(page.locator(".checklist-photo-grid img")).toHaveCount(index + 2);
  }
  expect(uploads).toBe(2);
  expect(errors).toEqual([]);
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error("MOBILE_OVERFLOW");
  console.log("Captura e galeria conferidas em viewport móvel com API e imagens fictícias.");
} finally {
  await browser?.close(); server.kill("SIGTERM");
  for (const file of files) rmSync(file, { force: true });
}
