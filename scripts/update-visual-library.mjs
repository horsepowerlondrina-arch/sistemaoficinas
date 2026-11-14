import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { createCatalog } from "./visual-library-catalog.mjs";

const root = resolve("docs/mapeamento-visual");
const catalogPath = resolve(root, "catalog.json");
if (!existsSync(catalogPath) && process.argv.includes("--initialize")) {
  mkdirSync(root, { recursive: true });
  writeFileSync(catalogPath, `${JSON.stringify(createCatalog(), null, 2)}\n`);
}
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const modules = [...catalog.modules, { id: "99-fluxos-completos", name: "Fluxos completos", description: "Sequências de navegação entre áreas." }];
const byModule = new Map(modules.map((module) => [module.id, module]));
const rows = catalog.entries.map((entry) => {
  const module = byModule.get(entry.module);
  if (!module) throw new Error(`Módulo desconhecido em ${entry.id}: ${entry.module}`);
  const imagePath = entry.image ? relative(root, resolve(entry.image)).replaceAll(sep, "/") : "";
  const imageLink = imagePath && existsSync(resolve(root, imagePath))
    ? "[" + "`" + imagePath + "`](./" + imagePath + ")"
    : imagePath ? "`" + imagePath + "` (previsto)" : "—";
  return `| ${entry.id} | ${module.name} | ${entry.title} — ${entry.description} | ${imageLink} | ${entry.status} | ${entry.updatedAt || "—"} | ${entry.commit || "não registrado"} | ${entry.reason || "—"} |`;
});

const readme = `# Biblioteca visual — Sistema Oficinas\n\nReferência compartilhada de telas reais do Sistema Oficinas. As capturas foram feitas em ambiente local com dados fictícios; cada registro mantém seu estado, data e commit de origem, quando conhecido. Funcionalidades sem imagem aparecem como pendentes ou bloqueadas.\n\n- [Índice visual navegável](./INDEX.md)\n- [Checklist completo](./CHECKLIST.md)\n- [Catálogo de capturas](./catalog.json)\n\n## Acesso\n\nConsulte esta pasta no repositório privado do GitHub. O índice mostra as miniaturas e abre os PNGs completos. A biblioteca é exclusiva do desenvolvimento e não integra nem é publicada com a aplicação da oficina.\n\n## Manutenção\n\n- visual:capture — percorre as rotas catalogadas e atualiza as capturas, data e commit. Faça o commit do código da interface primeiro; a captura gravadora exige checkout limpo para registrar a revisão correta. Requer aplicação local de teste e o arquivo ignorado data/local-credentials.json, gerado pelo seed local.\n- visual:capture -- --module 08-financeiro — limita a execução a um módulo.\n- visual:capture -- --affected — seleciona módulos conforme os arquivos alterados em relação a origin/main.\n- node scripts/test-admin-interface.mjs — valida as interações administrativas em loopback com API fictícia e gera capturas no diretório temporário do runner; artifacts do CI permitem revisão antes da inclusão no catálogo.\n- node scripts/test-workshop-users-ui.mjs — valida usuários, convites, ativação, atribuição e aprovações com API e PostgreSQL 17 descartável no CI; o artefato ops004-users-interface fornece as imagens do driver ops004-interface para revisão e inclusão nesta pasta. Não usar em banco persistente.\n- visual:check — confere PNGs, metadados, caminhos, estados e índices.\n- visual:index — regenera este índice e o checklist a partir do catálogo JSON.\n\nCapturas que criem, editem ou finalizem registros só podem usar base PostgreSQL efêmera de CI ou outra base descartável configurada. Nunca rode capturas gravadoras na homologação compartilhada.\n\n## Coleta atual\n\nO acervo inclui ${catalog.entries.filter((entry) => entry.status === "capturada").length} PNGs de telas reais. Consulte a data e o commit de cada entrada: as capturas originais de 22/10/2026 não registraram o commit e continuam sinalizadas. Capturas ADM-002.1 usam Chromium com respostas de API fictícias e não comprovam o backend; a integração PostgreSQL é testada separadamente no CI. Nenhuma credencial, token ou dado real deve aparecer nas imagens.\n`;

const indexSections = modules.map((module) => {
  const entries = catalog.entries.filter((entry) => entry.module === module.id);
  const captured = entries.filter((entry) => entry.status === "capturada");
  const lines = [`## ${module.id.split("-")[0]} — ${module.name}`, "", module.description, ""];
  if (!entries.length) return [...lines, "Ainda sem interações mapeadas nesta versão.", ""].join("\n");
  if (!captured.length) return [...lines, "Sem imagens reais disponíveis nesta área.", ""].join("\n");
  for (const entry of captured) {
    const image = relative(root, resolve(entry.image)).replaceAll(sep, "/");
    lines.push(`### ${entry.title}`, "", entry.description, "", `[![${entry.title}](./${image})](./${image})`, "", `Estado: ${entry.status} · ${entry.viewport} · captura ${entry.updatedAt} · commit de origem: ${entry.commit || "não registrado"} · [arquivo completo](./${image})`, "");
  }
  return lines.join("\n");
}).join("\n");
const flows = catalog.flows.map((flow) => {
  const steps = flow.entryIds.map((id, index) => {
    const entry = catalog.entries.find((item) => item.id === id);
    if (!entry) throw new Error(`Fluxo ${flow.id} aponta para interação inexistente: ${id}`);
    const image = entry.image ? ` — [imagem](./${relative(root, resolve(entry.image)).replaceAll(sep, "/")})` : "";
    return `${index + 1}. ${entry.title} (${entry.status})${image}`;
  });
  return [`### ${flow.id} — ${flow.name}`, "", flow.description, "", ...steps, "", `Estado: ${flow.status}${flow.reason ? ` — ${flow.reason}` : ""}`, ""].join("\n");
}).join("\n");
const index = `# Índice visual\n\nAs miniaturas abaixo são links diretos para os PNGs completos. O [catálogo JSON](./catalog.json) contém os metadados das capturas.\n\n${indexSections}\n## 99 — Fluxos completos\n\n${flows}`;
const checklist = `# Checklist de telas e interações\n\nCada linha tem identificador estável, módulo, descrição, caminho da imagem, estado, atualização, commit e motivo de pendência. Uma interação só é considerada capturada se o PNG existe. As capturas existentes foram feitas com dados fictícios; o campo freshness no catálogo indica quais precisam ser atualizadas.\n\nEstados: capturada, pendente, bloqueada e não aplicável.\n\n| ID | Módulo | Interação / descrição | Imagem | Estado | Atualizada em | Commit | Motivo / observação |\n|---|---|---|---|---|---|---|---|\n${rows.join("\n")}\n\n## Fluxos\n\n${catalog.flows.map((flow) => `- **${flow.id} ${flow.name}** — ${flow.status}. ${flow.reason || flow.description}`).join("\n")}\n`;

const outputs = new Map([[resolve(root, "README.md"), readme], [resolve(root, "INDEX.md"), index], [resolve(root, "CHECKLIST.md"), checklist]]);
const check = process.argv.includes("--check");
if (process.argv.includes("--write")) {
  for (const module of modules) mkdirSync(resolve(root, "capturas", module.id), { recursive: true });
  mkdirSync(resolve(root, "capturas/99-fluxos-completos"), { recursive: true });
  for (const [path, content] of outputs) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
  console.log(`Índices gerados: ${outputs.size} arquivos.`);
}
if (check || !process.argv.includes("--write")) {
  const ids = new Set();
  const errors = [];
  for (const module of catalog.modules) if (!module.id || !module.name || !module.description) errors.push("Módulo com metadados incompletos.");
  for (const entry of catalog.entries) {
    if (ids.has(entry.id)) errors.push(`ID duplicado: ${entry.id}`);
    ids.add(entry.id);
    if (!byModule.has(entry.module)) errors.push(`Módulo ausente: ${entry.id}`);
    if (!["capturada", "pendente", "bloqueada", "não aplicável"].includes(entry.status)) errors.push(`Estado inválido: ${entry.id}`);
    if (entry.status === "capturada" && (!entry.image || !entry.updatedAt)) errors.push(`Captura sem imagem/data: ${entry.id}`);
    if (entry.status !== "capturada" && !entry.reason) errors.push(`Pendência sem motivo: ${entry.id}`);
    if (entry.image) {
      const path = resolve(entry.image);
      if (!path.startsWith(resolve(root, "capturas") + sep)) errors.push(`Imagem fora da biblioteca: ${entry.id}`);
      if (!existsSync(path)) {
        if (entry.status === "capturada") errors.push(`Imagem ausente: ${entry.id} (${entry.image})`);
      } else if (!readFileSync(path).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) errors.push(`Arquivo não é PNG válido: ${entry.id}`);
    }
  }
  for (const flow of catalog.flows) for (const id of flow.entryIds) if (!ids.has(id)) errors.push(`Interação ausente no fluxo ${flow.id}: ${id}`);
  for (const [path, content] of outputs) {
    if (!existsSync(path)) errors.push(`Índice ausente: ${relative(process.cwd(), path)}`);
    else if (readFileSync(path, "utf8") !== content) errors.push(`Índice desatualizado: ${relative(process.cwd(), path)} (rode visual:index)`);
  }
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
  else console.log(`Biblioteca íntegra: ${catalog.entries.filter((entry) => entry.status === "capturada").length} capturas PNG, ${catalog.entries.length} interações, ${catalog.flows.length} fluxos.`);
}
