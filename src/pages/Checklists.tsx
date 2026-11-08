import { VehiclePlate } from "../components/VehiclePlate";
import { useEffect, useMemo, useState } from "react";
import { Camera, ClipboardCheck, Plus } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { dateLabel, type Entity } from "../lib/types";
import { Empty, PageHeading, SearchBox } from "../components/ui";

export function Checklists() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const orderId = params.get("order") || "";
  const initialSearch = params.get("q") || "";
  const [rows, setRows] = useState<Entity[]>([]);
  const [search, setSearch] = useState(initialSearch);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    api<Entity[]>("/checklists")
      .then(setRows)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (orderId && row.order_id !== orderId) return false;
        const haystack =
          `${row.plate} ${row.customer_name} ${row.vehicle_label} ${row.order_number || ""} ${row.inspector}`.toLowerCase();
        return haystack.includes(search.toLowerCase());
      }),
    [rows, search, orderId],
  );

  return (
    <>
      <PageHeading
        eyebrow="ENTRADA DO VEÍCULO"
        title="Checklists"
        description="Comece pela placa, registre a entrada e deixe o sistema abrir uma OS no status Orçamento ao finalizar."
        actions={
          <button
            className="button primary"
            onClick={() =>
              navigate(
                `/checklists/novo${orderId ? `?order=${encodeURIComponent(orderId)}` : ""}`,
              )
            }
          >
            <Plus size={18} />
            Novo checklist
          </button>
        }
      />
      {error && <div className="error-box">{error}</div>}
      <section className="panel">
        <div className="table-toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar placa, cliente, veículo ou OS..."
          />
        </div>
        {loading ? (
          <div className="checklist-loading">Carregando checklists...</div>
        ) : filtered.length ? (
          <div className="checklist-cards">
            {filtered.map((row) => (
              <button
                type="button"
                className="checklist-card"
                key={row.id}
                onClick={() => navigate(`/checklists/${row.id}`)}
              >
                <div className="checklist-card-icon">
                  <ClipboardCheck size={22} />
                </div>
                <div className="checklist-card-main">
                  <VehiclePlate value={row.plate} compact />
                  <span>{row.vehicle_label || "Veículo"}</span>
                  <small>
                    {row.customer_name}
                    {row.order_number
                      ? ` · OS #${row.order_number}`
                      : ""}
                  </small>
                </div>
                <div className="checklist-card-meta">
                  <span className={`checklist-status ${row.status}`}>
                    {row.status === "completed" ? "Finalizado" : "Rascunho"}
                  </span>
                  <small>{dateLabel(row.created_at)}</small>
                  <small className="checklist-photo-count">
                    <Camera size={13} /> {row.photo_count || 0}
                  </small>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <Empty
            title="Nenhum checklist encontrado"
            description={
              orderId
                ? "Ainda não existe checklist vinculado a esta OS."
                : "Crie o primeiro checklist de entrada do veículo."
            }
            action={
              <button
                className="button"
                onClick={() =>
                  navigate(
                    `/checklists/novo${orderId ? `?order=${encodeURIComponent(orderId)}` : ""}`,
                  )
                }
              >
                <Plus size={16} />
                Novo checklist
              </button>
            }
          />
        )}
      </section>
    </>
  );
}
