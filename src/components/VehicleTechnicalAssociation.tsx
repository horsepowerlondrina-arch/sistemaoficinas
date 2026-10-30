import { useEffect, useState } from "react";
import { api, send } from "../lib/api";
import { RepairServicePicker } from "./RepairServicePicker";

export function VehicleTechnicalAssociation({ vehicle, modelId, onModelChange }: {
  vehicle: Record<string, any>;
  modelId: string;
  onModelChange: (id: string) => void;
}) {
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    if (!modelId) { setSummary(""); return; }
    api<{ name: string; brand: string }>(`/repair-services/models/${modelId}`).then((model) => {
      if (active) setSummary(`${model.brand} · ${model.name}`);
    }).catch(() => { if (active) setSummary("Vínculo técnico existente"); });
    return () => { active = false; };
  }, [modelId]);
  const identify = async () => {
    setBusy(true); setMessage("");
    try {
      const result = await send("/repair-services/identify-model", { vehicle: { ...vehicle, service_model_id: "" } }, "POST");
      if (result.status === "matched" && result.model?.id) {
        onModelChange(String(result.model.id));
        setMessage("Correspondência única associada. Salve o cadastro para confirmar.");
      } else setMessage("Sem correspondência única e confiável. Pesquise e escolha manualmente, se desejar.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="vehicle-technical-association full">
    <details>
      <summary>Associação ao Catálogo Técnico</summary>
      <p className="muted">O modelo técnico é opcional e independente da identificação FIPE.</p>
      <div className="capture-actions">
        <button type="button" className="button" disabled={busy} onClick={() => void identify()}>{busy ? "Pesquisando…" : "Associação automática"}</button>
        <button type="button" className="button" onClick={() => { onModelChange(""); setMessage("Veículo sem associação técnica. Salve para confirmar."); }}>Sem associação</button>
      </div>
      {message && <p role="status" className="muted">{message}</p>}
      <RepairServicePicker vehicle={vehicle} modelId={modelId} onModelChange={onModelChange} vehicleOnly autoIdentify={false} />
    </details>
    {modelId && <small className="muted">Vínculo atual: {summary || "Carregando…"}</small>}
  </section>;
}
