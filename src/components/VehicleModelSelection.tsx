import { useEffect, useMemo, useState } from "react";
import { send } from "../lib/api";
import type { FipeCandidate } from "../../shared/vehicleFipe";

type Option = { id: string; name: string; brand: string; fipe_code: string };
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function VehicleModelSelection({ vehicle, onChange, candidates = [] }: {
  vehicle: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  candidates?: FipeCandidate[];
}) {
  const [options, setOptions] = useState<Option[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(String(vehicle.model || ""));
  useEffect(() => { setSearch(String(vehicle.model || "")); }, [vehicle.model]);
  const codes = useMemo(() => [...new Set([
    ...candidates.map((candidate) => candidate.codigoFipe).filter((code): code is string => !!code),
    ...(vehicle.fipe_code ? [String(vehicle.fipe_code)] : []),
  ])], [candidates, vehicle.fipe_code]);
  const codeKey = codes.join(",");
  useEffect(() => {
    if (!vehicle.brand || (!search && !codes.length)) { setOptions([]); return; }
    let active = true;
    setBusy(true);
    send("/vehicles/model-options", { brand: vehicle.brand, model: vehicle.model || "", search, selected_model_id: vehicle.service_model_id || null, fipe_codes: codes }, "POST")
      .then((result: { options: Option[] }) => {
        if (!active) return;
        setOptions(result.options);
        setMessage("");
        if (candidates.length === 1 && result.options.length === 1 && !vehicle.service_model_id && candidates[0].codigoFipe === result.options[0].fipe_code) {
          const candidate = candidates[0];
          const option = result.options[0];
          onChange({ ...vehicle, brand: option.brand, model: String(candidate.modelo || option.name).slice(0, 150), fipe_model: candidate.modelo || "", fipe_code: candidate.codigoFipe || "", model_year: candidate.anoModelo || vehicle.model_year || null, fipe_year_id: candidate.anoId || "", fuel: candidate.combustivel || vehicle.fuel || "", service_model_id: option.id, service_link_mode: "auto" });
        }
      })
      .catch(() => { if (active) { setOptions([]); setMessage("Não foi possível consultar os modelos. Você pode informar o modelo manualmente."); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [vehicle.brand, vehicle.model, codeKey, search]);
  const matches = candidates.filter((candidate) => !!candidate.modelo && (!search || normalize(candidate.modelo).includes(normalize(search)) || String(candidate.codigoFipe || "").includes(search)));
  const chooseCandidate = (candidate: FipeCandidate, option?: Option) => {
    onChange({
      ...vehicle,
      brand: option?.brand || vehicle.brand,
      model: String(candidate.modelo || vehicle.model).slice(0, 150),
      fipe_model: candidate.modelo || "",
      fipe_code: candidate.codigoFipe || "",
      model_year: candidate.anoModelo || vehicle.model_year || null,
      fipe_year_id: candidate.anoId || "",
      fuel: candidate.combustivel || vehicle.fuel || "",
      service_model_id: option?.id || null,
      service_link_mode: option ? "manual" : "none",
    });
  };
  const chooseOption = (option: Option) => {
    onChange({ ...vehicle, brand: option.brand, model: option.name.slice(0, 150), fipe_model: "", fipe_code: vehicle.fipe_code || option.fipe_code || "", service_model_id: option.id, service_link_mode: "manual" });
  };
  const useManual = () => {
    const model = search.trim();
    if (!model) return;
    onChange({ ...vehicle, model: model.slice(0, 150), fipe_model: "", fipe_code: "", fipe_year_id: "", service_model_id: null, service_link_mode: "none" });
  };
  return <section className="vehicle-technical-association full">
    <label className="field"><span>Modelo *</span><input required type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Digite ou escolha o modelo do veículo..." maxLength={150} /></label>
    {busy && <p className="muted" role="status">Buscando modelos…</p>}
    {!busy && matches.length > 0 && <div className="vehicle-model-options" role="group" aria-label="Versões do veículo">
      {matches.flatMap((candidate, index) => {
        const linked = options.filter((option) => option.fipe_code && option.fipe_code === candidate.codigoFipe);
        return (linked.length ? linked : [undefined]).map((option) => <label className="checkbox-row" key={`${candidate.codigoFipe}-${candidate.anoId}-${index}-${option?.id || "manual"}`}>
          <input type="radio" name="vehicle-model-option" checked={vehicle.model === candidate.modelo && vehicle.fipe_code === candidate.codigoFipe && (vehicle.service_model_id || null) === (option?.id || null)} onChange={() => chooseCandidate(candidate, option)} />
          <span>{candidate.modelo} · {candidate.anoModelo} · FIPE {candidate.codigoFipe}{linked.length > 1 && <small> · {option?.name}</small>}</span>
        </label>);
      })}
    </div>}
    {!busy && !candidates.length && options.length > 0 && <div className="vehicle-model-options" role="group" aria-label="Modelos do veículo">
      {options.map((option) => <label className="checkbox-row" key={option.id}>
        <input type="radio" name="vehicle-model-option" checked={vehicle.service_model_id === option.id} onChange={() => chooseOption(option)} />
        <span>{option.name}{option.fipe_code && <small> · FIPE {option.fipe_code}</small>}</span>
      </label>)}
    </div>}
    {search.trim() && search.trim() !== vehicle.model && <button type="button" className="btn secondary" onClick={useManual}>Usar modelo informado</button>}
    {vehicle.model && <p className="muted" role="status">Modelo selecionado: {vehicle.model}</p>}
    {message && <p role="status" className="muted">{message}</p>}
  </section>;
}
