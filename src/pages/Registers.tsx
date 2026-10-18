import { productLabel, productDetails, matchesSearch } from "../../shared/productIdentity";
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
import { fipeFields, emptyFipe } from "../../shared/vehicleFipe";
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
    title: "Produtos e serviços",
    singular: "item",
    description:
      "Cadastre produtos e serviços manualmente ou importe pelo Sky Peças e Tempario.",
    icon: Package,
  },
  professionals: {
    title: "Profissionais",
    singular: "profissional",
    description: "As pessoas que fazem sua oficina acontecer.",
    icon: UserRound,
  },
};
export function Registers({ kind }: { kind: Kind }) {
  const { data, session, refresh } = useApp();
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") || "");
  const [filter, setFilter] = useState("active");
  const [type, setType] = useState("product");
  const [editing, setEditing] = useState<Entity | null | undefined>();
  const c = config[kind];
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [capture, setCapture] = useState<"sky" | "tempario" | null>(null);
  const Icon = c.icon;
  const rows = data[kind].filter(
    (r) =>
      (filter === "all" || (filter === "active" ? r.active : !r.active)) &&
      (kind !== "catalog" || type === "all" || r.kind === type) &&
      matchesSearch([
        r.name,
        r.search_aliases,
        r.plate,
        r.model,
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
        eyebrow="CADASTROS"
        title={c.title}
        description={c.description}
        actions={
          kind === "catalog" ? (
            <div className="capture-actions">
              <button
                className="button primary"
                onClick={() => {
                  setType("product");
                  setEditing(null);
                }}
              >
                <Package size={18} />
                Cadastrar produto
              </button>
              <button className="button" onClick={() => { setType("product"); setBatchOpen(true); }}>
                <Plus size={18} /> Cadastrar produtos
              </button>
              <button
                className="button"
                onClick={() => {
                  setType("service");
                  setEditing(null);
                }}
              >
                <Wrench size={18} />
                Cadastrar serviço
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
          <button className="button" onClick={() => setCapture("tempario")}>
            Importar serviço do Tempario
          </button>
          <Link className="button" to="/configuracoes?aba=pecas">
            Configurar lucro das peças
          </Link>
        </div>
      )}
      {categoriesOpen && <ProductCategories onClose={() => setCategoriesOpen(false)} />}
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
      <section className="panel register-panel">
        {kind === "catalog" && (
          <div className="tabs">
            {[
              ["product", "Produtos"],
              ["service", "Serviços"],
            ].map(([value, label]) => (
              <button
                key={value}
                className={type === value ? "active" : ""}
                onClick={() => setType(value)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
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
          <div className="table-scroll">
            <table>
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
                                {r.brand} {r.model}
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
                                r.stock <= r.minimum_stock ? "low-stock" : ""
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
                <div className="capture-actions">
                  <button
                    className="button"
                    onClick={() => {
                      setType("product");
                      setEditing(null);
                    }}
                  >
                    <Package size={16} />
                    Cadastrar produto
                  </button>
                  <button
                    className="button"
                    onClick={() => {
                      setType("service");
                      setEditing(null);
                    }}
                  >
                    <Wrench size={16} />
                    Cadastrar serviço
                  </button>
                </div>
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
              ? { kind: type === "service" ? "service" : "product" }
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
                          onChange={(plate) =>
                            setVehicle((v) => ({ ...v, plate, ...emptyFipe }))
                          }
                          onFound={(r) => {
                            if (r.selectionOnly) {
                              setVehicle(current => ({ ...current, ...fipeFields(r.vehicle) }));
                              return;
                            }
                            if (r.vehicle && r.source !== "local")
                              setVehicle((v) => ({ ...v, ...r.vehicle }));
                          }}
                        />
                        {[
                          ["brand", "Marca"],
                          ["model", "Modelo"],
                          ["year", "Ano"],
                          ["color", "Cor"],
                          ["km", "Quilometragem"],
                        ].map(([key, label]) => (
                          <Field key={key} label={label}>
                            <NumericInput
                              required={["brand", "model", "year"].includes(
                                key,
                              )}
                              type={
                                ["year", "km"].includes(key) ? "number" : "text"
                              }
                              min={0}
                              value={vehicle[key]}
                              onChange={(e) =>
                                setVehicle((v) => ({
                                  ...v,
                                  [key]: ["year", "km"].includes(key)
                                    ? Number(e.target.value)
                                    : e.target.value,
                                }))
                              }
                            />
                          </Field>
                        ))}
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
                <PlateField
                  value={form.plate}
                  onChange={(plate) => setForm(current => ({ ...current, plate, ...emptyFipe }))}
                  onFound={(r) => {
                    if (r.selectionOnly) {
                      setForm(current => ({ ...current, ...fipeFields(r.vehicle) }));
                      return;
                    }
                    if (
                      r.vehicle &&
                      (r.source !== "local" || r.vehicle.id === record?.id)
                    )
                      setForm((f) => ({ ...f, ...r.vehicle }));
                  }}
                />
                {input("brand", "Marca *", "text", true)}
                {input("model", "Modelo *", "text", true)}
                {input("year", "Ano *", "number", true)}
                {input("color", "Cor")}
                {input("km", "Quilometragem", "number")}
                {input("chassis", "Chassi", "text", false, true)}
                <Field label="Código FIPE" full>
                  <input readOnly value={form.fipe_code || ""} placeholder="Não identificado" />
                  {!!form.fipe_model && <small>{form.fipe_model} · {form.fipe_year_id}</small>}
                </Field>
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
                    <small>Escolha uma categoria da lista. Gerencie as opções em Produtos e serviços → Editar categorias.</small>
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
                  <>
                    {input("minimum_stock", "Estoque mínimo", "number")}
                  </>
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
