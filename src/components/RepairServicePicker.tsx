import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { api, send } from "../lib/api";
import { money, type Entity } from "../lib/types";
import { Field, Modal, PageHeading } from "./ui";
import { NumericInput } from "./NumericInput";
import { shouldLoadRepairServiceSearch, shouldShowVehicleCatalog, shouldShowWorkshopServices } from "../../shared/repairCatalogVisibility";

type Info = { enabled: boolean; catalog_status:"active"|"not_contracted"|"expired"|"revoked"|"not_installed"; categories: Entity[]; service_markup_bps: number };
const catalogStatusMessage:Record<Exclude<Info["catalog_status"],"active">,string>={
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
function ServiceForm({
  info,
  initial,
  porteId,
  commercialCategoryId,
  onClose,
  onSaved,
}: {
  info: Info;
  initial?: Entity;
  porteId: string;
  commercialCategoryId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    execution: initial?.execution || "internal",
    commercial_category_id: initial?.commercial_category_id || commercialCategoryId || "",
    pricing_mode: initial?.pricing_mode || "time",
    minutes: Number(initial?.minutes || 0),
    price: Number(initial?.price || 0),
    cost: Number(initial?.cost || 0),
  });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const rate = Number(
    info.categories.find((p) => p.id === form.commercial_category_id)?.hourly_rate || 0,
  );
  const set = (key: string, value: any) =>
    setForm((f) => ({ ...f, [key]: value }));
  const calculatedPrice =
    form.execution === "outsourced"
      ? Math.round((form.cost * (10000 + info.service_markup_bps)) / 10000)
      : form.pricing_mode === "time"
        ? Math.round((form.minutes * rate) / 60)
        : form.price;
  const calculatedMinutes =
    form.pricing_mode === "price" && rate > 0
      ? Math.round(((form.price * 60) / rate) * 10000) / 10000
      : form.minutes;
  return (
    <Modal
      title={
        initial ? "Editar serviço da oficina" : "Cadastrar serviço da oficina"
      }
      description="O serviço pertence somente a esta oficina e usa o porte escolhido."
      onClose={onClose}
    >
      <div className="modal-body">
        <div className="form-grid">
          <Field label="Nome do serviço" full>
            <input
              value={form.name}
              maxLength={300}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field label="Execução">
            <select
              value={form.execution}
              onChange={(e) => set("execution", e.target.value)}
            >
              <option value="internal">Interno</option>
              <option value="outsourced">Terceirizado</option>
            </select>
          </Field>
          <Field label="Porte">
            <select
              value={form.commercial_category_id}
              onChange={(e) => set("commercial_category_id", e.target.value)}
            >
              <option value="">Selecione o porte</option>
              {info.categories.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          {form.execution === "internal" ? (
            <>
              <Field label="Informar por">
                <select
                  value={form.pricing_mode}
                  onChange={(e) => set("pricing_mode", e.target.value)}
                >
                  <option value="time">Tempo em minutos</option>
                  <option value="price">Preço de venda</option>
                </select>
              </Field>
              {form.pricing_mode === "time" ? (
                <Field label="Tempo (minutos)">
                  <NumericInput
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.minutes}
                    onChange={(e) => set("minutes", Number(e.target.value))}
                  />
                </Field>
              ) : (
                <Field label="Preço de venda (R$)">
                  <NumericInput
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price / 100}
                    onChange={(e) =>
                      set("price", Math.round(Number(e.target.value) * 100))
                    }
                  />
                </Field>
              )}
              <p className="field full">
                {rate > 0
                  ? `${calculatedMinutes.toLocaleString("pt-BR")} min · ${money(calculatedPrice)} · Hora: ${money(rate)}`
                  : "Configure o valor da hora deste porte antes de salvar."}
              </p>
            </>
          ) : (
            <>
              <Field label="Custo do terceiro (R$)">
                <NumericInput
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.cost / 100}
                  onChange={(e) =>
                    set("cost", Math.round(Number(e.target.value) * 100))
                  }
                />
              </Field>
              <p>
                Preço sugerido: {money(calculatedPrice)} · Acréscimo{" "}
                {info.service_markup_bps / 100}%
              </p>
            </>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          className="button primary"
        disabled={busy || !form.commercial_category_id || (form.execution === "internal" && rate <= 0)}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await send(
                initial
                  ? `/workshop-services/${initial.id}`
                  : "/workshop-services",
                form,
                initial ? "PUT" : "POST",
              );
              onSaved();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Salvar serviço
        </button>
      </div>
    </Modal>
  );
}
const normalizeCatalogValue = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
const formatCatalogMinutes = (value: unknown) => {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(total / 60), minutes = total % 60;
  return [hours ? hours + "h" : "", minutes || !hours ? minutes + " min" : ""].filter(Boolean).join(" ");
};

export function RepairServicePicker({ vehicle, modelId, onModelChange, onAdd, brandLocked = false, vehicleOnly = false }: {
  vehicle?: Record<string, any>;
  modelId: string;
  onModelChange: (id: string) => void;
  onAdd?: (item: Entity) => void;
  brandLocked?: boolean;
  vehicleOnly?: boolean;
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
    [brandMore, setBrandMore] = useState(false), [brandOpen, setBrandOpen] = useState(!!vehicle?.brand && !modelId && !brandLocked), [modelOpen, setModelOpen] = useState(false),
    [brandActiveIndex, setBrandActiveIndex] = useState(-1), [modelActiveIndex, setModelActiveIndex] = useState(-1),
    [serviceOpen, setServiceOpen] = useState(false), [serviceActiveIndex, setServiceActiveIndex] = useState(-1),
    [modelsLoading, setModelsLoading] = useState(false), [autoBrandPending, setAutoBrandPending] = useState(!!vehicle?.brand && !modelId);
  const [porte, setPorte] = useState(String(vehicle?.service_porte_id || "")),
    [commercialCategory, setCommercialCategory] = useState(String(vehicle?.service_commercial_category_id || "")),
    [search, setSearch] = useState(""), [offset, setOffset] = useState(0), [rows, setRows] = useState<Entity[]>([]),
    [more, setMore] = useState(false), [loading, setLoading] = useState(false), [revision, setRevision] = useState(0);
  const pickerRef = useRef<HTMLElement | null>(null), dropdownRef = useRef<HTMLDivElement | null>(null);
  const brandInputRef = useRef<HTMLInputElement | null>(null), modelInputRef = useRef<HTMLInputElement | null>(null), serviceInputRef = useRef<HTMLInputElement | null>(null);
  const dropdownId = useId().replace(/:/g, "");
  const [dropdownPosition, setDropdownPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const openKind = brandOpen ? "brand" : modelOpen ? "vehicle" : serviceOpen ? "service" : null;
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
      const rect = anchor.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12;
      const maxHeight = Math.max(120, Math.min(320, below >= 180 ? below : Math.max(above, 120)));
      const top = below >= 180 ? rect.bottom + 4 : Math.max(8, rect.top - maxHeight - 4);
      const width = Math.min(rect.width, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setDropdownPosition({ left, top, width, maxHeight });
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
    let active = true;
    api<Info>(vehicleOnly ? "/repair-services/access" : "/repair-services/config").then((v) => { if (active) { setInfo(v); setMode(v.enabled ? "catalog" : "manual"); } }).catch((e) => active && setError(e.message));
    return () => { active = false; };
  }, [vehicleOnly]);
  useEffect(() => {
    let active = true;
    const key = vehicleIdentity;
    if (!vehicle || modelId || !info?.enabled || !key.replace(/\|/g, "")) { if (!info?.enabled) setLinkStatus("unavailable"); return () => { active = false; }; }
    if (manualEditKey.current === key || autoMatchTried.current === key) return () => { active = false; };
    autoMatchTried.current = key;
    send("/repair-services/identify-model", { vehicle }, "POST").then((result: any) => {
      if (!active) return;
      setLinkStatus(result.status || "not_identified");
      if (result.status === "matched" && result.model) {
        const row = result.model as Entity;
        setBrand({ id: row.brand_id, name: row.brand }); setBrandQuery(String(row.brand || ""));
        setModelSearch(String(row.name || "")); setBrandOpen(false); setModelOpen(false);
        onModelChange(String(row.id));
      } else if (result.status === "needs_confirmation" && result.candidates?.length) {
        const first = result.candidates[0] as Entity;
        setBrand({ id: first.brand_id, name: first.brand }); setBrandQuery(String(first.brand || ""));
        setModelSearch(String(vehicle.fipe_model || vehicle.model || "")); setModelOpen(true);
      }
    }).catch((e: any) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [vehicleIdentity, modelId, info?.enabled, onModelChange]);
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
    }).catch((e) => {
      if (!active) return;
      const message = String(e?.message || e);
      if (message.includes("Modelo não encontrado no catálogo")) {
        setBrand(null); setBrandQuery(String(vehicle?.brand || ""));
        setModelSearch(String(vehicle?.model || vehicle?.fipe_model || "")); setAutoBrandPending(!!vehicle?.brand);
        setBrandOpen(!!vehicle?.brand); setModelOpen(!!(vehicle?.model || vehicle?.fipe_code));
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
        if (!active) return; setBrandOptions(v.items); setBrandMore(v.has_more); setBrandActiveIndex(-1);
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
        if (!active) return; setModels(v.items); setMoreModels(v.has_more); setModelActiveIndex(-1);
      }).catch((e) => active && setError(e.message)).finally(() => active && setModelsLoading(false));
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [info?.enabled, mode, brand?.id, modelOpen, modelSearch, vehicle?.fipe_code, vehicle?.model, vehicle?.fipe_model, vehicle?.year, modelOffset]);
  useEffect(() => {
    let active = true; setRows([]); setMore(false); setLoading(false);
    if (!shouldLoadRepairServiceSearch(mode, vehicleOnly, modelId, serviceOpen) || (mode === "catalog" && linkStatus === "mismatch")) return () => { active = false; };
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: search, offset: String(offset) });
      if (commercialCategory) params.set("category_id", commercialCategory);
      api(mode === "catalog" ? `/repair-services/models/${modelId}/services?${params}` : `/workshop-services?${params}`)
        .then((v) => { if (active) { setRows(v.items); setMore(v.has_more); } })
        .catch((e) => active && setError(e.message)).finally(() => active && setLoading(false));
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [mode, modelId, commercialCategory, search, offset, revision, serviceOpen, vehicleOnly, linkStatus]);
  const rate = Number(info?.categories.find((p) => p.id === commercialCategory)?.hourly_rate || 0);
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
    if (!modelId || (mode === "catalog" && linkStatus === "mismatch")) return;
    setBrandOpen(false); setModelOpen(false); setServiceOpen(true);
  }
  function toggleBrandDropdown() { if (brandOpen) setBrandOpen(false); else openBrandDropdown(); }
  function toggleModelDropdown() { if (modelOpen) setModelOpen(false); else openModelDropdown(); }
  function toggleServiceDropdown() { if (serviceOpen) setServiceOpen(false); else openServiceDropdown(); }
  function choose(row: Entity) {
    if (mode === "catalog" && linkStatus === "mismatch") return;
    setSelected(row);
    if (mode === "catalog") { setSearch(String(row.name || "")); closeDropdowns(); }
    if (row.commercial_category_id) setCommercialCategory(row.commercial_category_id);
    setExecution(row.execution || "internal"); setCost(Number(row.cost || 0)); setMinutes(Number(row.minutes || 0));
    setPrice(Number(row.price || 0)); setInputMode("time"); setError("");
    // Keep the selected service visible; refocusing this input would fire onFocus and reopen the list.
  }
  function chooseBrand(row: Entity) {
    setBrand(row); setBrandQuery(String(row.name)); setBrandOptions([]); setBrandActiveIndex(-1);
    setAutoBrandPending(false); setModelSearch(""); setModels([]); setModelOffset(0); setMoreModels(false);
    setModelActiveIndex(-1); setBrandOpen(false); setModelOpen(true); setServiceOpen(false);
    setPorte(""); setCommercialCategory(""); onModelChange(""); setSearch(""); setSelected(null);
    setOffset(0); setError(""); modelInputRef.current?.focus();
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
    window.setTimeout(() => serviceInputRef.current?.focus(), 0);
  }
  function brandKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); openBrandDropdown(); setBrandActiveIndex((i) => Math.min(i < 0 ? 0 : i + 1, Math.max(brandOptions.length - 1, 0))); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setBrandActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (event.key === "Enter" && brandOpen) { const exact = brandOptions.filter((x) => normalizeCatalogValue(String(x.name)) === normalizeCatalogValue(brandQuery)); const row = brandOptions[brandActiveIndex] || (exact.length === 1 ? exact[0] : null); if (row) { event.preventDefault(); chooseBrand(row); } }
    else if (event.key === "Escape") setBrandOpen(false);
  }
  function modelKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); openModelDropdown(); setModelActiveIndex((i) => Math.min(i < 0 ? 0 : i + 1, Math.max(models.length - 1, 0))); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setModelActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (event.key === "Enter" && modelOpen) { const exact = models.filter((x) => normalizeCatalogValue(String(x.name)) === normalizeCatalogValue(modelSearch)); const row = models[modelActiveIndex] || (exact.length === 1 ? exact[0] : null); if (row) { event.preventDefault(); chooseModel(row); } }
    else if (event.key === "Escape") setModelOpen(false);
  }
  function serviceKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); openServiceDropdown(); setServiceActiveIndex((i) => Math.min(i < 0 ? 0 : i + 1, Math.max(rows.length - 1, 0))); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setServiceActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (event.key === "Enter" && serviceOpen) { const exact = rows.filter((x) => normalizeCatalogValue(String(x.name)) === normalizeCatalogValue(search)); const row = rows[serviceActiveIndex] || (exact.length === 1 ? exact[0] : null); if (row) { event.preventDefault(); choose(row); } }
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
        <button type="button" className={mode === "catalog" ? "active" : ""} disabled={!info?.enabled} onClick={() => { closeDropdowns(); setSelected(null); setMode("catalog"); setOffset(0); }}>Catálogo de tempos</button>
        <button type="button" className={mode === "manual" ? "active" : ""} onClick={() => { closeDropdowns(); setSelected(null); setMode("manual"); setOffset(0); }}>Serviços da oficina</button>
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
              <input ref={serviceInputRef} role="combobox" aria-autocomplete="list" aria-expanded={serviceOpen} aria-controls={dropdownId + "-services"} aria-activedescendant={serviceOpen && serviceActiveIndex >= 0 ? dropdownId + "-service-" + serviceActiveIndex : undefined} autoComplete="off" value={search} disabled={!modelId || (mode === "catalog" && linkStatus === "mismatch")} onFocus={openServiceDropdown} onChange={(e) => { setSearch(e.target.value); setOffset(0); setSelected(null); setServiceOpen(true); setBrandOpen(false); setModelOpen(false); }} onKeyDown={serviceKeyDown} placeholder="Digite uma palavra do serviço" />
              <button type="button" aria-label={serviceOpen ? "Fechar serviços" : "Abrir serviços"} aria-haspopup="listbox" aria-expanded={serviceOpen} disabled={!modelId || (mode === "catalog" && linkStatus === "mismatch")} onClick={toggleServiceDropdown}>▾</button>
            </div>
          </Field>}
        </div>
        {(vehicleOnly || linkStatus === "needs_confirmation" || linkStatus === "mismatch") && <p className="muted" role="status">{linkStatus === "linked" || linkStatus === "matched" ? "Vinculado ao Catálogo Técnico." : linkStatus === "needs_confirmation" ? "Aguardando confirmação: escolha a versão correta." : linkStatus === "mismatch" ? "O vínculo diverge dos dados atuais. Revise e confirme novamente o modelo antes de incluir serviços." : "Não identificado no Catálogo Técnico."}</p>}
        {brandLocked && <p className="muted catalog-lock-note">A marca está vinculada ao veículo. Para corrigi-la, atualize o cadastro do veículo.</p>}
        {vehicle && <p className="muted">{[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" · ")}</p>}
       </>}
      {shouldShowWorkshopServices(mode, vehicleOnly) && (
        <>
          <Field label="Porte do serviço">
            <select
              value={commercialCategory}
              onChange={(e) => {
                setCommercialCategory(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">Selecione o porte</option>
              {info?.categories.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            className="button"
            disabled={!info}
            onClick={() => setEditing(null)}
          >
            Cadastrar serviço da oficina
          </button>
        </>
      )}
      {shouldShowWorkshopServices(mode, vehicleOnly) && <Field label="Buscar serviço">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          placeholder="Nome do serviço"
        />
      </Field>}
      {!vehicleOnly && <p className="muted">
        {commercialCategory ? `Hora do porte: ${money(rate)}. ` : ""}
        {commercialCategory && rate <= 0 ? "Tarifa não configurada. " : ""}
        <Link to="/configuracoes?aba=servicos">Configurar valores da hora</Link>
      </p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {shouldShowWorkshopServices(mode, vehicleOnly) && <div className="repair-results" aria-busy={loading}>
        {loading ? (
          <p>Buscando serviços…</p>
        ) : (
          rows.map((row) => (
            <div className="repair-result" key={row.service_id || row.id}>
              <button
                type="button"
                className="button"
                onClick={() => choose(row)}
              >
                <strong>{row.name}</strong>
                <small>
                  {`${row.execution === "outsourced" ? "Terceirizado" : "Interno"} · ${row.porte_name || "Todos os portes"}`}
                </small>
              </button>
              {shouldShowWorkshopServices(mode, vehicleOnly) && (
                <div className="capture-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setEditing(row)}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={async () => {
                      try {
                        await send(
                          `/workshop-services/${row.id}`,
                          {},
                          "DELETE",
                        );
                        setRevision((v) => v + 1);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Remover
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>}
      {shouldShowWorkshopServices(mode, vehicleOnly) && <>
        {!loading && !rows.length && <p>Nenhum serviço encontrado nesta busca.</p>}
        <div className="capture-actions">
          <button type="button" className="button" disabled={!offset || loading} onClick={() => setOffset((v) => Math.max(0, v - 50))}>Anterior</button>
          <button type="button" className="button" disabled={!more || loading} onClick={() => setOffset((v) => v + 50)}>Próximos serviços</button>
        </div>
      </>}
      {selected && onAdd && (
        <div className="repair-selection">
          <h4>{selected.name}</h4>
          <div className="form-grid">
            {execution === "outsourced" ? (
              <Field label="Custo do terceiro (R$)">
                <NumericInput
                  type="number"
                  min="0"
                  step="0.01"
                  value={cost / 100}
                  onChange={(e) =>
                    setCost(Math.round(Number(e.target.value) * 100))
                  }
                />
              </Field>
            ) : (
              Number(selected.minutes) === 0 && (
                <>
                  <Field label="Informar por">
                    <select
                      value={inputMode}
                      onChange={(e) => setInputMode(e.target.value)}
                    >
                      <option value="time">Tempo</option>
                      <option value="price">Preço</option>
                    </select>
                  </Field>
                  {inputMode === "time" ? (
                    <Field label="Tempo (minutos)">
                      <NumericInput
                        type="number"
                        min="0"
                        step="0.01"
                        value={minutes}
                        onChange={(e) => setMinutes(Number(e.target.value))}
                      />
                    </Field>
                  ) : (
                    <Field label="Preço de venda (R$)">
                      <NumericInput
                        type="number"
                        min="0"
                        step="0.01"
                        value={price / 100}
                        onChange={(e) =>
                          setPrice(Math.round(Number(e.target.value) * 100))
                        }
                      />
                    </Field>
                  )}
                </>
              )
            )}
          </div>
          <button
            type="button"
            className="button primary"
            disabled={adding || loading || !commercialCategory || (execution === "internal" && rate <= 0)}
            onClick={async () => {
              setAdding(true);
              setError("");
              try {
                const selection = {
                  ...(mode === "catalog"
                    ? {
                        repair_service_id: selected.service_id,
                        repair_model_id: modelId,
                      }
                    : { workshop_service_id: selected.id }),
                  ...(porte ? { porte_id: porte } : {}),
                  ...(commercialCategory ? { commercial_category_id: commercialCategory } : {}),
                  service_execution: execution,
                  service_cost: cost,
                  ...(minutes > 0 ? { service_minutes: minutes } : {}),
                  ...(inputMode === "price" ? { manual_price: price } : {}),
                };
                const preview = await send(
                  "/repair-services/preview",
                  selection,
                );
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
                if (mode === "catalog") { setSearch(""); setOffset(0); setServiceOpen(true); setBrandOpen(false); setModelOpen(false); serviceInputRef.current?.focus(); }
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setAdding(false);
              }
            }}
          >
            Adicionar serviço
          </button>
        </div>
      )}
      {!vehicleOnly && editing !== undefined && info && (
        <ServiceForm
          info={info}
          initial={editing || undefined}
          porteId={porte}
          commercialCategoryId={commercialCategory}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            setRevision((v) => v + 1);
          }}
        />
      )}
    </section>
      {dropdownContent}
    </>
  );
}
export function WorkshopServices() {
  const [model, setModel] = useState("");
  return (
    <>
      <PageHeading
        title="Serviços"
        eyebrow="CADASTROS"
        description="Catálogo de tempos e serviços particulares da oficina."
      />
      <div className="panel work-order-section">
        <RepairServicePicker modelId={model} onModelChange={setModel} />
      </div>
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
