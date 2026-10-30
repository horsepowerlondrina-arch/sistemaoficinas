import { useEffect, useState } from "react";
import { technicalLaborPrice } from "../../shared/serviceTabs";
import { api } from "../lib/api";
import { money, type Entity } from "../lib/types";
import { Field } from "./ui";

type CatalogInfo = {
  enabled: boolean;
  catalog_status: string;
  categories: Entity[];
};

const accessMessages: Record<string, string> = {
  not_contracted: "O Catálogo de Tempos não está habilitado para esta oficina.",
  expired: "O acesso ao Catálogo de Tempos venceu. Solicite a renovação à administração da plataforma.",
  revoked: "O acesso ao Catálogo de Tempos foi revogado para esta oficina.",
  administratively_disabled: "O Catálogo de Tempos foi desabilitado pela administração da plataforma.",
  not_installed: "O Catálogo de Tempos ainda não está disponível neste ambiente.",
};

export function TechnicalServiceCatalog({ enabled, initialQuery = "" }: { enabled: boolean; initialQuery?: string }) {
  const [info, setInfo] = useState<CatalogInfo | null>(null);
  const [accessError, setAccessError] = useState("");
  const [brandQuery, setBrandQuery] = useState("");
  const [brand, setBrand] = useState<Entity | null>(null);
  const [brands, setBrands] = useState<Entity[]>([]);
  const [brandOpen, setBrandOpen] = useState(false);
  const [brandLoading, setBrandLoading] = useState(false);
  const [brandError, setBrandError] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [model, setModel] = useState<Entity | null>(null);
  const [modelDetails, setModelDetails] = useState<Entity | null>(null);
  const [models, setModels] = useState<Entity[]>([]);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState("");
  const [query, setQuery] = useState(initialQuery);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<Entity[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    api<CatalogInfo>("/repair-services/config")
      .then((value) => { if (active) setInfo(value); })
      .catch((error) => { if (active) setAccessError((error as Error).message); });
    return () => { active = false; };
  }, [enabled]);

  const available = enabled && info?.enabled;
  useEffect(() => {
    if (!available || !brandOpen) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setBrandLoading(true); setBrandError("");
      api<{ items: Entity[] }>(`/repair-services/brands?${new URLSearchParams({ q: brandQuery })}`)
        .then((value) => { if (active) setBrands(value.items); })
        .catch((error) => { if (active) setBrandError((error as Error).message); })
        .finally(() => { if (active) setBrandLoading(false); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [available, brandOpen, brandQuery]);

  useEffect(() => {
    if (!available || !brand?.id || !modelOpen) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setModelLoading(true); setModelError("");
      api<{ items: Entity[] }>(`/repair-services/models?${new URLSearchParams({ brand_id: String(brand.id), q: modelQuery })}`)
        .then((value) => { if (active) setModels(value.items); })
        .catch((error) => { if (active) setModelError((error as Error).message); })
        .finally(() => { if (active) setModelLoading(false); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [available, brand?.id, modelOpen, modelQuery]);

  useEffect(() => {
    if (!available || !model?.id) return;
    let active = true;
    setModelDetails(null);
    api<Entity>(`/repair-services/models/${model.id}`)
      .then((value) => { if (active) setModelDetails(value); })
      .catch((error) => { if (active) setSearchError((error as Error).message); });
    return () => { active = false; };
  }, [available, model?.id]);

  useEffect(() => {
    if (!available || !model?.id) { setRows([]); setHasMore(false); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true); setSearchError("");
      api<{ items: Entity[]; has_more: boolean }>(`/repair-services/models/${model.id}/services?${new URLSearchParams({ q: query, offset: String(offset) })}`)
        .then((value) => { if (active) { setRows(value.items); setHasMore(value.has_more); } })
        .catch((error) => { if (active) setSearchError((error as Error).message); })
        .finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [available, model?.id, query, offset]);

  const selectBrand = (value: Entity) => {
    setBrand(value); setBrandQuery(String(value.name)); setBrandOpen(false);
    setModel(null); setModelDetails(null); setModelQuery(""); setModels([]); setRows([]); setOffset(0);
  };
  const selectModel = (value: Entity) => {
    setModel(value); setModelQuery(String(value.name)); setModelOpen(false); setRows([]); setOffset(0);
  };
  if (!enabled) return <div className="technical-catalog-access" role="status">O módulo Catálogo de Tempos não está habilitado para esta oficina.</div>;
  if (accessError) return <div className="technical-catalog-access form-error" role="alert">Não foi possível verificar o acesso ao Catálogo de Tempos: {accessError}</div>;
  if (!info) return <div className="technical-catalog-access" role="status">Verificando acesso ao Catálogo de Tempos…</div>;
  if (!info.enabled) return <div className="technical-catalog-access" role="status">{accessMessages[info.catalog_status] || "O Catálogo de Tempos não está disponível para esta oficina."}</div>;

  const categoryId = String(modelDetails?.commercial_category_id || model?.commercial_category_id || "");
  const hourlyRate = Number(info.categories.find((item) => item.id === categoryId)?.hourly_rate || 0);
  const porteName = String(modelDetails?.porte_name || model?.porte_name || "Porte não identificado");
  return <div className="technical-catalog-content">
    <div className="technical-catalog-vehicle-fields">
      <Field label="Marca"><div className="technical-catalog-combobox">
        <input role="combobox" aria-autocomplete="list" aria-expanded={brandOpen} aria-controls="technical-brands" value={brandQuery} onFocus={() => setBrandOpen(true)} onBlur={() => window.setTimeout(() => setBrandOpen(false), 120)} onChange={(event) => { setBrandQuery(event.target.value); setBrand(null); setModel(null); setModelDetails(null); setRows([]); setBrandOpen(true); }} onKeyDown={(event) => { if (event.key === "Escape") setBrandOpen(false); }} placeholder="Pesquisar marca" />
        {brandOpen && <div id="technical-brands" className="technical-catalog-options" role="listbox" aria-label="Marcas">{brandLoading ? <p role="status">Buscando marcas…</p> : brandError ? <p role="alert">{brandError}</p> : brands.length ? brands.map((item) => <button type="button" role="option" aria-selected={brand?.id === item.id} key={item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectBrand(item)}>{item.name}</button>) : <p>Nenhuma marca encontrada.</p>}</div>}
      </div></Field>
      <Field label="Modelo"><div className="technical-catalog-combobox">
        <input role="combobox" aria-autocomplete="list" aria-expanded={modelOpen} aria-controls="technical-models" value={modelQuery} disabled={!brand?.id} onFocus={() => setModelOpen(true)} onBlur={() => window.setTimeout(() => setModelOpen(false), 120)} onChange={(event) => { setModelQuery(event.target.value); setModel(null); setModelDetails(null); setRows([]); setModelOpen(true); }} onKeyDown={(event) => { if (event.key === "Escape") setModelOpen(false); }} placeholder={brand ? "Pesquisar modelo" : "Selecione uma marca"} />
        {modelOpen && <div id="technical-models" className="technical-catalog-options" role="listbox" aria-label="Modelos">{modelLoading ? <p role="status">Buscando modelos…</p> : modelError ? <p role="alert">{modelError}</p> : models.length ? models.map((item) => <button type="button" role="option" aria-selected={model?.id === item.id} key={item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectModel(item)}>{item.name}<small>{item.porte_name}</small></button>) : <p>Nenhum modelo encontrado.</p>}</div>}
      </div></Field>
    </div>
    <div className="technical-catalog-search"><Field label="Pesquisar serviço técnico"><input value={query} onChange={(event) => { setQuery(event.target.value); setRows([]); setLoading(true); setOffset(0); }} disabled={!model?.id} placeholder={model ? "Pesquisar por descrição do serviço..." : "Selecione marca e modelo"} /></Field></div>
    <section className="technical-catalog-results" aria-live="polite">
      <h2>Tempos técnicos</h2>
      {!model ? <p className="muted">Selecione uma marca e um modelo para consultar os serviços.</p> : searchError ? <p className="form-error" role="alert">Não foi possível consultar os serviços técnicos: {searchError}</p> : loading ? <p role="status">Buscando serviços técnicos…</p> : !rows.length ? <p className="muted">Nenhum serviço técnico encontrado para este modelo{query.trim() ? " nesta pesquisa" : ""}.</p> : <>
        <div className="technical-catalog-result-list">{rows.map((row) => {
          const minutes = Number(row.minutes || 0);
          const price = technicalLaborPrice(minutes, hourlyRate);
          return <div className="technical-catalog-result" key={row.service_id || row.id}>
            <strong>{row.name}</strong>
            <span>Tempo: {minutes > 0 ? `${minutes.toLocaleString("pt-BR")} min` : "não cadastrado"}</span>
            <span>Porte: {porteName}</span>
            <strong>Mão de obra: {price === null ? "tarifa não configurada" : money(price)}</strong>
          </div>;
        })}</div>
        <div className="technical-catalog-pagination"><button type="button" className="button" disabled={offset === 0 || loading} onClick={() => setOffset((value) => Math.max(0, value - 50))}>Anterior</button><button type="button" className="button" disabled={!hasMore || loading} onClick={() => setOffset((value) => value + 50)}>Mais serviços</button></div>
      </>}
    </section>
  </div>;
}
