import { useEffect, useMemo, useState } from "react";
import { send } from "../lib/api";
import type { FipeCandidate } from "../../shared/vehicleFipe";

type Option = { id: string; name: string; brand: string; fipe_code: string };
export function VehicleModelSelection({ vehicle, onChange, candidates = [] }: {
  vehicle: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  candidates?: FipeCandidate[];
}) {
  const [options, setOptions] = useState<Option[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const codes = useMemo(() => [...new Set([
    ...candidates.map((candidate) => candidate.codigoFipe).filter((code): code is string => !!code),
    ...(vehicle.fipe_code ? [String(vehicle.fipe_code)] : []),
  ])], [candidates, vehicle.fipe_code]);
  const codeKey = codes.join(",");
  useEffect(() => {
    if (!vehicle.brand || (!vehicle.model && !codes.length)) { setOptions([]); return; }
    let active = true;
    setBusy(true);
    send("/vehicles/model-options", { brand: vehicle.brand, model: vehicle.model || "", fipe_codes: codes }, "POST")
      .then((result: { options: Option[] }) => {
        if (!active) return;
        setOptions(result.options);
        setMessage("");
        if (result.options.length === 1 && !vehicle.service_model_id && codes.includes(result.options[0].fipe_code)) {
          const option = result.options[0];
          const candidate = candidates.find((item) => item.codigoFipe === option.fipe_code);
          onChange({ ...vehicle, brand: option.brand, model: option.name, fipe_model: option.name, fipe_code: option.fipe_code, model_year: candidate?.anoModelo || vehicle.model_year || null, fipe_year_id: candidate?.anoId || vehicle.fipe_year_id || "", fuel: candidate?.combustivel || vehicle.fuel || "", service_model_id: option.id, service_link_mode: "auto" });
        }
      })
      .catch(() => { if (active) { setOptions([]); setMessage("Não foi possível consultar os modelos. Você pode informar o modelo manualmente."); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [vehicle.brand, vehicle.model, codeKey]);
  const choose = (option: Option) => {
    const candidate = candidates.find((item) => item.codigoFipe === option.fipe_code);
    onChange({
      ...vehicle,
      brand: option.brand,
      model: option.name,
      fipe_model: option.name,
      fipe_code: option.fipe_code || vehicle.fipe_code || "",
      model_year: candidate?.anoModelo || vehicle.model_year || null,
      fipe_year_id: candidate?.anoId || vehicle.fipe_year_id || "",
      fuel: candidate?.combustivel || vehicle.fuel || "",
      service_model_id: option.id,
      service_link_mode: "manual",
    });
  };
  return <section className="vehicle-technical-association full">
    <h3>Escolha o modelo do veículo</h3>
    {busy && <p className="muted" role="status">Buscando modelos…</p>}
    {!busy && options.length > 0 && <div className="vehicle-model-options" role="group" aria-label="Modelos do veículo">
      {options.map((option) => <label className="checkbox-row" key={option.id}>
        <input type="radio" name="vehicle-model-option" checked={vehicle.service_model_id === option.id} onChange={() => choose(option)} />
        <span>{option.name}{option.fipe_code && <small> · FIPE {option.fipe_code}</small>}</span>
      </label>)}
    </div>}
    {!busy && !options.length && candidates.length > 0 && <div className="vehicle-model-options" role="group" aria-label="Versões do veículo">\n      <p className="muted">Selecione a versão do veículo:</p>\n      {candidates.filter((candidate) => !!candidate.codigoFipe).map((candidate) => <label className="checkbox-row" key={candidate.codigoFipe!}>\n        <input type="radio" name="vehicle-fipe-option" checked={vehicle.fipe_code === candidate.codigoFipe && !vehicle.service_model_id} onChange={() => onChange({ ...vehicle, model: candidate.modelo || vehicle.model, fipe_model: candidate.modelo || vehicle.model, fipe_code: candidate.codigoFipe, model_year: candidate.anoModelo || vehicle.model_year || null, fipe_year_id: candidate.anoId || "", fuel: candidate.combustivel || vehicle.fuel || "", service_model_id: null, service_link_mode: "none" })} />\n        <span>{candidate.modelo} · {candidate.anoModelo} · FIPE {candidate.codigoFipe}</span>\n      </label>)}\n    </div>}\n    {!busy && !options.length && !candidates.length && <p className="muted">Nenhuma opção correspondente. Informe o modelo no campo acima.</p>}
    {message && <p role="status" className="muted">{message}</p>}
  </section>;
}
