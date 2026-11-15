// Captures an existing loopback page without seeding, clicking, login or mutation.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const target = new URL(process.env.VISUAL_BASE_URL || 'http://127.0.0.1:5173');
if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password || target.search || target.hash)
  throw new Error('Captura exige loopback sem credenciais ou tokens na URL.');
const route = process.argv[2] || '/inicio';
if (!['/inicio','/admin','/configuracoes','/servicos','/ordens'].includes(route)) throw new Error('Rota não permitida para captura somente leitura.');
const output = resolve('data/inf010-capturas'); mkdirSync(output,{recursive:true});
const browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}: {})});
try {
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  // A page may call read APIs; block every modifying method, including telemetry.
  await context.route('**/*', async request => {
    const u = new URL(request.request().url());
    if (u.origin !== target.origin || !['GET','HEAD'].includes(request.request().method())) return request.abort();
    return request.continue();
  });
  const page = await context.newPage();
  await page.goto(new URL(route,target).href,{waitUntil:'networkidle'});
  await page.screenshot({path:resolve(output,route.slice(1)+'.png'),fullPage:true});
  console.log('Captura local salva em data/inf010-capturas (não versionada).');
} finally { await browser.close(); }
