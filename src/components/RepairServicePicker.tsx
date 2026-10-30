import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Pencil, Plus, Tags } from "lucide-react";
import { Link } from "react-router-dom";
import { api, send } from "../lib/api";
import { money, type Entity } from "../lib/types";
import { Field, Modal, PageHeading } from "./ui";
import { NumericInput } from "./NumericInput";
import { thirdPartySalePrice } from "../../shared/pricing";
import { shouldLoadRepairServiceSearch, shouldShowVehicleCatalog, shouldShowWorkshopServices } from "../../shared/repairCatalogVisibility";
import { calculateCatalogDropdownPlacement, canAddRepairServiceImmediately, initialCatalogOptionIndex, nextCatalogOptionIndex, serviceDropdownStateAfterAdd, shouldAutoSelectCatalogVehicle } from "../../shared/catalogPickerUsability";

type Info = { enabled: boolean; catalog_status:"active"|"not_contracted"|"expired"|"revoked"|"not_installed"|"administratively_disabled"; categories: Entity[]; service_markup_bps: number };
const catalogStatusMessage:Record<Exclude<Info["catalog_status"],"active">,string>={
  administratively_disabled:"O acesso ao Catálogo Técnico foi desabilitado pela administração da plataforma.",
  not_contracted:"O Catálogo Técnico é um módulo adicional e não está habilitado para esta oficina.",
  expired:"O acesso ao Catálogo Técnico venceu. Solicite a renovação à administração da plataforma.",
  revoked:"O acesso ao Catálogo Técnico foi revogado. Seus serviços particulares continuam disponíveis.",
  not_installed:"O Catálogo Técnico ainda não foi instalado neste ambiente.",
};
export function LaborRates() {
  const [info, setInfo] = useState<Info | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api<Info>("/repair-services/config")
      .then((v) => active && setInfo(v))
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="panel work-order-section">
      <h3>Valor da hora por porte</h3>
      <p>
        O preço dos serviços internos é o tempo em minutos ÷ 60 × valor da hora
        do porte. Defina os valores usados pela oficina.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className="form-grid">
        {info?.categories.map((p) => (
          <Field key={p.id} label={`${p.name} — R$/hora`}>
            <NumericInput
              type="number"
              min="0"
              step="0.01"
              value={p.hourly_rate / 100}
              onChange={(e) =>
                setInfo({
                  ...info,
              categories: info.categories.map((r) =>
                    r.id === p.id
                      ? {
                          ...r,
                          hourly_rate: Math.round(Number(e.target.value) * 100),
                        }
                      : r,
                  ),
                })
              }
            />
          </Field>
        ))}
      </div>
      <button
        type="button"
        className="button primary"
        disabled={!info || busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          setMessage("");
          try {
            await send(
              "/repair-services/rates",
              {
                rates: info!.categories.map((p) => ({
                  category_id: p.id,
                  hourly_rate: p.hourly_rate,
                })),
              },
              "PUT",
            );
            setMessage("Valores da hora salvos para esta oficina.");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Salvar valores da hora
      </button>
    </section>
  );
}
function generatedWorkshopServiceReference() {
  return `SRV-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}
function WorkshopServiceManagerForm({ initial, categories, onClose, onSaved, onCategoryCreated }: {
  initial?: Entity;
  categories: Entity[];
  onClose: () => void;
  onSaved: (service: Entity) => void;
  onCategoryCreated: (category: Entity) => void;
}) {
  const [reference, setReference] = useState(String(initial?.reference || generatedWorkshopServiceReference()));
  const [name, setName] = useState(String(initial?.name || ""));
  const [categoryId, setCategoryId] = useState(String(initial?.category_id || ""));
  const [categoryQuery, setCategoryQuery] = useState(String(initial?.category_name || ""));
  const [cost, setCost] = useState(Number(initial?.cost || 0));
  const [costKnown, setCostKnown] = useState(initial ? initial.cost_known !== 0 : true);
  const [price, setPrice] = useState(Number(initial?.price || 0));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const normalizedQuery = normalizeCatalogValue(categoryQuery);
  const exactCategory = categories.find((row) => normalizeCatalogValue(String(row.name)) === normalizedQuery);
  const categoryMatches = categories.filter((row) => row.active || row.id === categoryId)
    .filter((row) => !normalizedQuery || normalizeCatalogValue(String(row.name)).includes(normalizedQuery)).slice(0, 8);
  async function createCategory() {
    const value = categoryQuery.trim();
    if (value.length < 2) return;
    setCategoryBusy(true); setError("");
    try {
      const result = await send("/workshop-service-categories", { name: value }) as { id: string };
      const category = { id: result.id, name: value, active: 1 } as Entity;
      onCategoryCreated(category); setCategoryId(category.id); setCategoryQuery(value);
    } catch (e) { setError((e as Error).message); }
    finally { setCategoryBusy(false); }
  }
  async function calculateThirdPartyPrice(enteredCost: number) {
    if (!Number.isSafeInteger(enteredCost) || enteredCost <= 0) {
      setError("Informe um custo maior que zero para calcular o preço de venda.");
      return;
    }
    setCalculating(true); setError("");
    try {
      const pricing = await api<{ service_markup_bps: number }>("/repair-services/config");
      setPrice(thirdPartySalePrice(enteredCost, pricing.service_markup_bps));
    } catch (e) { setError(`Não foi possível calcular o preço de venda: ${(e as Error).message}`); }
    finally { setCalculating(false); }
  }
  return <Modal title={initial ? "Editar serviço próprio" : "Cadastrar serviço próprio"} description="Serviço particular desta oficina." onClose={onClose}>
    <div className="modal-body">
      <div className="form-grid">
        <Field label="Referência" full><input value={reference} maxLength={40} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label="Descrição" full><input value={name} maxLength={300} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Categoria (opcional)" full>
          <input value={categoryQuery} maxLength={100} autoComplete="off" placeholder="Pesquisar ou criar categoria" onChange={(e) => {
            const value = e.target.value; setCategoryQuery(value);
            const match = categories.find((row) => row.active && normalizeCatalogValue(String(row.name)) === normalizeCatalogValue(value));
            setCategoryId(match ? String(match.id) : "");
          }} />
          {categoryQuery && categoryMatches.length > 0 && <div className="repair-results" role="listbox" aria-label="Categorias próprias">
            {categoryMatches.map((row) => <button className="button" type="button" role="option" key={row.id} disabled={!row.active} onClick={() => { setCategoryId(String(row.id)); setCategoryQuery(String(row.name)); }}>
              {row.name}{!row.active ? " · Inativa" : ""}
            </button>)}
          </div>}
          {categoryQuery.trim().length >= 2 && !exactCategory && <button type="button" className="text-button" disabled={categoryBusy} onClick={() => void createCategory()}>{categoryBusy ? "Criando…" : `Criar categoria “${categoryQuery.trim()}”`}</button>}
          {categoryId && <button type="button" className="text-button" onClick={() => { setCategoryId(""); setCategoryQuery(""); }}>Remover categoria</button>}
        </Field>
        <Field label="Custo do serviço/terceiros (R$)"><NumericInput type="number" min="0" step="0.01" value={cost / 100} disabled={calculating} onChange={(e) => { setCost(Math.round(Number(e.target.value) * 100)); setCostKnown(true); }} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void calculateThirdPartyPrice(Math.round(Number(e.currentTarget.value) * 100)); } }} /></Field>
        <Field label="Preço de venda (R$)"><NumericInput type="number" min="0.01" step="0.01" value={price / 100} disabled={calculating} onChange={(e) => setPrice(Math.round(Number(e.target.value) * 100))} /></Field>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="capture-actions">
        <button type="button" className="button" onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="button" className="button primary" disabled={busy || calculating || name.trim().length < 2 || !reference.trim() || !Number.isSafeInteger(cost) || cost < 0 || !Number.isSafeInteger(price) || price < 1} onClick={async () => {
          setBusy(true); setError("");
          try {
            const result = await send(initial ? `/workshop-services/${initial.id}` : "/workshop-services", {
              service_type: "private", name: name.trim(), reference: reference.trim(), category_id: categoryId || null, price, cost, cost_known: costKnown,
            }, initial ? "PUT" : "POST") as { id: string };
            onSaved({ id: initial?.id || result.id, name: name.trim(), reference: reference.trim(), category_id: categoryId || null, price, cost, cost_known: costKnown, active: 1, service_type: "private" });
          } catch (e) { setError((e as Error).message); }
          finally { setBusy(false); }
        }}>Salvar cadastro</button>
      </div>
    </div>
  </Modal>;
}
function WorkshopServiceCategories({ onClose, categories, onChanged }: { onClose: () => void; categories: Entity[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <Modal title="Categorias de serviços próprios" description="As categorias pertencem a esta oficina. Inativar preserva os vínculos existentes." onClose={onClose} wide>
    <div className="modal-body">
      <div className="capture-actions service-category-create"><Field label="Nova categoria"><input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></Field>
        <button type="button" className="button primary" disabled={busy || name.trim().length < 2} onClick={async () => { setBusy(true); setError(""); try { await send("/workshop-service-categories", { name: name.trim() }); setName(""); onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Criar categoria</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="repair-results">{categories.map((row) => <div className="repair-result" key={row.id}>
        <div>{editing === row.id ? <input aria-label="Nome da categoria" value={draft} maxLength={100} onChange={(e) => setDraft(e.target.value)} /> : <><strong>{row.name}</strong><small>{Number(row.service_count || 0)} serviços vinculados · {row.active ? "Ativa" : "Inativa"}</small></>}</div>
        <div className="capture-actions">{editing === row.id ? <><button type="button" className="text-button" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await send(`/workshop-service-categories/${row.id}`, { name: draft.trim() }, "PUT"); setEditing(""); onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Salvar</button><button type="button" className="text-button" onClick={() => setEditing("")}>Cancelar</button></> : <button type="button" className="text-button" onClick={() => { setEditing(String(row.id)); setDraft(String(row.name)); }}>Editar</button>}
          <button type="button" className="text-button" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await send(`/workshop-service-categories/${row.id}/status`, { active: !row.active }, "PATCH"); onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>{row.active ? "Inativar" : "Reativar"}</button>
        </div>
      </div>)}</div>
      <div className="capture-actions"><button type="button" className="button" onClick={onClose}>Fechar</button></div>
    </div>
  </Modal>;
}
export function WorkshopServices({ embedded = false, newServiceTrigger = 0, onFormOpenChange }: {
  embedded?: boolean;
  newServiceTrigger?: number;
  onFormOpenChange?: (open: boolean) => void;
}) {
  const [rows, setRows] = useState<Entity[]>([]);
  const [categories, setCategories] = useState<Entity[]>([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const [editing, setEditing] = useState<Entity | null | undefined>(undefined);
  const [manageCategories, setManageCategories] = useState(false);
  const [error, setError] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (newServiceTrigger > 0) setEditing(null); }, [newServiceTrigger]);
  useEffect(() => { onFormOpenChange?.(editing !== undefined || manageCategories); }, [editing, manageCategories, onFormOpenChange]);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      const params = new URLSearchParams({ q: query, status, service_type: "private" });
      if (categoryFilter) params.set("private_category_id", categoryFilter);
      api<{ items: Entity[] }>("/workshop-services?" + params)
        .then((result) => active && setRows(result.items))
        .catch((e) => active && setError(e.message))
        .finally(() => active && setLoading(false));
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, categoryFilter, status, revision]);
  useEffect(() => {
    let active = true;
    setCategoryError("");
    api<{ items: Entity[] }>("/workshop-service-categories?status=all")
      .then((result) => active && setCategories(result.items))
      .catch((e) => active && setCategoryError(e.message));
    return () => { active = false; };
  }, [revision]);
  const refresh = () => setRevision((value) => value + 1);
  const addCategory = (category: Entity) => setCategories((current) => [category, ...current.filter((row) => row.id !== category.id)]);
  const hasFilters = Boolean(query.trim() || categoryFilter || status !== "active");
  return <>
    {!embedded && <PageHeading title="Serviços Próprios" description="Gerencie os serviços particulares da oficina." actions={
      <button type="button" className="button primary" onClick={() => setEditing(null)}><Plus size={16} aria-hidden="true" /> Novo serviço</button>
    } />}
    <section className="panel workshop-services-panel" aria-label="Serviços próprios">
      <div className="workshop-services-search">
        <Field label="Pesquisar serviços"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar por descrição ou referência..." /></Field>
      </div>
      <div className="workshop-services-filters">
        <Field label="Categoria"><select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}><option value="">Todas as categorias</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{!category.active ? " (inativa)" : ""}</option>)}</select></Field>
        <Field label="Situação"><select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="active">Ativos</option><option value="inactive">Inativos</option><option value="all">Todos</option></select></Field>
        <button type="button" className="button" onClick={() => setManageCategories(true)}><Tags size={16} aria-hidden="true" /> Categorias</button>
      </div>
      {categoryError && <p className="form-error" role="alert">Não foi possível carregar as categorias: {categoryError}</p>}
      <div className="workshop-services-list-section">
        <h2>Serviços cadastrados</h2>
        {error && <p className="form-error" role="alert">Não foi possível carregar os serviços: {error}</p>}
        {loading ? <p role="status">Buscando serviços…</p> : error ? null : rows.length ? <div className="workshop-services-list">{rows.map((row) => <div className="workshop-services-item" key={row.id}>
          <div className="workshop-services-item-details"><strong>{row.name}</strong><small>Referência: {row.reference || "—"} · Categoria: {row.category_name || "Sem categoria"}</small></div>
          <strong className="workshop-services-price">{money(Number(row.price || 0))}</strong>
          <div className="workshop-services-item-actions">
            <button type="button" className="text-button" onClick={() => setEditing(row)}><Pencil size={15} aria-hidden="true" /> Editar</button>
            <button type="button" className="text-button" onClick={async () => { try { await send(`/workshop-services/${row.id}/status`, { active: !row.active }, "PATCH"); refresh(); } catch (e) { setError((e as Error).message); } }}>{row.active ? "Inativar" : "Reativar"}</button>
          </div>
        </div>)}</div> : <p className="workshop-services-empty">{hasFilters ? "Nenhum serviço corresponde à pesquisa ou aos filtros." : "Nenhum serviço ativo cadastrado."}</p>}
      </div>
    </section>
    {editing !== undefined && <WorkshopServiceManagerForm initial={editing || undefined} categories={categories} onClose={() => setEditing(undefined)} onCategoryCreated={addCategory} onSaved={() => { setEditing(undefined); refresh(); }} />}
    {manageCategories && <WorkshopServiceCategories categories={categories} onClose={() => setManageCategories(false)} onChanged={refresh} />}
  </>;
}
const normalizeCatalogValue = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
const formatCatalogMinutes = (value: unknown) => {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(total / 60), minutes = total % 60;
  return [hours ? hours + "h" : "", minutes || !hours ? minutes + " min" : ""].filter(Boolean).join(" ");
};

export function RepairServicePicker({ vehicle, modelId, onModelChange, onAdd, brandLocked = false, vehicleOnly = false, autoIdentify = true }: {
  vehicle?: Record<string, any>;
  modelId: string;
  onModelChange: (id: string) => void;
  onAdd?: (item: Entity) => void;
  brandLocked?: boolean;
  vehicleOnly?: boolean;
  autoIdentify?: boolean;
}) {
  const [info, setInfo] = useState<Info | null>(null), [error, setError] = useState("");
  const [linkStatus, setLinkStatus] = useState<"linked"|"matched"|"needs_confirmation"|"not_identified"|"unavailable"|"mismatch">(modelId ? "linked" : "not_identified");
  const autoMatchTried = useRef("");
  const manualEditKey = useRef("");
  const vehicleIdentity = [vehicle?.id, vehicle?.plate, vehicle?.brand, vehicle?.model, vehicle?.year, vehicle?.fipe_code, vehicle?.fipe_model, vehicle?.fipe_year_id].join("|");
  const [mode, setMode] = useState("manual");
  const [models, setModels] = useState<Entity[]>([]), [modelSearch, setModelSearch] = useState(String(vehicle?.model || vehicle?.fipe_model || "")),
    [modelOffset, setModelOffset] = useState(0), [moreModels, setMoreModels] = useState(false);
  const [brand, setBrand] = useState<Entity | null>(null), [brandQuery, setBrandQuery] = useState(String(vehicle?.brand || "")),
    [brandOptions, setBrandOptions] = useState<Entity[]>([]), [brandOffset, setBrandOffset] = useState(0),
    [brandMore, setBrandMore] = useState(false), [brandOpen, setBrandOpen] = useState(false), [modelOpen, setModelOpen] = useState(false),
    [brandActiveIndex, setBrandActiveIndex] = useState(-1), [modelActiveIndex, setModelActiveIndex] = useState(-1),
    [serviceOpen, setServiceOpen] = useState(false), [serviceActiveIndex, setServiceActiveIndex] = useState(-1),
    [modelsLoading, setModelsLoading] = useState(false), [autoBrandPending, setAutoBrandPending] = useState(false);
  const [porte, setPorte] = useState(String(vehicle?.service_porte_id || "")),
    [commercialCategory, setCommercialCategory] = useState(String(vehicle?.service_commercial_category_id || "")),
    [search, setSearch] = useState(""), [offset, setOffset] = useState(0), [rows, setRows] = useState<Entity[]>([]),
    [more, setMore] = useState(false), [loading, setLoading] = useState(false), [revision, setRevision] = useState(0);
  const pickerRef = useRef<HTMLElement | null>(null), dropdownRef = useRef<HTMLDivElement | null>(null);
  const brandInputRef = useRef<HTMLInputElement | null>(null), modelInputRef = useRef<HTMLInputElement | null>(null), serviceInputRef = useRef<HTMLInputElement | null>(null);
  const suppressServiceFocusOpen = useRef(false);
  const addInFlight = useRef(false);
  const [quickCategories, setQuickCategories] = useState<Entity[]>([]);
  const dropdownId = useId().replace(/:/g, "");
  const [dropdownPosition, setDropdownPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const openKind = brandOpen ? "brand" : modelOpen ? "vehicle" : serviceOpen && mode === "catalog" ? "service" : null;
  useEffect(() => {
    const closeIfOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (pickerRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setBrandOpen(false); setModelOpen(false); setServiceOpen(false);
    };
    document.addEventListener("pointerdown", closeIfOutside);
    return () => document.removeEventListener("pointerdown", closeIfOutside);
  }, []);
  useEffect(() => {
    if (!openKind) { setDropdownPosition(null); return; }
    const update = () => {
      const anchor = openKind === "brand" ? brandInputRef.current : openKind === "vehicle" ? modelInputRef.current : serviceInputRef.current;
      if (!anchor) return;
      const placement = calculateCatalogDropdownPlacement(
        anchor.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
      );
      setDropdownPosition(placement);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [openKind]);
  const [editing, setEditing] = useState<Entity | null | undefined>(), [selected, setSelected] = useState<Entity | null>(null),
    [execution, setExecution] = useState("internal"), [cost, setCost] = useState(0), [minutes, setMinutes] = useState(0),
    [price, setPrice] = useState(0), [inputMode, setInputMode] = useState("time"), [adding, setAdding] = useState(false);
  useEffect(() => {
    if (editing === undefined || vehicleOnly) return;
    let active = true;
    api<{ items: Entity[] }>("/workshop-service-categories?status=all").then((result) => { if (active) setQuickCategories(result.items); }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [editing, vehicleOnly]);
  useEffect(() => {
    let active = true;
    api<Info>(vehicleOnly ? "/repair-services/access" : "/repair-services/config").then((v) => { if (active) { setInfo(v); setMode(v.enabled ? "catalog" : "manual"); } }).catch((e) => active && setError(e.message));
    return () => { active = false; };
  }, [vehicleOnly]);
  useEffect(() => {
    let active = true;
    const key = vehicleIdentity;
    if (!autoIdentify || vehicle?.service_link_mode === "none" || !vehicle || modelId || !info?.enabled || !key.replace(/\|/g, "")) { if (!info?.enabled) setLinkStatus("unavailable"); return () => { active = false; }; }
    if (manualEditKey.current === key || autoMatchTried.current === key) return () => { active = false; };
    autoMatchTried.current = key;
    send("/repair-services/identify-model", { vehicle }, "POST").then((result: any) => {
      if (!active) return;
      setLinkStatus(result.status || "not_identified");
      if (shouldAutoSelectCatalogVehicle(result) && result.model) {
        const row = result.model as Entity;
        setBrand({ id: row.brand_id, name: row.brand }); setBrandQuery(String(row.brand || ""));
        setModelSearch(String(row.name || "")); setBrandOpen(false); setModelOpen(false);
        onModelChange(String(row.id));
      } else if (result.status === "needs_confirmation" && result.candidates?.length) {
        const first = result.candidates[0] as Entity;
        setBrand({ id: first.brand_id, name: first.brand }); setBrandQuery(String(first.brand || ""));
        setModelSearch(String(vehicle.fipe_model || vehicle.model || "")); setModelOpen(false);
      }
    }).catch((e: any) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [vehicleIdentity, modelId, info?.enabled, onModelChange, autoIdentify]);
  useEffect(() => {
    let active = true;
    if (!modelId) { setPorte(""); setCommercialCategory(""); return () => { active = false; }; }
    if (!info?.enabled) return () => { active = false; };
    api<Entity>(`/repair-services/models/${modelId}`).then((v) => {
      if (!active) return;
      setBrand({ id: v.brand_id, name: v.brand }); setBrandQuery(String(v.brand || ""));
      setModelSearch(String(v.name || "")); setBrandOpen(false); setModelOpen(false); setAutoBrandPending(false); setLinkStatus("linked");
      send("/repair-services/identify-model", { vehicle: { ...vehicle, service_model_id: modelId } }, "POST").then((result: any) => { if (active) setLinkStatus(result.status || "linked"); }).catch(() => {});
      setPorte(v.porte_id || ""); setCommercialCategory(v.commercial_category_id || ""); setError("");
      setSearch(""); setOffset(0);
      if (!vehicleOnly) setServiceOpen(false);
    }).catch((e) => {
      if (!active) return;
      const message = String(e?.message || e);
      if (message.includes("Modelo não encontrado no catálogo")) {
        setBrand(null); setBrandQuery(String(vehicle?.brand || ""));
        setModelSearch(String(vehicle?.model || vehicle?.fipe_model || "")); setAutoBrandPending(!!vehicle?.brand);
        setBrandOpen(false); setModelOpen(false);
        setPorte(""); setCommercialCategory(""); setLinkStatus("mismatch"); setError("");
      } else setError(message);
    });
    return () => { active = false; };
  }, [modelId, info?.enabled, vehicle?.brand, vehicle?.model, vehicle?.fipe_model, vehicle?.fipe_code]);
  useEffect(() => {
    let active = true; setBrandOptions([]); setBrandMore(false);
    if (!info?.enabled || mode !== "catalog" || (!brandOpen && !autoBrandPending)) return () => { active = false; };
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: brandQuery, offset: String(brandOffset) });
      api<{ items: Entity[]; has_more: boolean }>("/repair-services/brands?" + params).then((v) => {
        if (!active) return; setBrandOptions(v.items); setBrandMore(v.has_more); setBrandActiveIndex(initialCatalogOptionIndex(v.items.length));
        if (autoBrandPending && normalizeCatalogValue(brandQuery) === normalizeCatalogValue(String(vehicle?.brand || ""))) {
          const exact = v.items.filter((item) => normalizeCatalogValue(String(item.name)) === normalizeCatalogValue(brandQuery));
          if (exact.length === 1) {
            setBrand(exact[0]); setBrandQuery(String(exact[0].name)); setBrandOpen(false);
            setModelSearch(String(vehicle?.model || vehicle?.fipe_model || "")); setModelOpen(!!(vehicle?.model || vehicle?.fipe_code));
          }
          setAutoBrandPending(false);
        }
      }).catch((e) => active && setError(e.message));
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [info?.enabled, mode, brandQuery, brandOffset, brandOpen, autoBrandPending, vehicle?.brand, vehicle?.model, vehicle?.fipe_model, vehicle?.fipe_code]);
  useEffect(() => {
    let active = true; setModels([]); setMoreModels(false);
    if (!info?.enabled || mode !== "catalog" || !brand?.id || !modelOpen) { setModelsLoading(false); return () => { active = false; }; }
    setModelsLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ brand_id: String(brand.id), q: modelSearch, fipe: String(vehicle?.fipe_code || ""), preferred: String(vehicle?.model || vehicle?.fipe_model || ""), year: String(vehicle?.year || ""), offset: String(modelOffset) });
      api<{ items: Entity[]; has_more: boolean }>("/repair-services/models?" + params).then((v) => {
        if (!active) return; setModels(v.items); setMoreModels(v.has_more); setModelActiveIndex(initialCatalogOptionIndex(v.items.length));
      }).catch((e) => active && setError(e.message)).finally(() => active && setModelsLoading(false));
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [info?.enabled, mode, brand?.id, modelOpen, modelSearch, vehicle?.fipe_code, vehicle?.model, vehicle?.fipe_model, vehicle?.year, modelOffset]);
  useEffect(() => {
    let active = true; setRows([]); setMore(false); setLoading(false);
    if (!shouldLoadRepairServiceSearch(mode, vehicleOnly, modelId, serviceOpen) || (mode === "manual" && !search.trim()) || (mode === "catalog" && linkStatus === "mismatch")) return () => { active = false; };
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: search, offset: String(offset) });
      if (mode === "manual") { params.set("service_type", "private"); params.set("status", "active"); }
      if (mode === "catalog" && commercialCategory) params.set("category_id", commercialCategory);
      api(mode === "catalog" ? `/repair-services/models/${modelId}/services?${params}` : `/workshop-services?${params}`)
        .then((v) => { if (active) { setRows(v.items); setMore(v.has_more); setServiceActiveIndex(initialCatalogOptionIndex(v.items.length)); } })
        .catch((e) => active && setError(e.message)).finally(() => active && setLoading(false));
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [mode, modelId, commercialCategory, search, offset, revision, serviceOpen, vehicleOnly, linkStatus]);
  const rate = Number(info?.categories.find((p) => p.id === commercialCategory)?.hourly_rate || 0);
  async function addService(
    row: Entity,
    values: { execution?: string; cost?: number; minutes?: number; price?: number; inputMode?: string; commercialCategoryId?: string; porteId?: string } = {},
  ) {
    if (!onAdd || addInFlight.current) return false;
    const isPrivate = row.service_type === "private" || mode === "manual";
    const categoryId = isPrivate ? "" : values.commercialCategoryId ?? row.commercial_category_id ?? commercialCategory;
    const executionValue = values.execution ?? String(row.execution || "internal");
    const costValue = values.cost ?? Number(row.cost || 0);
    const minutesValue = values.minutes ?? Number(row.minutes || 0);
    const priceValue = values.price ?? Number(row.price || 0);
    const pricingMode = values.inputMode ?? String(row.pricing_mode || "time");
    const hourlyRate = Number(info?.categories.find((category) => category.id === categoryId)?.hourly_rate || 0);
    if (!isPrivate && !canAddRepairServiceImmediately({
      execution: executionValue, cost: costValue, minutes: minutesValue,
      hourlyRate, price: priceValue, pricingMode, hasCategory: !!categoryId,
    })) return false;
    if (isPrivate && (!Number.isSafeInteger(priceValue) || priceValue < 1)) return false;
    addInFlight.current = true;
    setAdding(true);
    setError("");
    try {
      const selection = {
        ...(!isPrivate
          ? { repair_service_id: row.service_id, repair_model_id: modelId }
          : { workshop_service_id: row.id }),
        ...(!isPrivate && (values.porteId ?? porte) ? { porte_id: values.porteId ?? porte } : {}),
        ...(categoryId ? { commercial_category_id: categoryId } : {}),
        service_execution: executionValue,
        service_cost: costValue,
        ...(minutesValue > 0 ? { service_minutes: minutesValue } : {}),
        ...(isPrivate || (pricingMode === "price" && priceValue > 0) ? { manual_price: priceValue } : {}),
      };
      const preview = await send("/repair-services/preview", selection);
      onAdd({
        ...preview,
        ...selection,
        id: crypto.randomUUID(),
        quantity: 1,
        professional_id: "",
        duration_seconds: preview.minutes * 60,
        service_details: preview,
      });
      setSelected(null);
      setSearch("");
      setOffset(0);
      const nextServiceDropdown = serviceDropdownStateAfterAdd();
      setServiceActiveIndex(nextServiceDropdown.activeIndex);
      setServiceOpen(nextServiceDropdown.open);
      setBrandOpen(false);
      setModelOpen(false);
      suppressServiceFocusOpen.current = true;
      window.setTimeout(() => {
        serviceInputRef.current?.focus();
        window.setTimeout(() => { suppressServiceFocusOpen.current = false; }, 0);
      }, 0);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      addInFlight.current = false;
      setAdding(false);
    }
  }
  const readyToAdd = selected ? mode === "manual"
    ? Number.isSafeInteger(price) && price >= 1
    : canAddRepairServiceImmediately({
        execution, cost, minutes, hourlyRate: rate, price,
        pricingMode: inputMode, hasCategory: !!commercialCategory,
      }) : false;
  function closeDropdowns() { setBrandOpen(false); setModelOpen(false); setServiceOpen(false); }
  function openBrandDropdown() {
    if (brandLocked) return;
    setBrandOpen(true); setModelOpen(false); setServiceOpen(false);
  }
  function openModelDropdown() {
    if (!brand?.id) return;
    setBrandOpen(false); setModelOpen(true); setServiceOpen(false);
  }
  function openServiceDropdown() {
    if ((mode === "catalog" && !modelId) || (mode === "catalog" && linkStatus === "mismatch")) return;
    setBrandOpen(false); setModelOpen(false); setServiceOpen(true);
  }
  function toggleBrandDropdown() { if (brandOpen) setBrandOpen(false); else openBrandDropdown(); }
  function toggleModelDropdown() { if (modelOpen) setModelOpen(false); else openModelDropdown(); }
  function toggleServiceDropdown() { if (serviceOpen) setServiceOpen(false); else openServiceDropdown(); }
  function choose(row: Entity) {
    if (mode === "catalog" && linkStatus === "mismatch") return;
    if (mode === "manual") { void addService(row); return; }
    setSelected(row);
    setSearch(String(row.name || "")); closeDropdowns();
    const categoryId = String(row.commercial_category_id || commercialCategory);
    const nextExecution = String(row.execution || "internal");
    const nextCost = Number(row.cost || 0);
    const nextMinutes = Number(row.minutes || 0);
    const nextPrice = Number(row.price || 0);
    const nextInputMode = String(row.pricing_mode || "time");
    if (row.commercial_category_id) setCommercialCategory(row.commercial_category_id);
    setExecution(nextExecution); setCost(nextCost); setMinutes(nextMinutes);
    setPrice(nextPrice); setInputMode(nextInputMode); setError("");
    if (onAdd && mode === "catalog") void addService(row, {
      execution: nextExecution, cost: nextCost, minutes: nextMinutes,
      price: nextPrice, inputMode: nextInputMode, commercialCategoryId: categoryId,
    });
  }
  function chooseBrand(row: Entity) {
    setBrand(row); setBrandQuery(String(row.name)); setBrandOptions([]); setBrandActiveIndex(-1);
    setAutoBrandPending(false); setModelSearch(""); setModels([]); setModelOffset(0); setMoreModels(false);
    setModelActiveIndex(-1); setBrandOpen(false); setModelOpen(true); setServiceOpen(false);
    setPorte(""); setCommercialCategory(""); onModelChange(""); setSearch(""); setSelected(null);
    setOffset(0); setError("");
    window.setTimeout(() => {
      modelInputRef.current?.focus();
      setModelOpen(true);
    }, 0);
  }
  function editBrand(value: string) {
    if (brandLocked) return;
    manualEditKey.current = vehicleIdentity; setLinkStatus("not_identified");
    setBrand(null); setBrandQuery(value); setBrandOffset(0); setBrandActiveIndex(-1); setAutoBrandPending(false);
    setBrandOpen(true); setModelOpen(false); setServiceOpen(false);
    setModelSearch(""); setModels([]); setModelOffset(0); setMoreModels(false); setModelActiveIndex(-1);
    setPorte(""); setCommercialCategory(""); onModelChange(""); setSearch(""); setOffset(0); setSelected(null); setError("");
  }
  function editModel(value: string) {
    manualEditKey.current = vehicleIdentity; setLinkStatus("needs_confirmation");
    setModelSearch(value); setModelOffset(0); setModelActiveIndex(-1);
    setBrandOpen(false); setModelOpen(true); setServiceOpen(false);
    setPorte(""); setCommercialCategory(""); onModelChange(""); setSearch(""); setOffset(0); setSelected(null); setError("");
  }
  function chooseModel(row: Entity) {
    setBrand({ id: row.brand_id, name: row.brand }); setBrandQuery(String(row.brand || ""));
    setBrandOptions([]); setModelSearch(String(row.name || "")); setModels([]);
    setBrandOpen(false); setModelOpen(false); setServiceOpen(false);
    setPorte(row.porte_id || ""); setCommercialCategory(row.commercial_category_id || ""); setLinkStatus("linked"); onModelChange(row.id);
    setSearch(""); setOffset(0); setSelected(null); setError("");
    if (!vehicleOnly) setServiceOpen(false);
  }
  function brandKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); openBrandDropdown(); setBrandActiveIndex((i) => nextCatalogOptionIndex(i, brandOptions.length, 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setBrandActiveIndex((i) => nextCatalogOptionIndex(i, brandOptions.length, -1)); }
    else if (event.key === "Enter" && brandOpen) { const exact = brandOptions.filter((x) => normalizeCatalogValue(String(x.name)) === normalizeCatalogValue(brandQuery)); const row = brandOptions[brandActiveIndex] || (exact.length === 1 ? exact[0] : null); if (row) { event.preventDefault(); chooseBrand(row); } }
    else if (event.key === "Escape") setBrandOpen(false);
  }
  function modelKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); openModelDropdown(); setModelActiveIndex((i) => nextCatalogOptionIndex(i, models.length, 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setModelActiveIndex((i) => nextCatalogOptionIndex(i, models.length, -1)); }
    else if (event.key === "Enter" && modelOpen) { const exact = models.filter((x) => normalizeCatalogValue(String(x.name)) === normalizeCatalogValue(modelSearch)); const row = models[modelActiveIndex] || (exact.length === 1 ? exact[0] : null); if (row) { event.preventDefault(); chooseModel(row); } }
    else if (event.key === "Escape") setModelOpen(false);
  }
  function serviceKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (mode === "manual" && !search.trim()) { if (event.key === "Enter") event.preventDefault(); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); openServiceDropdown(); setServiceActiveIndex((i) => nextCatalogOptionIndex(i, rows.length, 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setServiceActiveIndex((i) => nextCatalogOptionIndex(i, rows.length, -1)); }
    else if (event.key === "Enter" && serviceOpen) { event.preventDefault(); const exact = rows.filter((x) => normalizeCatalogValue(String(x.name)) === normalizeCatalogValue(search)); const row = rows[serviceActiveIndex] || (exact.length === 1 ? exact[0] : null); if (row && !adding && !loading) choose(row); }
    else if (event.key === "Escape") setServiceOpen(false);
  }
  const dropdownContent = openKind && info?.enabled && dropdownPosition && typeof document !== "undefined" ? createPortal(
    <div ref={dropdownRef} className="catalog-dropdown" style={{ position: "fixed", left: dropdownPosition.left, top: dropdownPosition.top, width: dropdownPosition.width, zIndex: 9999 }}>
      {openKind === "brand" && <div className="catalog-dropdown-list" style={{ maxHeight: dropdownPosition.maxHeight }}>
        <div id={dropdownId + "-brands"} role="listbox" aria-label="Marcas">
          {brandOptions.map((row, index) => <button id={dropdownId + "-brand-" + index} type="button" role="option" aria-selected={index === brandActiveIndex} className="catalog-dropdown-option" key={row.id} onClick={() => chooseBrand(row)}>
            <strong>{row.name}</strong><small>{Number(row.vehicle_count || 0).toLocaleString("pt-BR")} veículos</small>
          </button>)}
        </div>
        {!brandOptions.length && <p className="catalog-dropdown-empty">Nenhuma marca encontrada.</p>}
        {brandMore && <button type="button" className="catalog-dropdown-more" onClick={() => setBrandOffset((v) => v + 20)}>Mais marcas</button>}
      </div>}
      {openKind === "vehicle" && <div className="catalog-dropdown-list" aria-busy={modelsLoading} style={{ maxHeight: dropdownPosition.maxHeight }}>
        <div id={dropdownId + "-vehicles"} role="listbox" aria-label="Veículos do catálogo">
          {!modelsLoading && models.map((row, index) => <button id={dropdownId + "-vehicle-" + index} type="button" role="option" aria-selected={index === modelActiveIndex} className="catalog-dropdown-option" key={row.id} onClick={() => chooseModel(row)}>
            <strong>{row.name}</strong><small>{row.porte_name}</small>
          </button>)}
        </div>
        {modelsLoading && <p role="status" className="catalog-dropdown-empty">Buscando veículos…</p>}
        {!modelsLoading && !models.length && <p className="catalog-dropdown-empty">Nenhum veículo encontrado.</p>}
        {!modelsLoading && <button type="button" className="catalog-dropdown-more" disabled={!moreModels} onClick={() => setModelOffset((v) => v + 30)}>{moreModels ? "Mais veículos" : "Fim da lista"}</button>}
      </div>}
      {openKind === "service" && <div className="catalog-dropdown-list" aria-busy={loading} style={{ maxHeight: dropdownPosition.maxHeight }}>
        <div id={dropdownId + "-services"} role="listbox" aria-label="Serviços do veículo">
          {!loading && rows.map((row, index) => <button id={dropdownId + "-service-" + index} type="button" role="option" aria-selected={index === serviceActiveIndex} className="catalog-dropdown-option" key={row.service_id || row.id} onClick={() => choose(row)}>
            <strong>{row.name}</strong><small>{Number(row.minutes) > 0 ? formatCatalogMinutes(row.minutes) + " · " + (rate > 0 ? money(Math.round((Number(row.minutes) * rate) / 60)) : "Configure a tarifa do porte") : "Tempo técnico não cadastrado"}</small>
          </button>)}
        </div>
        {loading && <p role="status" className="catalog-dropdown-empty">Buscando serviços…</p>}
        {!loading && !rows.length && <p className="catalog-dropdown-empty">Nenhum serviço encontrado.</p>}
        {!loading && <div className="catalog-dropdown-pagination">
          <button type="button" disabled={!offset || loading} onClick={() => setOffset((v) => Math.max(0, v - 50))}>Anterior</button>
          <button type="button" disabled={!more || loading} onClick={() => setOffset((v) => v + 50)}>Mais serviços</button>
        </div>}
      </div>}
    </div>,
    document.body,
  ) : null;
  return (
    <>
      <section className="repair-picker" ref={pickerRef}>
      {!vehicleOnly && <div className="tabs">
        <button type="button" className={mode === "catalog" ? "active" : ""} disabled={!info?.enabled} onClick={() => { closeDropdowns(); setSelected(null); setMode("catalog"); setOffset(0); }}>Catálogo Técnico</button>
        <button type="button" className={mode === "manual" ? "active" : ""} onClick={() => { closeDropdowns(); setSelected(null); setMode("manual"); setOffset(0); }}>Serviços Próprios</button>
      </div>}
      {!vehicleOnly && !info?.enabled && info && <p role="status">{info.catalog_status === "active" ? "Não foi possível consultar o Catálogo Técnico agora." : catalogStatusMessage[info.catalog_status]} Seus serviços particulares continuam disponíveis.</p>}
      {vehicleOnly && !info && <p className="muted" role="status">Verificando acesso ao Catálogo Técnico…</p>}
      {vehicleOnly && info && !info.enabled && <p className="muted" role="status">{info.catalog_status === "active" ? "Catálogo Técnico indisponível no momento." : catalogStatusMessage[info.catalog_status]}</p>}
      {shouldShowVehicleCatalog(mode, vehicleOnly, !!info?.enabled) && <>
        <div className="catalog-selection-row">
          <Field label="Marca">
            <div className="catalog-combobox-control">
              <input ref={brandInputRef} role="combobox" aria-autocomplete="list" aria-expanded={brandOpen} aria-controls={dropdownId + "-brands"} aria-activedescendant={brandOpen && brandActiveIndex >= 0 ? dropdownId + "-brand-" + brandActiveIndex : undefined} autoComplete="off" value={brandQuery} disabled={!info?.enabled || brandLocked} onFocus={openBrandDropdown} onChange={(e) => editBrand(e.target.value)} onKeyDown={brandKeyDown} placeholder="Selecionar marca" />
              <button type="button" aria-label={brandOpen ? "Fechar marcas" : "Abrir marcas"} aria-haspopup="listbox" aria-expanded={brandOpen} disabled={!info?.enabled || brandLocked} onClick={toggleBrandDropdown}>▾</button>
            </div>
          </Field>
          <Field label="Veículo">
            <div className="catalog-combobox-control">
              <input ref={modelInputRef} role="combobox" aria-autocomplete="list" aria-expanded={modelOpen} aria-controls={dropdownId + "-vehicles"} aria-activedescendant={modelOpen && modelActiveIndex >= 0 ? dropdownId + "-vehicle-" + modelActiveIndex : undefined} autoComplete="off" value={modelSearch} disabled={!info?.enabled || !brand?.id} onFocus={openModelDropdown} onChange={(e) => editModel(e.target.value)} onKeyDown={modelKeyDown} placeholder="Selecionar veículo" />
              <button type="button" aria-label={modelOpen ? "Fechar veículos" : "Abrir veículos"} aria-haspopup="listbox" aria-expanded={modelOpen} disabled={!info?.enabled || !brand?.id} onClick={toggleModelDropdown}>▾</button>
            </div>
          </Field>
          {!vehicleOnly && <Field label="Serviço" full>
            <div className="catalog-combobox-control">
              <input ref={serviceInputRef} role="combobox" aria-autocomplete="list" aria-expanded={serviceOpen} aria-controls={dropdownId + "-services"} aria-activedescendant={serviceOpen && serviceActiveIndex >= 0 ? dropdownId + "-service-" + serviceActiveIndex : undefined} autoComplete="off" value={search} disabled={!modelId || (mode === "catalog" && linkStatus === "mismatch")} onFocus={() => { if (suppressServiceFocusOpen.current) { suppressServiceFocusOpen.current = false; return; } openServiceDropdown(); }} onClick={openServiceDropdown} onChange={(e) => { suppressServiceFocusOpen.current = false; setSearch(e.target.value); setOffset(0); setServiceActiveIndex(-1); setSelected(null); setServiceOpen(true); setBrandOpen(false); setModelOpen(false); }} onKeyDown={serviceKeyDown} placeholder="Digite uma palavra do serviço" />
              <button type="button" aria-label={serviceOpen ? "Fechar serviços" : "Abrir serviços"} aria-haspopup="listbox" aria-expanded={serviceOpen} disabled={!modelId || (mode === "catalog" && linkStatus === "mismatch")} onClick={toggleServiceDropdown}>▾</button>
            </div>
          </Field>}
        </div>
        {(vehicleOnly || linkStatus === "needs_confirmation" || linkStatus === "mismatch") && <p className="muted" role="status">{linkStatus === "linked" || linkStatus === "matched" ? "Vinculado ao Catálogo Técnico." : linkStatus === "needs_confirmation" ? "Aguardando confirmação: escolha a versão correta." : linkStatus === "mismatch" ? "O vínculo diverge dos dados atuais. Revise e confirme novamente o modelo antes de incluir serviços." : "Não identificado no Catálogo Técnico."}</p>}
        {brandLocked && <p className="muted catalog-lock-note">A marca está vinculada ao veículo. Para corrigi-la, atualize o cadastro do veículo.</p>}
        {vehicle && <p className="muted">{[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" · ")}</p>}
       </>}
      {shouldShowWorkshopServices(mode, vehicleOnly) && (
        <section className="os-private-services">
          <h3>Serviços da Oficina</h3>
          <div className="os-private-search-row">
            <Field label="Pesquisar serviços próprios">
              <input ref={serviceInputRef} role="combobox" aria-autocomplete="list" aria-expanded={serviceOpen && !!search.trim()} aria-controls={dropdownId + "-private-services"} aria-activedescendant={serviceOpen && serviceActiveIndex >= 0 ? dropdownId + "-private-service-" + serviceActiveIndex : undefined} autoComplete="off" value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); setSelected(null); setServiceActiveIndex(0); setServiceOpen(!!e.target.value.trim()); }} onKeyDown={serviceKeyDown} placeholder="Digite o nome ou código do serviço..." />
            </Field>
            <button type="button" className="button primary" disabled={adding || loading || !serviceOpen || !rows[serviceActiveIndex]} onClick={() => choose(rows[serviceActiveIndex])}><Plus size={16} /> Adicionar</button>
          </div>
          <button type="button" className="text-button os-private-quick-create" onClick={() => { closeDropdowns(); setEditing(null); }}>+ Cadastrar serviço sem sair</button>
          {serviceOpen && !!search.trim() && <div id={dropdownId + "-private-services"} className="os-private-suggestions" role="listbox" aria-label="Serviços próprios" aria-busy={loading}>
            {loading ? <p>Buscando serviços…</p> : rows.length ? rows.map((row, index) => <button id={dropdownId + "-private-service-" + index} type="button" role="option" aria-selected={index === serviceActiveIndex} className={index === serviceActiveIndex ? "active" : ""} key={row.id} onClick={() => choose(row)}><strong>{row.name}</strong><span>{money(Number(row.price || 0))}</span></button>) : <p>Nenhum serviço encontrado nesta busca.</p>}
          </div>}
        </section>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {selected && !onAdd && (
        <section className="repair-selection" aria-live="polite">
          <h4>{selected.name}</h4>
          <p>
            {execution === "outsourced"
              ? `Terceirizado · Custo: ${money(cost)} · Preço sugerido: ${money(Number(selected.price || price))}`
              : `Interno · ${minutes > 0 ? formatCatalogMinutes(minutes) : "Tempo não informado"} · ${money(rate > 0 && minutes > 0 ? Math.round((minutes * rate) / 60) : Number(selected.price || price))}`}
          </p>
        </section>
      )}
      {selected && onAdd && (
        <div className="repair-selection" aria-live="polite">
          <h4>{selected.name}</h4>
          {mode === "manual" ? (
            <>
              {selected.description ? <p>{selected.description}</p> : null}
              <Field label="Valor nesta OS/orçamento (R$)">
                <NumericInput type="number" min="0.01" step="0.01" value={price / 100} onChange={(e) => setPrice(Math.round(Number(e.target.value) * 100))} />
              </Field>
            </>
          ) : (
            <div className="form-grid">
              {execution === "outsourced" ? (
                <Field label="Custo do terceiro (R$)"><NumericInput type="number" min="0" step="0.01" value={cost / 100} onChange={(e) => setCost(Math.round(Number(e.target.value) * 100))} /></Field>
              ) : (
                (Number(selected.minutes) === 0 || rate <= 0) && <>
                  <Field label="Informar por"><select value={inputMode} onChange={(e) => setInputMode(e.target.value)}><option value="time">Tempo</option><option value="price">Preço</option></select></Field>
                  {inputMode === "time" ? <Field label="Tempo (minutos)"><NumericInput type="number" min="0" step="0.01" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></Field> : <Field label="Preço de venda (R$)"><NumericInput type="number" min="0" step="0.01" value={price / 100} onChange={(e) => setPrice(Math.round(Number(e.target.value) * 100))} /></Field>}
                </>
              )}
            </div>
          )}
          <button type="button" className="button primary" disabled={adding || loading || !readyToAdd} onClick={() => { void addService(selected!, { execution, cost, minutes, price, inputMode, commercialCategoryId: commercialCategory, porteId: porte }); }}>
            Adicionar serviço
          </button>
        </div>
      )}
      {!vehicleOnly && editing !== undefined && <WorkshopServiceManagerForm initial={editing || undefined} categories={quickCategories} onClose={() => setEditing(undefined)} onCategoryCreated={(category) => setQuickCategories((current) => [category, ...current])} onSaved={(service) => { setEditing(undefined); setRevision((v) => v + 1); setMode("manual"); void addService(service); }} />}

    </section>
      {dropdownContent}
    </>
  );
}

export function ServiceExecutionFields({
  item,
  onChange,
}: {
  item: Entity;
  onChange: (updates: Record<string, any>) => void;
}) {
  const detail = item.service_details || {};
  if (detail.service_type === "private") {
    return <small className="muted">Serviço próprio · O preço desta OS/orçamento pode ser alterado sem mudar o cadastro.</small>;
  }
  const execution = item.service_execution || detail.execution || "internal";
  const cost = Number(item.service_cost ?? item.cost ?? 0),
    markup = Number(detail.markup_bps ?? 3000),
    minutes = Number(item.service_minutes ?? detail.minutes ?? 0),
    rate = Number(detail.hourly_rate || 0);
  function update(mode: string, value: number) {
    onChange({
      service_execution: mode,
      service_cost: mode === "internal" ? 0 : value,
      cost: mode === "internal" ? 0 : value,
      price:
        mode === "outsourced"
          ? Math.round((value * (10000 + markup)) / 10000)
          : rate > 0 && minutes > 0
            ? Math.round((minutes * rate) / 60)
            : item.price,
    });
  }
  return (
    <>
      {execution === "outsourced" && (
        <Field label="Custo do terceiro (R$)">
          <NumericInput
            type="number"
            min="0"
            step="0.01"
            value={cost / 100}
            onChange={(e) =>
              update(execution, Math.round(Number(e.target.value) * 100))
            }
          />
        </Field>
      )}
      {execution === "internal" && !detail.minutes && (
        <Field label="Tempo nesta OS (minutos)">
          <NumericInput
            type="number"
            min="0"
            step="0.01"
            value={minutes}
            onChange={(e) =>
              onChange({
                service_minutes: Number(e.target.value),
                price:
                  rate > 0
                    ? Math.round((Number(e.target.value) * rate) / 60)
                    : item.price,
              })
            }
          />
        </Field>
      )}
      <small className="muted">
        {minutes} min · Hora utilizada: {money(rate)} · Ajustes de custo e preço
        valem somente para esta OS.
      </small>
    </>
  );
}
