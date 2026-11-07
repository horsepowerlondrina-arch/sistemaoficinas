import { VehiclePlate } from "./VehiclePlate";
import { DocumentTerms } from "./DocumentTerms";
import type { Entity } from "../lib/types";
import { DocumentHeader } from "./DocumentHeader";

const conditionLabels: Record<string, string> = {
  ok: "OK",
  issue: "Avaria",
  unchecked: "Não verificado",
};
const photoLabels: Record<string, string> = {
  front: "Frente",
  rear: "Traseira",
  left: "Lateral esquerda",
  right: "Lateral direita",
  dashboard: "Painel / quilometragem",
  damage: "Avaria / adicional",
  other: "Foto adicional",
};

export function ChecklistPrint({
  checklist,
  tenant,
}: {
  checklist: Entity;
  tenant: Entity;
}) {
  const conditions = checklist.conditions || {};
  const panel = checklist.panel_lights || {};
  const damages = checklist.damages || [];
  const photos = checklist.photos || [];
  return (
    <section className="print-only workshop-document checklist-print">
      <DocumentHeader shop={tenant} />
      <div className="hp-print-titlebar"><strong>CHECKLIST DE ENTRADA</strong><span>{checklist.order_number ? `OS #${checklist.order_number}` : ""}</span></div>

      <div className="checklist-print-grid">
        <div><b>Cliente:</b> {checklist.customer_name}</div>
        <div><b>Telefone:</b> {checklist.phone || "—"}</div>
        <div><b>Veículo:</b> {checklist.vehicle_label}</div>
        <div className="document-plate"><b>Placa:</b> <VehiclePlate value={checklist.plate} compact /></div>
        <div>
          <b>OS:</b>{" "}
          {checklist.order_number ? `#${checklist.order_number}` : "—"}
        </div>
        <div><b>KM:</b> {Number(checklist.km || 0).toLocaleString("pt-BR")}</div>
        <div><b>Combustível:</b> {checklist.fuel_level}%</div>
        <div><b>Responsável:</b> {checklist.inspector}</div>
      </div>

      <section>
        <h2>Reclamação do cliente</h2>
        <p>{checklist.complaint || "Não informada."}</p>
      </section>

      <section>
        <h2>Itens e acessórios</h2>
        <div className="checklist-print-conditions">
          {Object.entries(conditions).map(([name, value]) => (
            <div key={name}>
              <span>{name}</span>
              <b>{conditionLabels[String(value)] || String(value)}</b>
            </div>
          ))}
        </div>
        {checklist.accessories_notes && (
          <p><b>Observações:</b> {checklist.accessories_notes}</p>
        )}
      </section>

      <section>
        <h2>Painel / funcionamento</h2>
        <p>
          <b>Luzes observadas:</b>{" "}
          {Object.entries(panel)
            .filter(([, active]) => active)
            .map(([name]) => name)
            .join(", ") || "Nenhuma"}
        </p>
        {checklist.panel_notes && <p><b>Painel:</b> {checklist.panel_notes}</p>}
        {checklist.functioning_notes && (
          <p><b>Funcionamento:</b> {checklist.functioning_notes}</p>
        )}
        {checklist.objects_left && (
          <p><b>Objetos deixados no veículo:</b> {checklist.objects_left}</p>
        )}
      </section>

      <section>
        <h2>Avarias registradas</h2>
        {damages.length ? (
          <ol>
            {damages.map((damage: Entity, index: number) => (
              <li key={index}>
                <b>{damage.type}</b>
                {damage.note ? ` — ${damage.note}` : ""}
              </li>
            ))}
          </ol>
        ) : (
          <p>Nenhuma avaria marcada no mapa.</p>
        )}
        {checklist.damage_notes && (
          <p><b>Observações:</b> {checklist.damage_notes}</p>
        )}
      </section>

      {photos.length > 0 && (
        <section className="checklist-print-photos-section">
          <h2>Fotos de entrada</h2>
          <div className="checklist-print-photos">
            {photos.map((photo: Entity) => (
              <figure key={photo.id}>
                <img
                  src={photo.image_url || `/api/checklist-photos/${photo.id}`}
                  alt={photoLabels[photo.kind] || "Foto"}
                />
                <figcaption>
                  {photoLabels[photo.kind] || "Foto adicional"}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      <section className="checklist-print-signature">
        <h2>Ciência do cliente</h2>
        <p>
          {checklist.customer_confirmed
            ? "Cliente conferiu as condições registradas."
            : "Conferência do cliente não marcada."}
        </p>
        {checklist.signature_data ? (
          <img src={checklist.signature_data} alt="Assinatura do cliente" />
        ) : (
          <p>
            <b>Assinatura não registrada:</b>{" "}
            {checklist.signature_absent_reason || "—"}
          </p>
        )}
      </section>
      <DocumentTerms shop={tenant} />
    </section>
  );
}
