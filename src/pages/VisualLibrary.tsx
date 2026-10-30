import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { ArrowLeft, ArrowRight, Search, X, ZoomIn, ZoomOut } from "lucide-react";

type CaptureStatus = "capturada" | "pendente" | "bloqueada" | "não aplicável";
type VisualEntry = {
  id: string;
  module: string;
  title: string;
  description: string;
  route: string;
  kind: string;
  viewport: "desktop" | "mobile";
  status: CaptureStatus;
  image?: string;
  updatedAt?: string;
  commit?: string | null;
  freshness?: string;
  reason?: string;
  flow?: string;
  sequence?: number;
};
type VisualModule = { id: string; name: string; description: string };
type VisualFlow = { id: string; name: string; description: string; status: CaptureStatus; entryIds: string[]; reason?: string };
type VisualCatalog = { modules: VisualModule[]; entries: VisualEntry[]; flows: VisualFlow[] };

const imageUrl = (entry: VisualEntry) => `/api/visual-library/images/${encodeURIComponent(entry.id)}`;
const statusLabels: Record<CaptureStatus, string> = {
  capturada: "Capturada",
  pendente: "Pendente",
  bloqueada: "Bloqueada",
  "não aplicável": "Não aplicável",
};

export function VisualLibrary() {
  const [catalog, setCatalog] = useState<VisualCatalog | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("todos");
  const [kindFilter, setKindFilter] = useState("todos");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [viewportFilter, setViewportFilter] = useState("todos");
  const [selectedId, setSelectedId] = useState("");
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let active = true;
    void api<VisualCatalog>("/visual-library/catalog")
      .then((result) => { if (active) setCatalog(result); })
      .catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, []);

  const visibleEntries = useMemo(() => {
    const entries = catalog?.entries || [];
    const search = query.trim().toLocaleLowerCase("pt-BR");
    return entries.filter((entry) => {
      const matchesSearch = !search || `${entry.title} ${entry.description} ${entry.route}`.toLocaleLowerCase("pt-BR").includes(search);
      return matchesSearch &&
        (moduleFilter === "todos" || entry.module === moduleFilter) &&
        (kindFilter === "todos" || entry.kind === kindFilter) &&
        (statusFilter === "todos" || entry.status === statusFilter) &&
        (viewportFilter === "todos" || entry.viewport === viewportFilter);
    });
  }, [catalog, kindFilter, moduleFilter, query, statusFilter, viewportFilter]);
  const selectedIndex = visibleEntries.findIndex((entry) => entry.id === selectedId);
  const selected = selectedIndex >= 0 ? visibleEntries[selectedIndex] : undefined;
  const kinds = [...new Set((catalog?.entries || []).map((entry) => entry.kind))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const openViewer = useCallback((entry: VisualEntry) => {
    setSelectedId(entry.id);
    setZoom(1);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#capture-${entry.id}`);
  }, []);
  const closeViewer = useCallback(() => {
    setSelectedId("");
    setZoom(1);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }, []);
  const moveViewer = useCallback((delta: number) => {
    if (!visibleEntries.length) return;
    const next = (selectedIndex + delta + visibleEntries.length) % visibleEntries.length;
    openViewer(visibleEntries[next]);
  }, [openViewer, selectedIndex, visibleEntries]);

  useEffect(() => {
    const id = window.location.hash.match(/^#capture-(.+)$/)?.[1];
    if (id && catalog?.entries.some((entry) => entry.id === id && entry.status === "capturada")) setSelectedId(id);
  }, [catalog]);

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeViewer();
      if (event.key === "ArrowRight") moveViewer(1);
      if (event.key === "ArrowLeft") moveViewer(-1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeViewer, moveViewer, selected]);

  if (error) return <section className="visual-library-page"><h1>Biblioteca visual</h1><p role="alert">{error}</p></section>;
  if (!catalog) return <section className="visual-library-page" aria-busy="true"><h1>Biblioteca visual</h1><p role="status">Carregando capturas…</p></section>;

  const countForModule = (moduleId: string) => {
    const entries = catalog.entries.filter((entry) => entry.module === moduleId);
    return { total: entries.length, captured: entries.filter((entry) => entry.status === "capturada").length, pending: entries.filter((entry) => ["pendente", "bloqueada"].includes(entry.status)).length };
  };
  const flowEntries = (flow: VisualFlow) => flow.entryIds.map((id) => catalog.entries.find((entry) => entry.id === id)).filter((entry): entry is VisualEntry => Boolean(entry));

  return (
    <section className="visual-library-page">
      <header className="visual-library-header">
        <div><span className="visual-library-eyebrow">REFERÊNCIA COMPARTILHADA</span><h1>Biblioteca visual</h1><p>Telas reais do sistema, capturadas com dados fictícios e organizadas por área.</p></div>
        <a className="visual-library-doc-link" href="https://github.com/horsepowerlondrina-arch/sistemaoficinas/tree/main/docs/mapeamento-visual" target="_blank" rel="noreferrer">Abrir documentação no GitHub</a>
      </header>

      <section aria-label="Módulos da biblioteca" className="visual-library-modules">
        {catalog.modules.map((module) => {
          const count = countForModule(module.id);
          return <a id={`module-${module.id}`} href={`#module-${module.id}`} className={`visual-module-card ${moduleFilter === module.id ? "selected" : ""}`} key={module.id} onClick={(event) => { event.preventDefault(); window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#module-${module.id}`); setModuleFilter(moduleFilter === module.id ? "todos" : module.id); document.getElementById("visual-captures")?.scrollIntoView({ behavior: "smooth" }); }}>
            <span className="visual-module-number">{module.id.split("-")[0]}</span><strong>{module.name}</strong><small>{module.description}</small><span className="visual-module-count">{count.captured} capturadas · {count.pending} pendentes</span>
          </a>;
        })}
      </section>

      <section className="visual-library-flows" aria-labelledby="visual-flows-title">
        <div className="visual-section-heading"><div><span className="visual-library-eyebrow">SEQUÊNCIAS</span><h2 id="visual-flows-title">Fluxos completos</h2></div></div>
        <div className="visual-flow-list">{catalog.flows.map((flow) => <article className="visual-flow-card" key={flow.id}>
          <div className="visual-flow-heading"><strong>{flow.name}</strong><span className={`visual-status status-${flow.status.replaceAll(" ", "-")}`}>{statusLabels[flow.status]}</span></div><p>{flow.description}</p>
          {flow.reason && <small>{flow.reason}</small>}
          <ol>{flowEntries(flow).map((entry) => <li key={entry.id}><button onClick={() => entry.status === "capturada" && openViewer(entry)} disabled={entry.status !== "capturada"}>{entry.title}</button></li>)}</ol>
        </article>)}</div>
      </section>

      <section id="visual-captures" className="visual-captures-section" aria-labelledby="visual-captures-title">
        <div className="visual-section-heading"><div><span className="visual-library-eyebrow">TELAS E INTERAÇÕES</span><h2 id="visual-captures-title">Capturas</h2></div><span className="visual-results-count">{visibleEntries.length} itens</span></div>
        <div className="visual-library-filters">
          <label className="visual-search"><Search size={18} aria-hidden="true"/><span className="sr-only">Pesquisar capturas</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar tela, descrição ou rota" /></label>
          <label><span>Módulo</span><select aria-label="Módulo" value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)}><option value="todos">Todos</option>{catalog.modules.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}</select></label>
          <label><span>Interação</span><select aria-label="Interação" value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}><option value="todos">Todos os tipos</option>{kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
          <label><span>Estado</span><select aria-label="Estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="todos">Todos</option>{Object.keys(statusLabels).map((status) => <option key={status}>{status}</option>)}</select></label>
          <label><span>Tela</span><select aria-label="Tela" value={viewportFilter} onChange={(event) => setViewportFilter(event.target.value)}><option value="todos">Desktop e mobile</option><option value="desktop">Desktop</option><option value="mobile">Mobile</option></select></label>
        </div>
        {visibleEntries.length ? <div className="visual-capture-grid">{visibleEntries.map((entry) => <article className="visual-capture-card" id={`capture-${entry.id}`} key={entry.id}>
          <button className="visual-capture-preview" onClick={() => entry.status === "capturada" && openViewer(entry)} disabled={entry.status !== "capturada"} aria-label={entry.status === "capturada" ? `Ampliar captura: ${entry.title}` : `Captura pendente: ${entry.title}`}>
            {entry.image ? <img src={imageUrl(entry)} alt={`Captura da tela ${entry.title}`} loading="lazy"/> : <span className="visual-no-image">Captura ainda não disponível</span>}
            <span className={`visual-status status-${entry.status.replaceAll(" ", "-")}`}>{statusLabels[entry.status]}</span>
          </button>
          <div className="visual-capture-copy"><div className="visual-capture-meta"><span>{catalog.modules.find((module) => module.id === entry.module)?.name || entry.module}</span><span>{entry.viewport === "desktop" ? "Desktop" : "Mobile"}</span></div><h3><a href={`#capture-${entry.id}`} onClick={(event) => { event.preventDefault(); if (entry.status === "capturada") openViewer(entry); }}>{entry.title}</a></h3><p>{entry.description}</p><code>{entry.route}</code>
            <div className="visual-capture-footer"><span>{entry.updatedAt ? new Date(`${entry.updatedAt}T12:00:00`).toLocaleDateString("pt-BR") : "Data pendente"}</span><span>{entry.commit ? entry.commit.slice(0, 7) : "Commit não registrado"}</span></div>
            {entry.reason && <small className="visual-entry-reason">{entry.reason}</small>}
          </div>
        </article>)}</div> : <p className="visual-empty-state">Nenhuma captura corresponde a esses filtros.</p>}
      </section>

      {selected && <div className="visual-viewer-backdrop" role="presentation" onClick={closeViewer}>
        <section className="visual-viewer" role="dialog" aria-modal="true" aria-label={`Captura ampliada: ${selected.title}`} onClick={(event) => event.stopPropagation()}>
          <header className="visual-viewer-header"><div><span>{selected.title}</span><small>{selected.description}</small></div><button className="visual-viewer-close" onClick={closeViewer} aria-label="Fechar visualização"><X size={22}/></button></header>
          <div className="visual-viewer-image-wrap"><img src={imageUrl(selected)} alt={`Captura ampliada: ${selected.title}`} style={{ transform: `scale(${zoom})` }} /></div>
          <footer className="visual-viewer-footer"><div className="visual-viewer-zoom"><button aria-label="Diminuir zoom" onClick={() => setZoom(Math.max(0.75, zoom - 0.25))}><ZoomOut size={18}/></button><span><ZoomIn size={15}/> {Math.round(zoom * 100)}%</span><button aria-label="Aumentar zoom" onClick={() => setZoom(Math.min(2.5, zoom + 0.25))}><ZoomIn size={18}/></button></div><span>{selected.updatedAt ? new Date(`${selected.updatedAt}T12:00:00`).toLocaleDateString("pt-BR") : "Data pendente"} · {selected.commit || "Commit não registrado"}</span><div className="visual-viewer-nav"><button aria-label="Captura anterior" onClick={() => moveViewer(-1)}><ArrowLeft size={18}/></button><button aria-label="Próxima captura" onClick={() => moveViewer(1)}><ArrowRight size={18}/></button></div></footer>
        </section>
      </div>}
    </section>
  );
}
