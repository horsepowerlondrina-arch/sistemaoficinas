import { useEffect, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { api, send } from "../lib/api";
import { money, type Entity } from "../lib/types";
import { Field, Modal, PageHeading } from "./ui";
import { NumericInput } from "./NumericInput";

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

export function RepairServicePicker({ vehicle, modelId, onModelChange, onAdd }: {
  vehicle?: Record<string, any>;
  modelId: string;
  onModelChange: (id: string) => void;
  onAdd?: (item: Entity) => void;
}) {
  const [info, setInfo] = useState<Info | null>(null), [error, setError] = useState("");
  const [mode, setMode] = useState("manual"), [model, setModel] = useState<Entity | null>(null),
    [models, setModels] = useState<Entity[]>([]), [modelSearch, setModelSearch] = useState(String(vehicle?.model || vehicle?.fipe_model || "")),
    [modelOffset, setModelOffset] = useState(0), [moreModels, setMoreModels] = useState(false),
    [matchingFipe, setMatchingFipe] = useState(!!vehicle?.fipe_code), [choosing, setChoosing] = useState(!modelId);
  const [brand, setBrand] = useState<Entity | null>(null), [brandQuery, setBrandQuery] = useState(String(vehicle?.brand || "")),
    [brandOptions, setBrandOptions] = useState<Entity[]>([]), [brandOffset, setBrandOffset] = useState(0),
    [brandMore, setBrandMore] = useState(false), [brandOpen, setBrandOpen] = useState(false), [modelOpen, setModelOpen] = useState(!modelId),
    [brandActiveIndex, setBrandActiveIndex] = useState(-1), [modelActiveIndex, setModelActiveIndex] = useState(-1),
    [modelsLoading, setModelsLoading] = useState(false), [autoBrandPending, setAutoBrandPending] = useState(!!vehicle?.brand && !modelId);
  const [porte, setPorte] = useState(String(vehicle?.service_porte_id || "")),
    [commercialCategory, setCommercialCategory] = useState(String(vehicle?.service_commercial_category_id || "")),
    [search, setSearch] = useState(""), [offset, setOffset] = useState(0), [rows, setRows] = useState<Entity[]>([]),
    [more, setMore] = useState(false), [loading, setLoading] = useState(false), [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<Entity | null | undefined>(), [selected, setSelected] = useState<Entity | null>(null),
    [execution, setExecution] = useState("internal"), [cost, setCost] = useState(0), [minutes, setMinutes] = useState(0),
    [price, setPrice] = useState(0), [inputMode, setInputMode] = useState("time"), [adding, setAdding] = useState(false);
  useEffect(() => {
    let active = true;
    api<Info>("/repair-services/config").then((v) => { if (active) { setInfo(v); setMode(v.enabled ? "catalog" : "manual"); } }).catch((e) => active && setError(e.message));
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    if (!modelId) { setModel(null); setPorte(""); setCommercialCategory(""); return () => { active = false; }; }
    if (!info?.enabled) return () => { active = false; };
    api<Entity>(`/repair-services/models/${modelId}`).then((v) => {
      if (!active) return;
      setModel(v); setBrand({ id: v.brand_id, name: v.brand }); setBrandQuery(String(v.brand || ""));
      setModelSearch(String(v.name || "")); setBrandOpen(false); setModelOpen(false); setAutoBrandPending(false);
      setPorte(v.porte_id || ""); setCommercialCategory(v.commercial_category_id || ""); setChoosing(false); setError("");
    }).catch((e) => {
      if (!active) return;
      const message = String(e?.message || e);
      if (message.includes("Modelo não encontrado no catálogo")) {
        setModel(null); setBrand(null); setBrandQuery(String(vehicle?.brand || ""));
        setModelSearch(String(vehicle?.model || vehicle?.fipe_model || "")); setAutoBrandPending(!!vehicle?.brand);
        setBrandOpen(!!vehicle?.brand); setModelOpen(!!(vehicle?.model || vehicle?.fipe_code));
        setPorte(""); setCommercialCategory(""); onModelChange(""); setError("");
      } else setError(message);
    });
    return () => { active = false; };
  }, [modelId, info?.enabled, vehicle?.brand, vehicle?.model, vehicle?.fipe_model, vehicle?.fipe_code, onModelChange]);
  useEffect(() => {
    let active = true; setBrandOptions([]); setBrandMore(false);
    if (!info?.enabled || mode !== "catalog" || !brandQuery.trim()) return () => { active = false; };
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
  }, [info?.enabled, mode, brandQuery, brandOffset, autoBrandPending, vehicle?.brand, vehicle?.model, vehicle?.fipe_model, vehicle?.fipe_code]);
  useEffect(() => {
    let active = true; setModels([]); setMoreModels(false);
    if (!info?.enabled || mode !== "catalog" || !brand?.id || !modelOpen) { setModelsLoading(false); return () => { active = false; }; }
    setModelsLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ brand_id: String(brand.id), q: modelSearch, fipe: matchingFipe ? String(vehicle?.fipe_code || "") : "", offset: String(modelOffset) });
      api<{ items: Entity[]; has_more: boolean }>("/repair-services/models?" + params).then((v) => {
        if (!active) return; setModels(v.items); setMoreModels(v.has_more); setModelActiveIndex(-1);
      }).catch((e) => active && setError(e.message)).finally(() => active && setModelsLoading(false));
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [info?.enabled, mode, brand?.id, modelOpen, modelSearch, matchingFipe, vehicle?.fipe_code, modelOffset]);
  useEffect(() => {
    let active = true; setRows([]); setMore(false); setSelected(null); setLoading(false);
    if (mode === "catalog" && !modelId) return () => { active = false; };
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: search, offset: String(offset), category_id: commercialCategory });
      api(mode === "catalog" ? `/repair-services/models/${modelId}/services?${params}` : `/workshop-services?${params}`)
        .then((v) => { if (active) { setRows(v.items); setMore(v.has_more); } })
        .catch((e) => active && setError(e.message)).finally(() => active && setLoading(false));
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [mode, modelId, commercialCategory, search, offset, revision]);
  const rate = Number(info?.categories.find((p) => p.id === commercialCategory)?.hourly_rate || 0);
  function choose(row: Entity) {
    setSelected(row); if (row.commercial_category_id) setCommercialCategory(row.commercial_category_id);
    setExecution(row.execution || "internal"); setCost(Number(row.cost || 0)); setMinutes(Number(row.minutes || 0));
    setPrice(Number(row.price || 0)); setInputMode("time"); setError("");
  }
  function chooseBrand(row: Entity) {
    setBrand(row); setBrandQuery(String(row.name)); setBrandOptions([]); setBrandOpen(false); setBrandActiveIndex(-1);
    setAutoBrandPending(false); setModel(null); setModelSearch(""); setModels([]); setModelOffset(0); setMoreModels(false);
    setModelActiveIndex(-1); setModelOpen(true); setPorte(""); setCommercialCategory(""); onModelChange("");
    setOffset(0); setSelected(null); setError("");
  }
  function editBrand(value: string) {
    setBrand(null); setBrandQuery(value); setBrandOffset(0); setBrandOpen(true); setBrandActiveIndex(-1); setAutoBrandPending(false);
    setModel(null); setModelSearch(""); setModels([]); setModelOffset(0); setMoreModels(false); setModelOpen(false);
    setPorte(""); setCommercialCategory(""); onModelChange(""); setOffset(0); setSelected(null); setError("");
  }
  function editModel(value: string) {
    setModel(null); setModelSearch(value); setModelOffset(0); setModelActiveIndex(-1); setModelOpen(true);
    setPorte(""); setCommercialCategory(""); onModelChange(""); setOffset(0); setSelected(null); setError("");
  }
  function chooseModel(row: Entity) {
    setModel(row); setBrand({ id: row.brand_id, name: row.brand }); setBrandQuery(String(row.brand || ""));
    setBrandOptions([]); setBrandOpen(false); setModelSearch(String(row.name || "")); setModels([]); setModelOpen(false);
    setPorte(row.porte_id || ""); setCommercialCategory(row.commercial_category_id || ""); onModelChange(row.id);
    setChoosing(false); setOffset(0); setSelected(null); setError("");
  }
  function brandKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setBrandOpen(true); setBrandActiveIndex((i) => Math.min(i + 1, brandOptions.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setBrandActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (event.key === "Enter" && brandOpen) { const exact = brandOptions.filter((x) => normalizeCatalogValue(String(x.name)) === normalizeCatalogValue(brandQuery)); const row = brandOptions[brandActiveIndex] || (exact.length === 1 ? exact[0] : null); if (row) { event.preventDefault(); chooseBrand(row); } }
    else if (event.key === "Escape") setBrandOpen(false);
  }
  function modelKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setModelOpen(true); setModelActiveIndex((i) => Math.min(i + 1, models.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setModelActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (event.key === "Enter" && modelOpen) { const exact = models.filter((x) => normalizeCatalogValue(String(x.name)) === normalizeCatalogValue(modelSearch)); const row = models[modelActiveIndex] || (exact.length === 1 ? exact[0] : null); if (row) { event.preventDefault(); chooseModel(row); } }
    else if (event.key === "Escape") setModelOpen(false);
  }
  return (
    <section className="repair-picker">
      <div className="tabs">
        <button type="button" className={mode === "catalog" ? "active" : ""} disabled={!info?.enabled} onClick={() => { setMode("catalog"); setOffset(0); }}>Catálogo de tempos</button>
        <button type="button" className={mode === "manual" ? "active" : ""} onClick={() => { setMode("manual"); setOffset(0); }}>Serviços da oficina</button>
      </div>
      {!info?.enabled && info && <p role="status">{info.catalog_status === "active" ? "Não foi possível consultar o Catálogo Técnico agora." : catalogStatusMessage[info.catalog_status]} Seus serviços particulares continuam disponíveis.</p>}
      {mode === "catalog" && (
        <>
          <div className="repair-model">
            <strong>{model ? `${model.brand} · ${model.name}` : "Confirme o modelo do veículo"}</strong>
            {model && <p>Porte: {model.porte_name} · FIPE: {model.fipe_code || "não informado"}</p>}
            <button type="button" className="button" onClick={() => { setChoosing(true); if (brand?.id) setModelOpen(true); }}>{model ? "Alterar marca ou modelo" : "Escolher marca e modelo"}</button>
            <p className="muted">{vehicle ? [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" · ") : "Escolha o veículo para consultar seus serviços."} Confira versão, motor e câmbio. Versões ambíguas precisam de confirmação.</p>
          </div>
          {choosing && (
            <div className="repair-model-search">
              <Field label="Marca"><input role="combobox" aria-autocomplete="list" aria-expanded={brandOpen && brandOptions.length > 0} aria-controls="repair-brand-options" autoComplete="off" value={brandQuery} onFocus={() => { if (brandQuery.trim()) setBrandOpen(true); }} onChange={(e) => editBrand(e.target.value)} onKeyDown={brandKeyDown} placeholder="Digite a marca" /></Field>
              {brandOpen && brandOptions.length > 0 && <div id="repair-brand-options" className="repair-results" role="listbox" aria-label="Sugestões de marca">
                {brandOptions.map((row, index) => <button type="button" role="option" aria-selected={index === brandActiveIndex} className="button repair-result" key={row.id} onClick={() => chooseBrand(row)}><strong>{row.name}</strong></button>)}
                {brandMore && <button type="button" className="button" onClick={() => setBrandOffset((v) => v + 20)}>Mais marcas</button>}
              </div>}
              <Field label="Modelo"><input role="combobox" aria-autocomplete="list" aria-expanded={modelOpen && models.length > 0} aria-controls="repair-model-options" autoComplete="off" disabled={!brand?.id} value={modelSearch} onFocus={() => { if (brand?.id) setModelOpen(true); }} onChange={(e) => editModel(e.target.value)} onKeyDown={modelKeyDown} placeholder={brand?.id ? "Digite modelo, versão ou motor" : "Selecione uma marca primeiro"} /></Field>
              {!brand?.id && <p className="muted">Escolha uma marca para pesquisar somente os modelos correspondentes.</p>}
              {vehicle?.fipe_code && brand?.id && <label><input type="checkbox" checked={matchingFipe} onChange={(e) => { setMatchingFipe(e.target.checked); setModelOffset(0); }} /> Incluir candidatos do código FIPE {vehicle.fipe_code}</label>}
              {modelOpen && brand?.id && <div id="repair-model-options" className="repair-results" role="listbox" aria-label="Sugestões de modelo" aria-busy={modelsLoading}>
                {modelsLoading ? <p role="status">Buscando modelos desta marca…</p> : models.map((row, index) => <button type="button" role="option" aria-selected={index === modelActiveIndex} className="button repair-result" key={row.id} onClick={() => chooseModel(row)}><strong>{row.name}</strong><small>{row.porte_name} · FIPE {row.fipe_code || "não informado"} · {row.service_count} serviços</small></button>)}
                {!modelsLoading && !models.length && <p>Nenhuma opção encontrada. Ajuste a busca ou o código FIPE.</p>}
                {!modelsLoading && <div className="capture-actions"><button type="button" className="button" disabled={!modelOffset || modelsLoading} onClick={() => setModelOffset((v) => Math.max(0, v - 30))}>Anterior</button><button type="button" className="button" disabled={!moreModels || modelsLoading} onClick={() => setModelOffset((v) => v + 30)}>Mais modelos</button></div>}
              </div>}
            </div>
          )}
        </>
      )}
      {mode === "manual" && (
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
      <Field label="Buscar serviço">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          placeholder="Nome do serviço"
        />
      </Field>
      <p className="muted">
        {commercialCategory ? `Hora do porte: ${money(rate)}. ` : ""}
        {commercialCategory && rate <= 0 ? "Tarifa não configurada. " : ""}
        <Link to="/configuracoes?aba=servicos">Configurar valores da hora</Link>
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="repair-results" aria-busy={loading}>
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
                  {mode === "catalog"
                    ? `${row.minutes} min · ${row.minutes > 0 && rate > 0 ? money(Math.round((row.minutes * rate) / 60)) : "Informe tempo/preço ou configure a hora"}`
                    : `${row.execution === "outsourced" ? "Terceirizado" : "Interno"} · ${row.porte_name || "Todos os portes"}`}
                </small>
              </button>
              {mode === "manual" && (
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
      </div>
      {!loading && !rows.length && (
        <p>
          {mode === "catalog" && !modelId
            ? "Escolha o modelo acima."
            : "Nenhum serviço encontrado nesta busca."}
        </p>
      )}
      <div className="capture-actions">
        <button
          type="button"
          className="button"
          disabled={!offset || loading}
          onClick={() => setOffset((v) => Math.max(0, v - 50))}
        >
          Anterior
        </button>
        <button
          type="button"
          className="button"
          disabled={!more || loading}
          onClick={() => setOffset((v) => v + 50)}
        >
          Próximos serviços
        </button>
      </div>
      {selected && onAdd && (
        <div className="repair-selection">
          <h4>{selected.name}</h4>
          <div className="form-grid">
            <Field label="Execução nesta OS">
              <select
                value={execution}
                onChange={(e) => setExecution(e.target.value)}
              >
                <option value="internal">Interno</option>
                <option value="outsourced">Terceirizado</option>
              </select>
            </Field>
            <Field label="Porte de cobrança nesta OS">
              <select
                value={commercialCategory}
                onChange={(e) => setCommercialCategory(e.target.value)}
              >
                <option value="">Selecione o porte</option>
                {info?.categories.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
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
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setAdding(false);
              }
            }}
          >
            Adicionar à OS
          </button>
        </div>
      )}
      {editing !== undefined && info && (
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
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryError, setCategoryError] = useState("");
  const execution = item.service_execution || detail.execution || "internal";
  const cost = Number(item.service_cost ?? item.cost ?? 0),
    markup = Number(detail.markup_bps ?? 3000),
    minutes = Number(item.service_minutes ?? detail.minutes ?? 0),
    rate = Number(detail.hourly_rate || 0);
  const categoryId = String(item.commercial_category_id || detail.commercial_category_id || "");
  async function updateCategory(value: string) {
    setCategoryBusy(true);
    setCategoryError("");
    try {
      const selection = {
        repair_service_id: item.repair_service_id,
        repair_model_id: item.repair_model_id,
        workshop_service_id: item.workshop_service_id,
        commercial_category_id: value,
        service_execution: execution,
        service_cost: cost,
        ...(minutes > 0 ? { service_minutes: minutes } : {}),
      };
      const result = item.order_id
        ? await send("/repair-services/reprice", {
            order_id: item.order_id,
            item_id: item.id,
            execution,
            cost,
            commercial_category_id: value,
          })
        : await send("/repair-services/preview", selection);
      onChange({
        commercial_category_id: value,
        price: result.price,
        service_details: result,
        service_minutes: result.minutes,
        duration_seconds: Number(result.minutes || 0) * 60,
      });
    } catch (e) {
      setCategoryError((e as Error).message);
    } finally {
      setCategoryBusy(false);
    }
  }
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
      <Field label="Porte de cobrança nesta OS">
        <select
          value={categoryId}
          disabled={categoryBusy}
          onChange={(e) => void updateCategory(e.target.value)}
        >
          <option value="">Selecione o porte</option>
          <option value="compacto">Compacto</option>
          <option value="medio">Médio</option>
          <option value="premium">Premium</option>
          <option value="pesado">Pesado</option>
        </select>
      </Field>
      {categoryError && <p className="form-error" role="alert">{categoryError}</p>}
      <Field label="Execução nesta OS">
        <select
          value={execution}
          onChange={(e) => update(e.target.value, cost)}
        >
          <option value="internal">Interno</option>
          <option value="outsourced">Terceirizado</option>
        </select>
      </Field>
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
        {minutes} min · Hora utilizada: {money(rate)} · Alterações de execução,
        custo e preço valem somente para esta OS.
      </small>
    </>
  );
}

