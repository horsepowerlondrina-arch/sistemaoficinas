import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { send } from "../lib/api";
import type { FipeCandidate } from "../../shared/vehicleFipe";
import { vehicleDisplayModel } from "../../shared/vehicleIdentity";

type Option = { id: string; name: string; brand: string; fipe_code: string };
type Choice = { key: string; name: string; detail: string; candidate?: FipeCandidate; option?: Option };
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function VehicleModelSelection({ vehicle, onChange, candidates = [] }: {
  vehicle: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  candidates?: FipeCandidate[];
}) {
  const [options, setOptions] = useState<Option[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(vehicleDisplayModel(vehicle));
  const [searchTouched, setSearchTouched] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const listId = useId();
  useEffect(() => { setSearch(vehicleDisplayModel(vehicle)); setSearchTouched(false); }, [vehicle.model, vehicle.fipe_model]);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  const codes = useMemo(() => [...new Set([
    ...candidates.map((candidate) => candidate.codigoFipe).filter((code): code is string => !!code),
    ...(vehicle.fipe_code ? [String(vehicle.fipe_code)] : []),
  ])], [candidates, vehicle.fipe_code]);
  const codeKey = codes.join(",");
  useEffect(() => {
    if (!vehicle.brand || (!search && !codes.length)) { setOptions([]); return; }
    let active = true;
    setBusy(true);
    send("/vehicles/model-options", { brand: vehicle.brand, model: vehicle.model || "", search: searchTouched ? search : "", selected_model_id: vehicle.service_model_id || null, fipe_codes: codes }, "POST")
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
  }, [vehicle.brand, vehicle.model, codeKey, search, searchTouched]);
  const matches = candidates.filter((candidate) => !!candidate.modelo && (!searchTouched || !search || normalize(candidate.modelo).includes(normalize(search)) || String(candidate.codigoFipe || "").includes(search)));
  const chooseCandidate = (candidate: FipeCandidate, option?: Option) => {
    setOpen(false);
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
    setOpen(false);
    onChange({ ...vehicle, brand: option.brand, model: option.name.slice(0, 150), fipe_model: "", fipe_code: vehicle.fipe_code || option.fipe_code || "", service_model_id: option.id, service_link_mode: "manual" });
  };
  const useManual = () => {
    const model = search.trim();
    if (!model) return;
    setOpen(false);
    onChange({ ...vehicle, model: model.slice(0, 150), fipe_model: "", fipe_code: "", fipe_year_id: "", service_model_id: null, service_link_mode: "none" });
  };
  const choices: Choice[] = candidates.length
    ? matches.flatMap((candidate, index) => {
        const linked = options.filter((option) => option.fipe_code && option.fipe_code === candidate.codigoFipe);
        return (linked.length ? linked : [undefined]).map((option) => ({
          key: `${candidate.codigoFipe}-${candidate.anoId}-${index}-${option?.id || "manual"}`,
          name: String(candidate.modelo || ""),
          detail: `${candidate.anoModelo || ""} · FIPE ${candidate.codigoFipe || ""}${linked.length > 1 ? ` · ${option?.name}` : ""}`,
          candidate,
          option,
        }));
      })
    : options.map((option) => ({ key: option.id, name: option.name, detail: option.fipe_code ? `FIPE ${option.fipe_code}` : "", option }));
  const manualAvailable = !busy && !choices.length && !options.length && !!search.trim() && search.trim() !== vehicle.model;
  const choose = (choice: Choice) => {
    if (choice.candidate) chooseCandidate(choice.candidate, choice.option);
    else if (choice.option) chooseOption(choice.option);
    setActiveIndex(0);
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") { setOpen(false); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => choices.length ? (!open ? (event.key === "ArrowDown" ? 0 : choices.length - 1) : (index + (event.key === "ArrowDown" ? 1 : choices.length - 1)) % choices.length) : 0);
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      if (choices[activeIndex]) choose(choices[activeIndex]);
      else if (manualAvailable) useManual();
    }
  };
  return <section ref={rootRef} className="vehicle-technical-association full">
    <label className="field"><span>Modelo *</span><input required type="search" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" value={search} onFocus={() => { setOpen(true); setActiveIndex(0); }} onChange={(event) => { setSearchTouched(true); setSearch(event.target.value); setOpen(true); setActiveIndex(0); }} onKeyDown={keyDown} placeholder="Digite ou escolha o modelo do veículo..." maxLength={150} /></label>
    {open && <div className="catalog-dropdown" style={{ position: "relative", inset: "auto", width: "100%", marginTop: 4, zIndex: 2 }}>
      <div className="catalog-dropdown-list" style={{ maxHeight: 240 }}>
        <div id={listId} role="listbox" aria-label="Modelos do veículo">
          {choices.map((choice, index) => <button type="button" role="option" aria-selected={index === activeIndex} className="catalog-dropdown-option" key={choice.key} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(choice)}><strong>{choice.name}</strong><small>{choice.detail}</small></button>)}
          {busy && <p className="catalog-dropdown-empty" role="status">Buscando modelos…</p>}
          {manualAvailable && <button type="button" className="catalog-dropdown-option" onClick={useManual}><strong>Usar modelo informado</strong><small>{search.trim()}</small></button>}
          {!busy && !choices.length && !manualAvailable && <p className="catalog-dropdown-empty">Nenhum modelo encontrado.</p>}
        </div>
      </div>
    </div>}
    {message && <p role="status" className="muted">{message}</p>}
  </section>;
}
