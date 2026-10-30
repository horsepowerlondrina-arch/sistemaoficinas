import { Field } from "./ui";
import { NumericInput } from "./NumericInput";
import { vehicleDisplayModel, vehicleModelYear } from "../../shared/vehicleIdentity";

type Vehicle = Record<string, any>;
export function VehicleIdentityFields({ vehicle, onChange, disabled = false, required = true, km, onKmChange }: {
  vehicle: Vehicle;
  onChange: (next: Vehicle) => void;
  disabled?: boolean;
  required?: boolean;
  km?: number;
  onKmChange?: (next: number) => void;
}) {
  const set = (field: string, value: unknown) => onChange({ ...vehicle, [field]: value });
  return <div className="vehicle-identity-fields full">
    <Field label={`Marca${required ? " *" : ""}`}><input required={required} disabled={disabled} maxLength={150} value={vehicle.brand || ""} onChange={(event) => set("brand", event.target.value)} /></Field>
    <Field label={`Modelo FIPE${required ? " *" : ""}`}><input required={required} disabled={disabled} maxLength={300} value={vehicleDisplayModel(vehicle)} onChange={(event) => onChange({ ...vehicle, fipe_model: event.target.value, model: event.target.value.slice(0, 150), fipe_code: "", fipe_year_id: "" })} /></Field>
    <Field label="Código FIPE"><input disabled={disabled} maxLength={8} value={vehicle.fipe_code || ""} placeholder="Não identificado" onChange={(event) => set("fipe_code", event.target.value)} /></Field>
    <Field label={`Ano de fabricação${required ? " *" : ""}`}><NumericInput required={required} disabled={disabled} type="number" min={1900} max={2100} value={vehicle.year || ""} onChange={(event) => set("year", event.target.value ? Number(event.target.value) : null)} /></Field>
    <Field label="Ano do modelo"><NumericInput disabled={disabled} type="number" min={1900} max={2100} value={vehicleModelYear(vehicle) || ""} onChange={(event) => set("model_year", event.target.value ? Number(event.target.value) : null)} /></Field>
    <Field label="Combustível"><input disabled={disabled} maxLength={80} value={vehicle.fuel || ""} onChange={(event) => set("fuel", event.target.value)} /></Field>
    <Field label="Cor"><input disabled={disabled} maxLength={80} value={vehicle.color || ""} onChange={(event) => set("color", event.target.value)} /></Field>
    <Field label="Chassi"><input disabled={disabled} maxLength={100} value={vehicle.chassis || ""} onChange={(event) => set("chassis", event.target.value)} /></Field>
    {onKmChange && <Field label="Quilometragem"><NumericInput type="number" min={0} value={km || 0} onChange={(event) => onKmChange(Math.max(0, Number(event.target.value)))} /></Field>}
  </div>;
}
