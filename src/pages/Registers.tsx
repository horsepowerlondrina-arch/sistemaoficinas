import { productLabel, productDetails, matchesSearch } from "../../shared/productIdentity";
import { needsReplenishment } from "../../shared/stockThreshold";
import { ProductCategories } from "../components/ProductCategories";
import { ProductBatch } from "../components/ProductBatch";
import { NumericInput } from "../components/NumericInput";
import { CapturePanel } from "../components/CapturePanel";
import { useRef, useState, type ReactNode } from "react";
import { catalogSalePrice } from "../../shared/pricing";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Plus,
  Pencil,
  Users,
  CarFront,
  Package,
  Wrench,
  UserRound,
  ArrowUpRight,
} from "lucide-react";
import { useApp } from "../lib/context";
import { send } from "../lib/api";
import { money, initials, type Entity } from "../lib/types";
import {
  PageHeading,
  SearchBox,
  Modal,
  Field,
  Submit,
  Empty,
} from "../components/ui";
import { PlateField } from "../components/PlateField";
import { VehicleIdentityFields } from "../components/VehicleIdentityFields";
import { VehicleModelSelection } from "../components/VehicleModelSelection";
import { mergeVehicleLookup, lookupWouldReplace, vehicleDisplayModel } from "../../shared/vehicleIdentity";
import { VehicleCatalogReview } from "../components/VehicleCatalogReview";
import { candidateFields, fipeFields, emptyFipe, type FipeCandidate } from "../../shared/vehicleFipe";
type Kind = "customers" | "vehicles" | "catalog" | "professionals";
const config = {
  customers: {
    title: "Clientes",
    singular: "cliente",
    description: "Relacionamentos bem cuidados começam por aqui.",
    icon: Users,
  },
  vehicles: {
    title: "Veículos",
    singular: "veículo",
    description: "Cada veículo com seu dono, seus dados e sua história.",
    icon: CarFront,
  },
  catalog: {
    title: "Produtos",
    singular: "item",
    description:
      "Cadastre produtos manualmente ou importe pelo Sky Peças.",
    icon: Package,
  },
  professionals: {
    title: "Profissionais",
    singular: "profissional",
    description: "As pessoas que fazem sua oficina acontecer.",
    icon: UserRound,
  },
};
export function Registers({ kind, tabs }: { kind: Kind; tabs?: ReactNode }) {
  const { data, session, refresh } = useApp();
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") || "");
  const [filter, setFilter] = useState("active");
  const [editing, setEditing] = useState<Entity | null | undefined>();
  const c = config[kind];
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [vehicleReviewOpen, setVehicleReviewOpen] = useState(false);
  const [capture, setCapture] = useState<"sky" | null>(null);
  const Icon = c.icon;
  const rows = data[kind].filter(
    (r) =>
      (filter === "all" || (filter === "active" ? r.active : !r.active)) &&
      (kind !== "catalog" || r.kind === 'product') &&
      matchesSearch([
        r.name,
        r.search_aliases,
        r.plate,
        r.model,
        r.fipe_model,
        r.brand,
        r.customer_name,
        r.phone,
        r.email,
        r.sku,
        r.brand,
        r.manufacturer_code,
        r.application,
        r.usage_vehicles,
        r.category,
      ].join(" "), search),
  );
  return (
    <>
      <PageHeading
        title={c.title}
        description={c.description}
        actions={
          kind === "catalog" ? (
            <div className="capture-actions">
              <button
                className="button primary"
                onClick={() => {
                  setEditing(null);
                }}
              >
                <Package size={18} />
                Cadastrar produto
              </button>
              <button className="button" onClick={() => { setBatchOpen(true); }}>
                <Plus size={18} /> Cadastrar produtos
              </button>
            </div>
          ) : kind === "vehicles" ? (
            <div className="capture-actions">
              <button className="button" onClick={() => setVehicleReviewOpen(true)}>
                Revisar identificação
              </button>
              <button className="button primary" onClick={() => setEditing(null)}>
                <Plus size={18} />
                Novo veículo
              </button>
            </div>
          ) : (
            <button className="button primary" onClick={() => setEditing(null)}>
              <Plus size={18} />
              Novo {c.singular}
            </button>
          )
        }
      />
      {kind === "catalog" && (
        <div className="capture-actions">
          <button className="button" onClick={() => setCategoriesOpen(true)}>Editar categorias</button>
          <button className="button" onClick={() => setCapture("sky")}>
            Importar produto do Sky
          </button>
          <Link className="button" to="/configuracoes?aba=pecas">
            Configurar lucro das peças
          </Link>
        </div>
      )}
      {categoriesOpen && <ProductCategories onClose={() => setCategoriesOpen(false)} />}
      {vehicleReviewOpen && <VehicleCatalogReview onClose={() => setVehicleReviewOpen(false)} onReview={(vehicle) => { setVehicleReviewOpen(false); setEditing(vehicle); }} />}
      {batchOpen && <ProductBatch onClose={() => setBatchOpen(false)} />}
      {capture && (
        <CapturePanel
          catalog
          source={capture}
          onClose={async () => {
            await refresh();
            setCapture(null);
          }}
        />
      )}
      <section className={`panel register-panel${kind === "catalog" ? " products-register-panel" : ""}`}>
        {tabs}
        <div className="table-toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder={
              kind === "vehicles"
                ? "Buscar placa, modelo ou proprietário..."
                : `Buscar ${c.title.toLowerCase()}...`
            }
          />
          <div className="toolbar-right">
            <select
              aria-label="Situação dos cadastros"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
              <option value="all">Todos os cadastros</option>
            </select>
          </div>
        </div>
        {rows.length ? (
          <div className="table-scroll" tabIndex={kind === "catalog" ? 0 : undefined} role={kind === "catalog" ? "region" : undefined} aria-label={kind === "catalog" ? "Tabela de produtos" : undefined}>
            <table className={kind === "catalog" ? "products-register-table" : undefined}>
              {kind === "catalog" && <colgroup><col className="product-col-description" /><col className="product-col-reference" /><col className="product-col-cost" /><col className="product-col-price" /><col className="product-col-stock" /><col className="product-col-edit" /></colgroup>}
              <thead>
                <tr>
                  {(kind === "customers"
                    ? ["Cliente", "Contato", "E-mail", "Veículos", "Situação"]
                    : kind === "vehicles"
                      ? [
                          "Veículo",
                          "Placa",
                          "Proprietário",
                          "Quilometragem",
                          "Situação",
                        ]
                      : kind === "catalog"
                        ? [
                            "Descrição",
                            "Referência / categoria",
                            "Custo",
                            "Preço de venda",
                            "Estoque",
                          ]
                        : [
                            "Profissional",
                            "Cargo",
                            "Telefone",
                            "E-mail",
                            "Situação",
                          ]
                  ).map((x) => (
                    <th key={x}>{x}</th>
                  ))}
                  <th>
                    <span className="sr-only">Editar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    {kind === "customers" ? (
                      <>
                        <td>
                          <div className="person-cell">
                            <span className="avatar">{initials(r.name)}</span>
                            <div>
                              <button
                                className="cell-link"
                                onClick={() => setEditing(r)}
                              >
                                {r.kind === "product" ? productLabel(r) : r.name}
                              </button>
                              <small>{r.document || "Pessoa / empresa"}</small>
                            </div>
                          </div>
                        </td>
                        <td>{r.phone || "—"}</td>
                        <td>{r.email || "—"}</td>
                        <td>
                          {
                            data.vehicles.filter((v) => v.customer_id === r.id)
                              .length
                          }{" "}
                          veículos
                        </td>
                        <td>
                          <Active active={r.active} />
                        </td>
                      </>
                    ) : kind === "vehicles" ? (
                      <>
                        <td>
                          <div className="person-cell">
                            <span className="square-icon">
                              <CarFront size={20} />
                            </span>
                            <div>
                              <button
                                className="cell-link"
                                onClick={() => setEditing(r)}
                              >
                                {r.brand} {vehicleDisplayModel(r)}
                              </button>
                              <small>
                                {r.year || "Ano não informado"} ·{" "}
                                {r.color || "Cor não informada"}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="plate-tag">{r.plate}</span>
                        </td>
                        <td>{r.customer_name}</td>
                        <td>{r.km.toLocaleString("pt-BR")} km</td>
                        <td>
                          <Active active={r.active} />
                        </td>
                      </>
                    ) : kind === "catalog" ? (
                      <>
                        <td>
                          <div className="person-cell">
                            <span
                              className={`square-icon ${r.kind === "service" ? "red-bg" : ""}`}
                            >
                              {r.kind === "service" ? (
                                <Wrench size={19} />
                              ) : (
                                <Package size={19} />
                              )}
                            </span>
                            <div>
                              <button
                                className="cell-link"
                                onClick={() => setEditing(r)}
                              >
                                {r.kind === "product" ? productLabel(r) : r.name}
                              </button>
                              <small>
                                {r.kind === "product" ? productDetails(r) || "Produto" : "Serviço"}
                                {!r.active ? " · Inativo" : ""}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td>
                          {r.sku}
                          <small>{r.category || "Sem categoria"}</small>
                        </td>
                        <td className="money">
                          {r.cost_known === 0 ? "A conferir" : money(r.cost)}
                        </td>
                        <td className="money">{money(r.price)}</td>
                        <td>
                          {r.kind === "product" ? (
                            <span
                              className={
                                needsReplenishment(r) ? "low-stock" : ""
                              }
                            >
                              {r.stock_verified === 0
                                ? "A conferir"
                                : `${r.stock} un.`}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </>
                    ) : (
                      <>
                        <td>
                          <div className="person-cell">
                            <span className="avatar">{initials(r.name)}</span>
                            <button
                              className="cell-link"
                              onClick={() => setEditing(r)}
                            >
                              {r.name}
                            </button>
                          </div>
                        </td>
                        <td>{r.role}</td>
                        <td>{r.phone || "—"}</td>
                        <td>{r.email || "—"}</td>
                        <td>
                          <Active active={r.active} />
                        </td>
                      </>
                    )}
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Editar ${r.name || r.plate}`}
                        onClick={() => setEditing(r)}
                      >
                        <Pencil size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            action={
              kind === "catalog" ? (
                <button className="button" onClick={() => setEditing(null)}>
                  <Package size={16} />
                  Cadastrar produto
                </button>
              ) : (
                <button className="button" onClick={() => setEditing(null)}>
                  <Icon size={16} />
                  Adicionar {c.singular}
                </button>
              )
            }
          />
        )}
        <div className="panel-foot">
          {rows.length} {rows.length === 1 ? "registro" : "registros"}
          <span>Dados de {session.tenant.name}</span>
        </div>
      </section>
      {editing !== undefined && (
        <RegisterModal
          kind={kind}
          initial={
            kind === "catalog"
              ? { kind: "product" }
              : undefined
          }
          record={editing}
          onClose={() => setEditing(undefined)}
        />
      )}
    </>
  );
}
function Active({ active }: { active: number }) {
  return (
    <span className={`badge ${active ? "completed" : "cancelled"}`}>
      <span />
      {active ? "Ativo" : "Inativo"}
    </span>
  );
}
export function RegisterModal({
  kind,
  record,
  onClose,
  initial,
  onSaved,
  additionalFields,
}: {
  kind: Kind;
  record: Entity | null;
  onClose: () => void;
  initial?: Record<string, unknown>;
  onSaved?: (id: string, values: Record<string, any>) => void;
  additionalFields?: ReactNode;
}) {
  const { data, refresh, notify } = useApp();
  const navigate = useNavigate();
  const defaults: Record<Kind, Record<string, any>> = {
    customers: {
      name: "",
      phone: "",
      email: "",
      document: "",
      birthday: "",
      address: "",
      notes: "",
      active: 1,
    },
    vehicles: {
      ...emptyFipe,
      customer_id: "",
      plate: "",
      brand: "",
      model: "",
      year: new Date().getFullYear(),
      color: "",
      km: 0,
      chassis: "",
      active: 1,
    },
    catalog: {
      kind: "product",
      name: "",
      sku: `HP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      category: "",
      brand: "",
      manufacturer_code: "",
      application: "",
      cost: 0,
      freight_unit: 0,
      price: 0,
      stock: 0,
      minimum_stock: 0,
      active: 1,
    },
    professionals: {
      name: "",
      role: "Mecânico",
      phone: "",
      email: "",
      active: 1,
    },
  };
  const [form, setForm] = useState<Record<string, any>>({
    ...defaults[kind],
    ...initial,
    ...record,
    ...(kind === "catalog" && record
      ? { cost: record.cost - (record.freight_unit || 0) }
      : {}),
  });
  const pricingDirty = useRef(new Set<string>());
  const [withVehicle, setWithVehicle] = useState(false);
  const [vehicle, setVehicle] = useState({ ...defaults.vehicles });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [plateProposal, setPlateProposal] = useState<Record<string, any> | null>(null);
  const [plateProposalBusy, setPlateProposalBusy] = useState(false);
  const [plateCandidates, setPlateCandidates] = useState<FipeCandidate[]>([]);
  const lookupVehicleForReview = async () => {
    if (kind !== "vehicles" || !record?.id) return;
    setPlateProposalBusy(true);
    setError("");
    setPlateProposal(null);
    setPlateCandidates([]);
    try {
      const result = await send(`/vehicles/${record.id}/lookup-refresh`, {}, "POST");
      setPlateProposal(result);
      setPlateCandidates(result.fipe_candidates || []);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPlateProposalBusy(false);
    }
  };
  const applyVehicleLookup = async () => {
    if (kind !== "vehicles" || !record?.id || !plateProposal?.vehicle) return;
    if (!plateProposal.confirmation_token) {
      setError("Consulte a placa novamente antes de aplicar os dados.");
      return;
    }
    const candidateIndex = plateProposal.fipe_candidates?.findIndex((candidate: FipeCandidate) => candidate.codigoFipe && candidate.codigoFipe === form.fipe_code) ?? -1;
    const candidate = candidateIndex >= 0 ? plateProposal.fipe_candidates[candidateIndex] : undefined;
    const previewValues = { ...plateProposal.vehicle, ...(candidate ? candidateFields(candidate) : {}) };
    const fields = ["brand", "year", "model_year", "fuel", "color", "fipe_code", "fipe_model", "fipe_year_id"]
      .filter((field) => (field !== "fipe_model" || !form.service_model_id) && previewValues[field] !== undefined && previewValues[field] !== null && previewValues[field] !== ""
        && String(plateProposal.current?.[field] ?? "") !== String(previewValues[field]));
    if (!fields.length) { setError("A consulta não trouxe dados diferentes para aplicar."); return; }
    const selectedValues = Object.fromEntries(fields.map((field) => [field, previewValues[field]]));
    setPlateProposalBusy(true);
    setError("");
    try {
      await send(`/vehicles/${record.id}/apply-lookup`, {
        fields,
        confirmation_token: plateProposal.confirmation_token,
        fipe_candidate_index: candidateIndex >= 0 ? candidateIndex : null,
      });
      setForm((current) => ({ ...current, ...selectedValues }));
      await refresh();
      notify("Campos selecionados atualizados; a consulta foi registrada no histórico.");
      setPlateProposal(null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPlateProposalBusy(false);
    }
  };
  const set = (key: string, value: any) =>
    setForm((f) => ({ ...f, [key]: value }));
  const input = (
    key: string,
    label: string,
    type = "text",
    required = false,
    full = false,
  ) => (
    <Field key={key} label={label} full={full}>
      <NumericInput
        type={type}
        required={required}
        value={form[key]}
        min={type === "number" ? 0 : undefined}
        onChange={(e) =>
          set(key, type === "number" ? Number(e.target.value) : e.target.value)
        }
        maxLength={type === "number" ? undefined : 500}
      />
    </Field>
  );
  const moneyInput = (key: string, label: string) => (
    <Field label={label}>
      <NumericInput
        type="number"
        required
        min="0"
        step="0.01"
        value={form[key] / 100}
        onChange={(e) => {
          pricingDirty.current.add(key);
          set(key, Math.round(Number(e.target.value) * 100));
        }}
        onBlur={(e) => {
          if (
            !["cost", "freight_unit"].includes(key) ||
            !pricingDirty.current.delete(key)
          )
            return;
          if (!e.currentTarget.validity.valid || !data.parts_pricing) return;
          try {
            const price = catalogSalePrice(
              form.kind,
              form.cost,
              form.freight_unit,
              data.parts_pricing,
            );
            set("price", price);
          } catch (error) {
            setError((error as Error).message);
          }
        }}
      />
    </Field>
  );
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await send(
        kind === "customers" && !record && withVehicle
          ? "/customers-with-vehicle"
          : `/${kind}${record ? `/${record.id}` : ""}`,
        kind === "customers" && !record && withVehicle
          ? { customer: form, vehicle }
          : kind === "catalog"
            ? {
                ...form,
                cost:
                  form.cost + (form.kind === "product" ? form.freight_unit : 0),
                freight_unit: form.kind === "product" ? form.freight_unit : 0,
              }
            : form,
        record ? "PUT" : "POST",
      );
      await refresh();
      notify("Cadastro salvo com sucesso.");
      onSaved?.(result.id, {
        ...form,
        ...(kind === "catalog"
          ? {
              cost:
                form.cost + (form.kind === "product" ? form.freight_unit : 0),
            }
          : {}),
        vehicle_id: result.vehicle_id,
        vehicle_km: vehicle.km,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const history = record
    ? data.orders.filter((o) =>
        kind === "customers"
          ? o.customer_id === record.id
          : kind === "vehicles"
            ? o.vehicle_id === record.id
            : false,
      )
    : [];
  return (
    <Modal
      title={`${record ? "Editar" : "Novo"} ${kind === "catalog" ? (form.kind === "product" ? "produto" : "serviço") : config[kind].singular}`}
      description={
        record
          ? "Mantenha os dados da oficina sempre atualizados."
          : "Um novo cadastro para a sua oficina."
      }
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <div className="form-grid">
            {kind === "customers" ? (
              <>
                {input(
                  "name",
                  "Nome completo / razão social",
                  "text",
                  true,
                  true,
                )}
                {input("phone", "Telefone / celular")}
                {input("email", "E-mail", "email")}
                {input("document", "CPF / CNPJ")}
                {input("birthday", "Data de nascimento", "date")}
                {input("address", "Endereço", "text", false, true)}
                {input("notes", "Observações", "text", false, true)}
                {!record && (
                  <>
                    <label className="checkbox-row full">
                      <input
                        type="checkbox"
                        checked={withVehicle}
                        onChange={(e) => setWithVehicle(e.target.checked)}
                      />
                      Cadastrar um veículo junto
                    </label>
                    {withVehicle && (
                      <div className="form-grid full">
                        <PlateField
                          value={vehicle.plate}
                          showFipeSelection={false}
                          onChange={(plate) =>
                            setVehicle((v) => ({ ...v, plate, ...emptyFipe, service_model_id: undefined }))
                          }
                          onFound={(r) => {
                            if (r.fipe_candidates) setPlateCandidates(r.fipe_candidates);
                            if (r.selectionOnly) {
                              setVehicle(current => ({ ...current, ...fipeFields(r.vehicle) }));
                              return;
                            }
                            if (r.vehicle && r.source !== "local" && (!lookupWouldReplace(vehicle, r.vehicle) || window.confirm("A consulta retornou dados diferentes dos já preenchidos. Aplicar os novos dados?")))
                              setVehicle((v) => mergeVehicleLookup(v, r.vehicle));
                          }}
                        />
                        <VehicleIdentityFields vehicle={vehicle} onChange={setVehicle} km={vehicle.km} onKmChange={(value) => setVehicle((current) => ({ ...current, km: value }))} />
                        <VehicleModelSelection vehicle={vehicle} onChange={setVehicle} candidates={plateCandidates} />
                      </div>
                    )}
                  </>
                )}
              </>
            ) : kind === "vehicles" ? (
              <>
                <Field label="Proprietário *" full>
                  <select
                    required
                    value={form.customer_id}
                    onChange={(e) => set("customer_id", e.target.value)}
                  >
                    <option value="">Selecione um cliente</option>
                    {data.customers
                      .filter((c) => c.active || c.id === form.customer_id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </Field>
                {record && <section className="vehicle-plate-refresh full">
                  {plateProposal && !plateProposal.vehicle && <p className="lookup-message" role="status">{plateProposal.message}</p>}
                  <div className="capture-actions">
                    <button type="button" className="button" disabled={plateProposalBusy} onClick={() => void lookupVehicleForReview()}>
                      {plateProposalBusy ? "Consultando…" : "Consultar placa para atualizar"}
                    </button>
                    <small>Consulta externa somente após este clique. O cadastro não será alterado até você confirmar os campos.</small>
                  </div>
                  {plateProposal?.vehicle && <div className="vehicle-lookup-proposal">
                    <p><strong>{plateProposal.cache_status === "hit" ? "Consulta reutilizada do cache" : "Prévia da consulta"}</strong> · {plateProposal.message}</p>
                    <p className="muted">Confira as diferenças antes de confirmar. O modelo escolhido abaixo será preservado.</p>
                    {(["brand","year","model_year","fuel","color"] as const).map((field) => {
                      const next = plateProposal.vehicle[field];
                      if (next === undefined || next === null || next === "" || String(form[field] ?? "") === String(next)) return null;
                      const labels = { brand: "Marca", year: "Ano de fabricação", model_year: "Ano do modelo", fuel: "Combustível", color: "Cor" };
                      return <p className="muted" key={field}>{labels[field]}: {String(form[field] || "—")} → {String(next)}</p>;
                    })}
                    <div className="capture-actions">
                      <button type="button" className="button primary" disabled={plateProposalBusy} onClick={() => void applyVehicleLookup()}>Confirmar atualização</button>
                      <button type="button" className="button" disabled={plateProposalBusy} onClick={() => { setPlateProposal(null); setPlateCandidates([]); }}>Manter cadastro atual</button>
                    </div>
                  </div>}
                </section>}
                <PlateField
                  value={form.plate}
                  lookupDisabled={!!record}
                  showFipeSelection={false}
                  onChange={(plate) => setForm(current => ({ ...current, plate, ...emptyFipe, service_model_id: record ? current.service_model_id : undefined }))}
                  onFound={(r) => {
                    if (r.fipe_candidates) setPlateCandidates(r.fipe_candidates);
                    if (r.selectionOnly) {
                      setForm(current => ({ ...current, ...fipeFields(r.vehicle) }));
                      return;
                    }
                    if (
                      r.vehicle &&
                      (r.source !== "local" || r.vehicle.id === record?.id) &&
                      (!lookupWouldReplace(form, r.vehicle) || window.confirm("A consulta retornou dados diferentes dos já preenchidos. Aplicar os novos dados?"))
                    )
                      setForm((f) => mergeVehicleLookup(f, r.vehicle));
                  }}
                />
                <VehicleIdentityFields vehicle={form} onChange={setForm} km={form.km} onKmChange={(value) => set("km", value)} />
                <VehicleModelSelection vehicle={form} onChange={setForm} candidates={plateCandidates} />
              </>
            ) : kind === "catalog" ? (
              <>
                <Field label="Tipo">
                  <select
                    disabled={!!record}
                    value={form.kind}
                    onChange={(e) => set("kind", e.target.value)}
                  >
                    <option value="product">Produto</option>
                    <option value="service">Serviço</option>
                  </select>
                </Field>
                {input("sku", "Referência *", "text", true)}
                {input("name", "Descrição *", "text", true, true)}
                {form.kind === "product" && <>
                  {input("brand", "Marca / fabricante")}
                  {input("manufacturer_code", "Código do fabricante")}
                  {input("application", "Aplicação informada pelo fabricante", "text", false, true)}
                  {!!form.usage_vehicles && <p className="muted full">Utilizada em: {String(form.usage_vehicles).replaceAll("\n","; ")}. O uso anterior não confirma compatibilidade.</p>}
                </>}
                {form.kind === "product" ? (
                  <Field label="Categoria" full>
                    <select value={form.category} onChange={(e) => set("category", e.target.value)}>
                      <option value="">Sem categoria</option>
                      {!!form.category && !(data.product_categories || []).some((c) => c.active && c.name === form.category) && <option value={form.category} disabled>{form.category} (categoria anterior)</option>}
                      {(data.product_categories || []).filter((c) => c.active).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                    <small>Escolha uma categoria da lista. Gerencie as opções em Produtos → Editar categorias.</small>
                  </Field>
                ) : input("category", "Categoria", "text", false, true)}
                {moneyInput(
                  "cost",
                  form.kind === "service"
                    ? "Custo do serviço / terceiros (R$)"
                    : "Custo sem frete (R$)",
                )}
                {form.kind === "product" &&
                  moneyInput("freight_unit", "Frete por unidade (R$)")}
                {moneyInput("price", "Preço de venda (R$)")}
                {form.kind === "product" && (
                  <div className="full info-box">
                    Lucro bruto por unidade:{" "}
                    <strong>
                      {money(form.price - form.cost - form.freight_unit)}
                    </strong>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        try {
                          if (data.parts_pricing)
                            set(
                              "price",
                              catalogSalePrice(
                                form.kind,
                                form.cost,
                                form.freight_unit,
                                data.parts_pricing,
                              ),
                            );
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      Aplicar regra de lucro
                    </button>
                  </div>
                )}
                {form.kind === "product" && (
                  <Field label="Estoque mínimo">
                    <NumericInput
                      type="number"
                      required
                      min="0"
                      step="1"
                      value={form.minimum_stock ?? 0}
                      onChange={(event) => set("minimum_stock", Math.max(0, Math.floor(Number(event.target.value) || 0)))}
                    />
                    <small>0: produto sob demanda, sem alerta. 1 ou mais: manter em estoque e avisar ao atingir o mínimo.</small>
                  </Field>
                )}
              </>
            ) : (
              <>
                {input("name", "Nome *", "text", true, true)}
                {input("role", "Cargo *", "text", true)}
                {input("phone", "Telefone")}
                {input("email", "E-mail", "email", false, true)}
              </>
            )}
            {record && (
              <Field label="Situação">
                <select
                  value={form.active}
                  onChange={(e) => set("active", Number(e.target.value))}
                >
                  <option value={1}>Ativo</option>
                  <option value={0}>Inativo</option>
                </select>
              </Field>
            )}
          </div>
          {additionalFields}
          {record && ["customers", "vehicles"].includes(kind) && (
            <section className="record-history">
              <h3>Histórico de atendimentos</h3>
              {history.length ? (
                history.map((o) => (
                  <button
                    type="button"
                    className="history-link"
                    key={o.id}
                    onClick={() => {
                      onClose();
                      navigate(`/ordens/${o.id}`);
                    }}
                  >
                    #{o.number} · {o.brand} {o.model}
                    <span>
                      {money(o.total)}
                      <ArrowUpRight size={15} />
                    </span>
                  </button>
                ))
              ) : (
                <p>Nenhum atendimento registrado.</p>
              )}
            </section>
          )}
          {error && (
            <div role="alert" className="error-box">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="button" onClick={onClose}>
            Cancelar
          </button>
          <Submit busy={busy}>Salvar cadastro</Submit>
        </div>
      </form>
    </Modal>
  );
}
