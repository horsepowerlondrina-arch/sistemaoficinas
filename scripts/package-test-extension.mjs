import { deflateRawSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TEST_APP_ORIGIN = "https://sistema-oficinas-homologacao.vercel.app";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(ROOT, "extension/horse-power");
const SOURCE_FILES = [
  "background.js",
  "bridge.js",
  "capture.css",
  "popup.html",
  "popup.js",
  "sky-plate.js",
  "sky.js",
  "transport.js",
];
const README = `SISTEMA OFICINAS — EXTENSÃO DE TESTE INT-015
Versão 0.1.0

Instalação manual:
1. Extraia este ZIP em uma pasta permanente.
2. Abra chrome://extensions e ative o modo desenvolvedor.
3. Clique em “Carregar sem compactação” e escolha a pasta extraída.
4. No Sky Peças, use o botão “S.O. Teste • Enviar” para capturar no Sistema
   Oficinas em homologação.

Esta extensão tem identidade, armazenamento e conexão próprios. Pode ficar
instalada ao lado da extensão Horse Power da Chrome Web Store; não a substitui
nem altera suas configurações ou conexões. A extensão de teste conecta somente
a https://sistema-oficinas-homologacao.vercel.app.

No Sky Peças, as duas extensões podem mostrar botões separados. Use somente
“S.O. Teste • Enviar” para testar o Sistema Oficinas. Descarte ou conclua os
itens pelo painel da captura antes de encerrar a sessão.
`;

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipEntries(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const source = Buffer.from(entry.content, "utf8");
    const compressed = deflateRawSync(source);
    const crc = crc32(source);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(source.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(source.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralDirectory, end]);
}

export function buildTestExtensionFiles() {
  const sourceManifest = JSON.parse(readFileSync(resolve(SOURCE, "manifest.json"), "utf8"));
  const sky = sourceManifest.content_scripts.find((script) =>
    script.matches?.includes("https://cliente.skypecas.com.br/*"),
  );
  const bridge = sourceManifest.content_scripts.find((script) =>
    script.js?.includes("bridge.js"),
  );
  if (!sky || !bridge) throw new Error("Os scripts Sky e bridge são necessários ao pacote de teste.");
  const manifest = {
    ...sourceManifest,
    name: "Sistema Oficinas — Teste INT-015",
    short_name: "SO INT-015",
    version: "0.1.0",
    description: "Captura de peças do Sky Peças somente para homologação do Sistema Oficinas.",
    host_permissions: [TEST_APP_ORIGIN + "/*"],
    action: { ...sourceManifest.action, default_title: "Sistema Oficinas — Teste INT-015" },
    content_scripts: [
      structuredClone(sky),
      { ...structuredClone(bridge), matches: [TEST_APP_ORIGIN + "/*"] },
    ],
  };
  let background = readFileSync(resolve(SOURCE, "background.js"), "utf8");
  const originalOrigins = /const appOrigins = new Set\(\[\s*"https:\/\/horse-power\.vercel\.app",\s*"https:\/\/oficinahorsepower\.com\.br",?\s*\]\);/;
  if (!originalOrigins.test(background)) throw new Error("Lista de destinos comerciais mudou; atualize a geração de teste explicitamente.");
  background = background.replace(originalOrigins, 'const appOrigins = new Set(["' + TEST_APP_ORIGIN + '"]);');
  background = background.replaceAll("https://horse-power.vercel.app", TEST_APP_ORIGIN);
  background = background.replaceAll("Horse Power", "Sistema Oficinas (Teste)");
  const files = [
    { name: "manifest.json", content: JSON.stringify(manifest, null, 2) + "\n" },
    { name: "background.js", content: background },
    ...SOURCE_FILES.filter((name) => name !== "background.js").map((name) => {
      let content = readFileSync(resolve(SOURCE, name), "utf8");
      content = content.replaceAll("hp-", "so-test-");
      content = content.replaceAll("__HP_SKY_", "__SO_TEST_SKY_");
      content = content.replaceAll("Horse Power", "Sistema Oficinas (Teste)");
      content = content.replaceAll("HP • Enviar", "S.O. Teste • Enviar");
      return { name, content };
    }),
    { name: "LEIA-ME.txt", content: README },
  ];
  const forbidden = /tempario|horse-power\.vercel\.app|oficinahorsepower\.com\.br|chromewebstore\.google\.com/i;
  for (const file of files)
    if (forbidden.test(file.name + "\n" + file.content))
      throw new Error("O pacote de teste contém uma integração ou destino fora do escopo: " + file.name);
  return files;
}

export function writeTestExtensionPackage(outputPath = resolve(ROOT, "public/downloads/sistema-oficinas-test-extension.zip")) {
  const files = buildTestExtensionFiles();
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, zipEntries(files));
  return { outputPath, fileCount: files.length, version: "0.1.0" };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = writeTestExtensionPackage(process.argv[2] ? resolve(process.argv[2]) : undefined);
  console.log("Pacote manual de teste gerado:", result.outputPath, "(", result.fileCount, "arquivos, v" + result.version + ")");
}
