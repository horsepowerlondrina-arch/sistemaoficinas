import { VehiclePlate } from "../components/VehiclePlate";
import { IssuedDocument } from "../components/IssuedDocument";
import { NumericInput } from "../components/NumericInput";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Printer,
  Save,
  Trash2,
} from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, send } from "../lib/api";
import { useApp } from "../lib/context";
import type { Entity } from "../lib/types";
import { Empty, Field, PageHeading } from "../components/ui";
import { PlateField } from "../components/PlateField";
import { VehicleIdentityFields } from "../components/VehicleIdentityFields";
import { VehicleTechnicalAssociation } from "../components/VehicleTechnicalAssociation";
import { fipeFields, emptyFipe } from "../../shared/vehicleFipe";
import { mergeVehicleLookup, lookupWouldReplace, vehicleDisplayModel } from "../../shared/vehicleIdentity";

const conditionItems = [
  "Para-brisa e vidros",
  "Rodas e pneus",
  "Retrovisores",
  "Faróis e lanternas",
  "Bateria",
  "Estepe",
  "Macaco",
  "Chave de roda",
  "Tapetes",
];
const panelItems = ["Injeção", "ABS", "Airbag", "Bateria", "Temperatura"];
const photoKinds = [
  ["front", "Frente"],
  ["rear", "Traseira"],
  ["left", "Lateral esquerda"],
  ["right", "Lateral direita"],
  ["dashboard", "Painel / quilometragem"],
  ["damage", "Avaria / adicional"],
  ["other", "Foto adicional"],
] as const;
const damageTypes = [
  "Risco",
  "Amassado",
  "Trinca",
  "Avaria / adicional",
] as const;

type Damage = {
  x: number;
  y: number;
  type: (typeof damageTypes)[number];
  note: string;
};

function emptyConditionMap() {
  return Object.fromEntries(conditionItems.map((item) => [item, "unchecked"]));
}
function emptyPanelMap() {
  return Object.fromEntries(panelItems.map((item) => [item, false]));
}

async function compressPhoto(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Não foi possível abrir a foto."));
      image.src = url;
    });
    const max = 1280;
    const scale = Math.min(1, max / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar a foto.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Não foi possível preparar a foto.")),
        "image/jpeg",
        0.72,
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function SignaturePad({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!value) return;
    const image = new Image();
    image.onload = () =>
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.src = value;
  }, [value]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = ref.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };
  const start = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    drawing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = point(event);
    const context = ref.current?.getContext("2d");
    if (!context) return;
    context.beginPath();
    context.moveTo(p.x, p.y);
  };
  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled || !drawing.current) return;
    const p = point(event);
    const context = ref.current?.getContext("2d");
    if (!context) return;
    context.lineWidth = 3;
    context.lineCap = "round";
    context.strokeStyle = "#111";
    context.lineTo(p.x, p.y);
    context.stroke();
  };
  const end = () => {
    if (disabled || !drawing.current) return;
    drawing.current = false;
    const canvas = ref.current;
    if (canvas) onChange(canvas.toDataURL("image/png"));
  };

  return (
    <div className="signature-box">
      <canvas
        ref={ref}
        width={720}
        height={220}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      {!disabled && (
        <button
          type="button"
          className="text-button"
          onClick={() => onChange("")}
        >
          Limpar assinatura
        </button>
      )}
    </div>
  );
}

function DamageMap({
  damages,
  disabled,
  selectedType,
  onChange,
}: {
  damages: Damage[];
  disabled: boolean;
  selectedType: Damage["type"];
  onChange: (items: Damage[]) => void;
}) {
  const add = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    onChange([...damages, { x, y, type: selectedType, note: "" }]);
  };

  return (
    <div className="damage-map-wrap">
      <svg
        className="damage-map"
        viewBox="0 0 320 600"
        role="img"
        aria-label="Mapa de avarias do veículo"
        onClick={add}
      >
        <path
          className="damage-car-body"
          d="M110 35 Q160 12 210 35 L245 115 L258 470 Q244 550 205 575 L115 575 Q76 550 62 470 L75 115 Z"
        />
        <path
          className="damage-car-window"
          d="M105 105 Q160 72 215 105 L225 180 L95 180 Z"
        />
        <path
          className="damage-car-window"
          d="M94 205 L226 205 L233 388 L87 388 Z"
        />
        <path
          className="damage-car-window"
          d="M96 414 L224 414 L211 505 Q160 535 109 505 Z"
        />
        <line x1="72" y1="300" x2="248" y2="300" />
        {damages.map((damage, index) => (
          <g key={index} className="damage-marker" pointerEvents="none">
            <circle cx={damage.x * 3.2} cy={damage.y * 6} r="14" />
            <text
              x={damage.x * 3.2}
              y={damage.y * 6 + 5}
              textAnchor="middle"
            >
              {index + 1}
            </text>
          </g>
        ))}
      </svg>
      <p className="muted">
        Toque na região do veículo para registrar a avaria selecionada.
      </p>
    </div>
  );
}

export function ChecklistEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data, session, notify, refresh } = useApp();
  const orderParam = params.get("order") || "";
  const initialOrder = data.orders.find((o) => o.id === orderParam);
  const initialVehicle = data.vehicles.find(
    (v) => v.id === initialOrder?.vehicle_id,
  );
  const initialCustomer = data.customers.find(
    (customer) => customer.id === initialVehicle?.customer_id,
  );
  const [creating, setCreating] = useState({
    order_id: initialOrder?.id || "",
    plate: initialVehicle?.plate || "",
    lookup_source: initialVehicle ? "local" : "",
    customer_id: initialCustomer?.id || "",
    customer_name: initialCustomer?.name || "",
    phone: initialCustomer?.phone || "",
    vehicle_data: {
      ...fipeFields(initialVehicle),
      brand: initialVehicle?.brand || "",
      model: initialVehicle?.model || "",
      year: initialVehicle?.year || new Date().getFullYear(),
      color: initialVehicle?.color || "",
      chassis: initialVehicle?.chassis || "",
      service_model_id: initialVehicle?.service_model_id || null,
      service_link_mode: initialVehicle?.service_link_mode || "",
    },
    km: initialOrder?.km || initialVehicle?.km || 0,
    fuel_level: 50,
    inspector: session.user.name,
  });
  const [lookupDone, setLookupDone] = useState(!!initialVehicle);
  const [record, setRecord] = useState<Entity | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photoKind, setPhotoKind] =
    useState<(typeof photoKinds)[number][0]>("front");
  const [damageType, setDamageType] =
    useState<Damage["type"]>("Risco");

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const next = await api<Entity>(`/checklists/${id}`);
      setRecord({
        ...next,
        conditions: { ...emptyConditionMap(), ...(next.conditions || {}) },
        panel_lights: { ...emptyPanelMap(), ...(next.panel_lights || {}) },
        damages: next.damages || [],
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const selectedCustomer = data.customers.find(
    (customer) => customer.id === creating.customer_id,
  );

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await send("/checklists", {
        ...creating,
        order_id: creating.order_id || null,
        customer_id: creating.customer_id || null,
      });
      navigate(`/checklists/${result.id}`, { replace: true });
      notify("Checklist iniciado.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const payload = () => ({
    km: Number(record?.km || 0),
    fuel_level: Number(record?.fuel_level || 0),
    inspector: record?.inspector || "",
    complaint: record?.complaint || "",
    conditions: record?.conditions || {},
    accessories_notes: record?.accessories_notes || "",
    panel_lights: record?.panel_lights || {},
    panel_notes: record?.panel_notes || "",
    objects_left: record?.objects_left || "",
    functioning_notes: record?.functioning_notes || "",
    damages: record?.damages || [],
    damage_notes: record?.damage_notes || "",
    signature_data: record?.signature_data || "",
    signature_absent_reason: record?.signature_absent_reason || "",
    customer_confirmed: !!record?.customer_confirmed,
  });

  const save = async (silent = false) => {
    if (!record || record.status !== "draft") return record;
    setBusy(true);
    setError("");
    try {
      const next = await send(
        `/checklists/${record.id}`,
        payload(),
        "PUT",
      );
      setRecord(next);
      if (!silent) notify("Rascunho do checklist salvo.");
      return next;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const finalize = async () => {
    if (!record) return;
    if (!(record.photos || []).length) {
      const proceed = window.confirm(
        "Nenhuma foto foi registrada. Deseja finalizar o checklist mesmo assim?",
      );
      if (!proceed) return;
    }
    setBusy(true);
    setError("");
    try {
      await send(`/checklists/${record.id}`, payload(), "PUT");
      const next = await send(
        `/checklists/${record.id}/finalize`,
        {},
      );
      setRecord(next);
      await refresh();
      if (next.created_quote && next.redirect_order_id) {
        notify(
          "Checklist finalizado. Cliente/veículo conferidos e OS criada no status Orçamento.",
        );
        navigate(`/ordens/${next.redirect_order_id}/editar`, {
          replace: true,
        });
        return;
      }
      notify("Checklist finalizado.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file?: File) => {
    if (!file || !record) return;
    setBusy(true);
    setError("");
    try {
      const blob = await compressPhoto(file);
      const response = await fetch(
        `/api/checklists/${record.id}/photos?kind=${encodeURIComponent(photoKind)}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "image/jpeg" },
          body: blob,
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Não foi possível salvar a foto.");
      await load();
      notify("Foto adicionada.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = async (photoId: string) => {
    if (!record) return;
    setBusy(true);
    try {
      await send(
        `/checklists/${record.id}/photos/${photoId}`,
        {},
        "DELETE",
      );
      await load();
      notify("Foto excluída.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!id) {
    const local = creating.lookup_source === "local";
    const hasCustomer =
      !!creating.customer_id || creating.customer_name.trim().length >= 2;
    const vehicleReady =
      creating.vehicle_data.brand.trim().length >= 2 &&
      creating.vehicle_data.model.trim().length >= 2 &&
      Number(creating.vehicle_data.year) >= 1900;
    const canStart =
      lookupDone &&
      creating.plate.length === 7 &&
      hasCustomer &&
      vehicleReady &&
      creating.inspector.trim().length >= 2;

    return (
      <>
        <button className="back-link" onClick={() => navigate("/checklists")}>
          ← Voltar aos checklists
        </button>
        <PageHeading
          eyebrow="CHECKLIST DE ENTRADA"
          title="Novo checklist"
          description="Comece pela placa. O sistema verifica o cadastro da oficina e, quando necessário, consulta os dados do veículo automaticamente."
        />
        {error && <div className="error-box">{error}</div>}

        <section className="panel checklist-start plate-first-start">
          {initialOrder && (
            <div className="checklist-order-context">
              Atendimento vinculado:{" "}
              <strong>
                OS #
                {initialOrder.number}
              </strong>
            </div>
          )}

          <div className="checklist-first-question">
            <span>1</span>
            <div>
              <strong>Qual é a placa do veículo?</strong>
              <small>
                Primeiro verificamos se o veículo e o cliente já estão cadastrados.
              </small>
            </div>
          </div>

          <PlateField
            value={creating.plate}
            disabled={!!initialOrder}
            onChange={(plate) => {
              setLookupDone(false);
              setCreating((current) => ({
                ...current,
                plate,
                lookup_source: "",
                customer_id: "",
                customer_name: "",
                phone: "",
                vehicle_data: {
                  ...emptyFipe,
                  brand: "",
                  model: "",
                  year: new Date().getFullYear(),
                  color: "",
                  chassis: "",
                  service_model_id: null,
                  service_link_mode: "",
                },
              }));
            }}
            onFound={(result) => {
              if (result.selectionOnly) {
                setCreating(current => ({ ...current, vehicle_data: { ...current.vehicle_data, ...fipeFields(result.vehicle) } }));
                return;
              }
              const found = result.vehicle;
              if (result.source === "local" && found) {
                const customer = data.customers.find(
                  (item) => item.id === found.customer_id,
                );
                setCreating((current) => ({
                  ...current,
                  plate: String(found.plate || current.plate),
                  lookup_source: "local",
                  customer_id: String(found.customer_id || ""),
                  customer_name: customer?.name || "",
                  phone: customer?.phone || "",
                  vehicle_data: {
                    ...fipeFields(found),
                    brand: String(found.brand || ""),
                    model: String(found.model || ""),
                    year: Number(found.year || new Date().getFullYear()),
                    color: String(found.color || ""),
                    chassis: String(found.chassis || ""),
                    service_model_id: found.service_model_id || null,
                    service_link_mode: found.service_link_mode || "",
                  },
                  km: Number(found.km || current.km || 0),
                }));
              } else {
                if (found && lookupWouldReplace(creating.vehicle_data, found) && !window.confirm("A consulta retornou dados diferentes dos já preenchidos. Aplicar os novos dados?")) return;
                setCreating((current) => ({
                  ...current,
                  lookup_source: result.source || "manual",
                  vehicle_data: mergeVehicleLookup(current.vehicle_data, found) as typeof current.vehicle_data,
                }));
              }
              setLookupDone(true);
            }}
          />

          {!lookupDone && (
            <p className="checklist-lookup-hint">
              Informe a placa completa e toque em <b>Consultar placa</b> para
              continuar.
            </p>
          )}

          {lookupDone && (
            <>
              <div
                className={`checklist-lookup-result ${local ? "found" : "new"}`}
              >
                <strong>
                  {local
                    ? "Veículo encontrado no cadastro da oficina"
                    : "Veículo ainda não cadastrado"}
                </strong>
                <span>
                  {local
                    ? "O checklist será vinculado ao cliente e veículo existentes."
                    : "Confira os dados abaixo. O cadastro só será criado quando o checklist for finalizado."}
                </span>
              </div>

              {!local && !initialOrder && (
                <div className="form-grid checklist-customer-step">
                  <Field label="Cliente já cadastrado?" full>
                    <select
                      value={creating.customer_id}
                      onChange={(e) => {
                        const customer = data.customers.find(
                          (item) => item.id === e.target.value,
                        );
                        setCreating((current) => ({
                          ...current,
                          customer_id: e.target.value,
                          customer_name: customer?.name || "",
                          phone: customer?.phone || "",
                        }));
                      }}
                    >
                      <option value="">Não · cadastrar novo cliente ao finalizar</option>
                      {data.customers
                        .filter((customer) => customer.active)
                        .map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.name}
                            {customer.phone ? ` · ${customer.phone}` : ""}
                          </option>
                        ))}
                    </select>
                  </Field>

                  {!creating.customer_id && (
                    <>
                      <Field label="Nome do cliente *">
                        <input
                          value={creating.customer_name}
                          onChange={(e) =>
                            setCreating((current) => ({
                              ...current,
                              customer_name: e.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field label="Telefone / celular">
                        <input
                          value={creating.phone}
                          onChange={(e) =>
                            setCreating((current) => ({
                              ...current,
                              phone: e.target.value,
                            }))
                          }
                        />
                      </Field>
                    </>
                  )}
                </div>
              )}

              {local && (
                <div className="checklist-linked-data">
                  <strong>{selectedCustomer?.name || creating.customer_name}</strong>
                  <span>
                    <VehiclePlate value={creating.plate} compact /> · {creating.vehicle_data.brand}{" "}
                    {vehicleDisplayModel(creating.vehicle_data)} · {creating.vehicle_data.year}
                  </span>
                </div>
              )}

              <div className="form-grid checklist-vehicle-step">
                <VehicleIdentityFields vehicle={creating.vehicle_data} disabled={local} onChange={(value) => setCreating((current) => ({ ...current, vehicle_data: value as typeof current.vehicle_data }))} km={creating.km} onKmChange={(value) => setCreating((current) => ({ ...current, km: value }))} />
                <VehicleTechnicalAssociation vehicle={creating.vehicle_data} modelId={String(creating.vehicle_data.service_model_id || "")} onModelChange={(id) => setCreating((current) => ({ ...current, vehicle_data: { ...current.vehicle_data, service_model_id: id || null, service_link_mode: id ? "manual" : "none" } }))} />
                <Field label="Nível de combustível">
                  <select
                    value={creating.fuel_level}
                    onChange={(e) =>
                      setCreating((current) => ({
                        ...current,
                        fuel_level: Number(e.target.value),
                      }))
                    }
                  >
                    <option value={0}>Vazio</option>
                    <option value={25}>1/4</option>
                    <option value={50}>1/2</option>
                    <option value={75}>3/4</option>
                    <option value={100}>Cheio</option>
                  </select>
                </Field>
                <Field label="Responsável pelo checklist *" full>
                  <input
                    value={creating.inspector}
                    onChange={(e) =>
                      setCreating((current) => ({
                        ...current,
                        inspector: e.target.value,
                      }))
                    }
                  />
                </Field>
              </div>

              <div className="panel-foot">
                <span>
                  {!creating.order_id
                    ? "Ao finalizar, o sistema confere/cria os cadastros necessários e abre uma OS no status Orçamento."
                    : "Este checklist permanecerá vinculado ao atendimento já existente."}
                </span>
                <button
                  className="button primary"
                  disabled={busy || !canStart}
                  onClick={() => void create()}
                >
                  <ClipboardCheck size={17} />
                  {busy ? "Criando..." : "Continuar checklist"}
                </button>
              </div>
            </>
          )}
        </section>
      </>
    );
  }

  if (loading)
    return (
      <div className="panel checklist-loading">Carregando checklist...</div>
    );

  if (!record)
    return (
      <Empty
        title="Checklist não encontrado"
        description={error || "O registro não pôde ser carregado."}
      />
    );

  const locked = record.status === "completed";
  const set = (key: string, value: any) =>
    setRecord((current) =>
      current ? { ...current, [key]: value } : current,
    );

  return (
    <>
      <IssuedDocument key={record.id} kind="checklist" id={record.id} />
      <div className="no-print">
        <button className="back-link" onClick={() => navigate("/checklists")}>
          ← Voltar aos checklists
        </button>
        <PageHeading
          eyebrow="CHECKLIST DE ENTRADA"
          title={record.vehicle_label || "Checklist"}
          description={`${record.customer_name}${
            record.order_number
              ? ` · OS #${record.order_number}`
              : ""
          }`}
          actions={
            <>
              <Link
                className="button"
                to={`/checklists?q=${encodeURIComponent(record.plate)}`}
              >
                Consultar entradas desta placa
              </Link>

            </>
          }
        />

        {error && <div className="error-box">{error}</div>}
        {locked && (
          <div className="checklist-readonly">
            <CheckCircle2 size={18} />
            Checklist finalizado · somente leitura
          </div>
        )}

        <section className="panel checklist-section">
          <div className="section-heading">
            <div>
              <h2>Dados de entrada</h2>
              <p>Cliente, veículo, painel e reclamação inicial.</p>
            </div>
          </div>
          <div className="form-grid">
            <Field label="Cliente">
              <input value={record.customer_name} disabled />
            </Field>
            <Field label="Placa">
              <VehiclePlate value={record.plate} />
            </Field>
            <Field label="Veículo" full>
              <input value={record.vehicle_label} disabled />
            </Field>
            <Field label="Quilometragem (km)">
              <NumericInput
                disabled={locked}
                type="number"
                min="0"
                value={record.km}
                onChange={(e) =>
                  set("km", Math.max(0, Number(e.target.value)))
                }
              />
            </Field>
            <Field label="Nível de combustível">
              <select
                disabled={locked}
                value={record.fuel_level}
                onChange={(e) =>
                  set("fuel_level", Number(e.target.value))
                }
              >
                <option value={0}>Vazio</option>
                <option value={25}>1/4</option>
                <option value={50}>1/2</option>
                <option value={75}>3/4</option>
                <option value={100}>Cheio</option>
              </select>
            </Field>
            <Field label="Responsável pelo checklist *" full>
              <input
                disabled={locked}
                value={record.inspector}
                onChange={(e) => set("inspector", e.target.value)}
              />
            </Field>
            <Field label="Reclamação do cliente" full>
              <textarea
                disabled={locked}
                rows={4}
                value={record.complaint}
                onChange={(e) => set("complaint", e.target.value)}
              />
            </Field>
          </div>
        </section>

        <section className="panel checklist-section">
          <div className="section-heading">
            <div>
              <h2>Itens e acessórios</h2>
              <p>Confira os acessórios e condições visíveis na entrada.</p>
            </div>
          </div>
          <div className="condition-grid">
            {conditionItems.map((item) => (
              <label className="condition-card" key={item}>
                <span>{item}</span>
                <select
                  disabled={locked}
                  value={record.conditions?.[item] || "unchecked"}
                  onChange={(e) =>
                    set("conditions", {
                      ...record.conditions,
                      [item]: e.target.value,
                    })
                  }
                >
                  <option value="ok">OK</option>
                  <option value="issue">Avaria</option>
                  <option value="unchecked">Não verificado</option>
                </select>
              </label>
            ))}
          </div>
          <Field label="Observações dos itens" full>
            <textarea
              disabled={locked}
              rows={3}
              value={record.accessories_notes}
              onChange={(e) =>
                set("accessories_notes", e.target.value)
              }
            />
          </Field>
        </section>

        <section className="panel checklist-section">
          <div className="section-heading">
            <div>
              <h2>Painel / funcionamento</h2>
              <p>
                Registre as luzes observadas com o motor em funcionamento.
              </p>
            </div>
          </div>
          <div className="panel-light-grid">
            {panelItems.map((item) => (
              <label className="check-toggle" key={item}>
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={!!record.panel_lights?.[item]}
                  onChange={(e) =>
                    set("panel_lights", {
                      ...record.panel_lights,
                      [item]: e.target.checked,
                    })
                  }
                />
                <span>{item}</span>
              </label>
            ))}
          </div>
          <div className="form-grid">
            <Field label="Outras luzes / mensagens do painel" full>
              <textarea
                disabled={locked}
                rows={2}
                value={record.panel_notes}
                onChange={(e) => set("panel_notes", e.target.value)}
              />
            </Field>
            <Field label="Observações de funcionamento" full>
              <textarea
                disabled={locked}
                rows={3}
                value={record.functioning_notes}
                onChange={(e) =>
                  set("functioning_notes", e.target.value)
                }
              />
            </Field>
            <Field label="Objetos deixados no veículo" full>
              <textarea
                disabled={locked}
                rows={2}
                value={record.objects_left}
                onChange={(e) => set("objects_left", e.target.value)}
              />
            </Field>
          </div>
        </section>

        <section className="panel checklist-section">
          <div className="section-heading">
            <div>
              <h2>Fotos</h2>
              <p>
                Fotografe frente, traseira, laterais, painel e avarias.
              </p>
            </div>
          </div>

          {!locked && (
            <div className="photo-capture-bar">
              <select
                value={photoKind}
                onChange={(e) =>
                  setPhotoKind(e.target.value as typeof photoKind)
                }
              >
                {photoKinds.map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
              <label className="button primary">
                <Camera size={17} />
                Tirar / adicionar foto
                <input
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    void upload(e.target.files?.[0]);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
          )}

          {(record.photos || []).length ? (
            <div className="checklist-photo-grid">
              {record.photos.map((photo: Entity) => (
                <figure key={photo.id}>
                  <img
                    src={`/api/checklist-photos/${photo.id}`}
                    alt={
                      photoKinds.find(
                        ([value]) => value === photo.kind,
                      )?.[1] || "Foto"
                    }
                  />
                  <figcaption>
                    <span>
                      {photoKinds.find(
                        ([value]) => value === photo.kind,
                      )?.[1] || "Foto adicional"}
                    </span>
                    {!locked && (
                      <button
                        type="button"
                        className="icon-button danger"
                        aria-label="Excluir foto"
                        onClick={() => void removePhoto(photo.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <p className="muted">Nenhuma foto adicionada ainda.</p>
          )}
        </section>

        <section className="panel checklist-section">
          <div className="section-heading">
            <div>
              <h2>Mapa de avarias</h2>
              <p>Marque riscos, amassados, trincas e outras avarias.</p>
            </div>
          </div>

          {!locked && (
            <div className="damage-toolbar">
              <label>
                Tipo de avaria
                <select
                  value={damageType}
                  onChange={(e) =>
                    setDamageType(e.target.value as Damage["type"])
                  }
                >
                  {damageTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="damage-layout">
            <DamageMap
              damages={record.damages}
              disabled={locked}
              selectedType={damageType}
              onChange={(damages) => set("damages", damages)}
            />
            <div className="damage-list">
              {record.damages.map(
                (damage: Damage, index: number) => (
                  <div className="damage-entry" key={index}>
                    <b>{index + 1}</b>
                    <select
                      disabled={locked}
                      value={damage.type}
                      onChange={(e) =>
                        set(
                          "damages",
                          record.damages.map(
                            (item: Damage, i: number) =>
                              i === index
                                ? {
                                    ...item,
                                    type: e.target
                                      .value as Damage["type"],
                                  }
                                : item,
                          ),
                        )
                      }
                    >
                      {damageTypes.map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                    <input
                      disabled={locked}
                      value={damage.note}
                      placeholder="Descrição da avaria"
                      onChange={(e) =>
                        set(
                          "damages",
                          record.damages.map(
                            (item: Damage, i: number) =>
                              i === index
                                ? { ...item, note: e.target.value }
                                : item,
                          ),
                        )
                      }
                    />
                    {!locked && (
                      <button
                        type="button"
                        className="icon-button danger"
                        aria-label="Excluir avaria"
                        onClick={() =>
                          set(
                            "damages",
                            record.damages.filter(
                              (_: Damage, i: number) => i !== index,
                            ),
                          )
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                ),
              )}
              {!record.damages.length && (
                <p className="muted">
                  Nenhuma avaria marcada no mapa.
                </p>
              )}
            </div>
          </div>

          <Field label="Observações das avarias" full>
            <textarea
              disabled={locked}
              rows={3}
              value={record.damage_notes}
              onChange={(e) => set("damage_notes", e.target.value)}
            />
          </Field>
        </section>

        <section className="panel checklist-section">
          <div className="section-heading">
            <div>
              <h2>Ciência e assinatura</h2>
              <p>
                Registre a assinatura do cliente ou o motivo da ausência.
              </p>
            </div>
          </div>

          <label className="check-toggle customer-confirm">
            <input
              type="checkbox"
              disabled={locked}
              checked={!!record.customer_confirmed}
              onChange={(e) =>
                set("customer_confirmed", e.target.checked)
              }
            />
            <span>Cliente conferiu as condições registradas</span>
          </label>

          <SignaturePad
            value={record.signature_data}
            disabled={locked}
            onChange={(value) => set("signature_data", value)}
          />

          <Field label="Motivo da ausência da assinatura" full>
            <input
              disabled={locked}
              value={record.signature_absent_reason}
              placeholder="Preencha somente se o cliente não puder assinar"
              onChange={(e) =>
                set("signature_absent_reason", e.target.value)
              }
            />
          </Field>
        </section>

        {!locked && (
          <div className="checklist-final-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => void save()}
            >
              <Save size={17} />
              {busy ? "Salvando..." : "Salvar rascunho"}
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void finalize()}
            >
              <CheckCircle2 size={17} />
              Finalizar checklist
            </button>
          </div>
        )}
      </div>
    </>
  );
}
