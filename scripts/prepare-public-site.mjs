import { readFile, writeFile, rename, access } from "node:fs/promises";

// Keep the management entry separate so Vercel can choose the public home by host.
await rename("dist/index.html", "dist/app.html");
const app = await readFile("dist/app.html", "utf8");
const client = app.replace(/<title>[^<]*<\/title>/, '<title>Ordem de Serviço</title><meta property="og:title" content="Ordem de Serviço"/><meta name="description" content="Confira as peças, serviços e informações de pagamento do seu atendimento."/><meta property="og:description" content="Confira as peças, serviços e informações de pagamento do seu atendimento."/><meta property="og:type" content="website"/>');
await writeFile("dist/client.html", client);
if (!client.includes('property="og:title" content="Ordem de Serviço"') || client.includes("Gestão de oficinas"))
  throw new Error("Customer link metadata is not ready.");
for (const name of ["index", "contato"]) {
  const html = await readFile(`dist/site/${name}.html`, "utf8");
  if (!html.includes('href="/sistema"') || html.includes("noindex,nofollow"))
    throw new Error("Public site is not ready: " + name);
  for (const [, path] of html.matchAll(/(?:src|href)="(\/site\/[^"#]+)"/g))
    await access("dist" + path);
}
console.log("Public site and management entry verified.");
