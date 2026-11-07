import type { InputHTMLAttributes } from "react";

export function VehiclePlate({ value, compact = false }: { value?: string | null; compact?: boolean }) {
  const plate = (value || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!plate) return <span className="vehicle-plate-empty">Sem placa</span>;
  return (
    <span className={`vehicle-plate${compact ? " vehicle-plate-compact" : ""}`} role="img" aria-label={`Placa do veículo ${plate}`}>
      <span className="vehicle-plate-band" aria-hidden="true"><span>BRASIL</span><i /></span>
      <span className="vehicle-plate-number" aria-hidden="true">{plate}</span>
    </span>
  );
}

export function VehiclePlateInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className="vehicle-plate-input">
      <span className="vehicle-plate-band" aria-hidden="true"><span>BRASIL</span><i /></span>
      <input {...props} className={`vehicle-plate-number-input ${props.className || ""}`} aria-label={props["aria-label"] || "Placa do veículo"} />
    </span>
  );
}
