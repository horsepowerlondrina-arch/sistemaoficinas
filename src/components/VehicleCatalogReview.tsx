import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Entity } from "../lib/types";
import { Modal } from "./ui";

type ReviewItem = {
  vehicle: Entity;
  status: "linked" | "matched" | "confirmation" | "incomplete" | "plate_lookup" | "not_identified" | "unavailable";
  candidates: Entity[];
};
type ReviewPage = { items: ReviewItem[]; total: number; limit: number; offset: number; has_more: boolean; dry_run: true };
const labels: Record<ReviewItem["status"], string> = {
  linked: "Identificado e vinculado",
  matched: "Correspondência única disponível",
  confirmation: "Necessita confirmação de versão",
  incomplete: "Cadastro incompleto",
  plate_lookup: "Consulta de placa disponível",
  not_identified: "Não identificado",
  unavailable: "Catálogo indisponível para esta oficina",
};

export function VehicleCatalogReview({
  onClose,
  onReview,
}: {
  onClose: () => void;
  onReview: (vehicle: Entity) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<ReviewPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    api<ReviewPage>(`/vehicles/catalog-review?limit=20&offset=${offset}`)
      .then((result) => active && setPage(result))
      .catch((reason) => active && setError((reason as Error).message))
      .finally(() => active && setBusy(false));
    return () => { active = false; };
  }, [offset]);
  return (
    <Modal
      title="Revisar veículos do catálogo"
      description="Prévia paginada por oficina. A análise usa apenas os dados cadastrados; nenhuma placa é consultada automaticamente."
      onClose={onClose}
      wide
    >
      <div className="modal-body vehicle-catalog-review">
        <p className="muted">Registros: {page?.total ?? "—"}. As consultas externas são individuais e iniciadas no cadastro do veículo. Não há processamento em lote.</p>
        {error && <p className="error-box" role="alert">{error}</p>}
        {busy && <p role="status">Analisando página…</p>}
        {!busy && page?.items.map(({ vehicle, status, candidates }) => (
          <article className="vehicle-review-row" key={vehicle.id}>
            <div>
              <strong>{vehicle.plate} · {vehicle.brand} {vehicle.model}</strong>
              <p>{vehicle.customer_name || "Cliente"} · {vehicle.year || "Ano não informado"}</p>
              <span className={`badge ${status}`}>{labels[status]}</span>
              {candidates.length > 0 && (
                <p className="muted">Candidatos: {candidates.map((candidate) => candidate.name).join(" · ")}</p>
              )}
            </div>
            <button type="button" className="button" onClick={() => onReview(vehicle)}>
              Revisar cadastro
            </button>
          </article>
        ))}
        {!busy && page?.items.length === 0 && <p>Nenhum veículo nesta página.</p>}
        <div className="vehicle-review-pagination">
          <button type="button" className="button" disabled={busy || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 20))}>Anterior</button>
          <span>Página {Math.floor(offset / 20) + 1} de {Math.max(1, Math.ceil((page?.total || 0) / 20))}</span>
          <button type="button" className="button" disabled={busy || !page?.has_more} onClick={() => setOffset((value) => value + 20)}>Próxima</button>
        </div>
      </div>
    </Modal>
  );
}
