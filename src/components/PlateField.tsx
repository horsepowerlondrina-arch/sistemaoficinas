import { useEffect, useRef, useState } from "react";
import { Search, LoaderCircle } from "lucide-react";
import { send } from "../lib/api";
import { Field } from "./ui";
import type { Entity } from "../lib/types";
import { candidateFields, type FipeCandidate } from "../../shared/vehicleFipe";
type Lookup = {
  source: string;
  vehicle: Entity | null;
  message: string;
  fipe_candidates?: FipeCandidate[];
  selectionOnly?: boolean;
};
export function PlateField({
  value,
  onChange,
  onFound,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onFound: (result: Lookup) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [result, setResult] = useState<Lookup | null>(null);
  const [selected, setSelected] = useState("");
  const request = useRef(0),
    last = useRef("");
  useEffect(() => {
    request.current++;
    last.current = "";
    setBusy(false);
    setMessage("");
    setResult(null);
    setSelected("");
    return () => {
      request.current++;
    };
  }, [value, disabled]);
  const lookup = async (force = false) => {
    const plate = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(plate)) {
      setMessage("Informe uma placa completa para consultar.");
      return;
    }
    if (!force && last.current === plate) return;
    last.current = plate;
    const seq = ++request.current;
    setBusy(true);
    setMessage("");
    try {
      const result: Lookup = await send("/vehicles/lookup", { plate });
      if (seq !== request.current) return;
      setMessage(result.message);
      setResult(result);
      const index = result.fipe_candidates?.findIndex(
        (candidate) =>
          candidate.codigoFipe === result.vehicle?.fipe_code &&
          !!candidate.codigoFipe,
      );
      setSelected(index !== undefined && index >= 0 ? String(index) : "");
      onFound(result);
    } catch (e) {
      if (seq === request.current) {
        setMessage((e as Error).message);
        last.current = "";
      }
    } finally {
      if (seq === request.current) setBusy(false);
    }
  };
  return (
    <div className="plate-lookup full">
      <div className="plate-lookup-row">
        <Field label="Placa">
          <input
            maxLength={8}
            placeholder="ABC1D23"
            disabled={disabled}
            value={value}
            onChange={(e) => {
              request.current++;
              setBusy(false);
              setMessage("");
              last.current = "";
              setResult(null);
              setSelected("");
              onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
            }}
          />
        </Field>
        <button
          type="button"
          className="button"
          disabled={disabled || busy || value.length !== 7}
          onClick={() => void lookup(true)}
        >
          {busy ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Search size={17} />
          )}
          Consultar placa
        </button>
      </div>
      {message && (
        <p className="lookup-message" role="status">
          {message}
        </p>
      )}
      {!!result?.fipe_candidates?.length && (
        <Field label="Identificação FIPE" full>
          <select
            disabled={disabled || busy}
            value={selected}
            onChange={(event) => {
              const vehicle = result.vehicle;
              if (!vehicle) return;
              const index = event.target.value;
              setSelected(index);
              const candidate =
                index === ""
                  ? undefined
                  : result.fipe_candidates?.[Number(index)];
              onFound({
                ...result,
                selectionOnly: true,
                vehicle: { ...vehicle, ...candidateFields(candidate) },
              });
            }}
          >
            <option value="">
              Não identificado — selecione a versão para confirmar
            </option>
            {result.fipe_candidates.map((candidate, index) => (
              <option
                key={index}
                value={String(index)}
                disabled={!candidate.codigoFipe}
              >
                {[
                  candidate.modelo,
                  candidate.anoModelo,
                  candidate.combustivel,
                  candidate.codigoFipe || "Sem código FIPE",
                  candidate.matchAno === false ? "Ano divergente" : "",
                  candidate.confianca && candidate.confianca !== "alta" ? `Confiança ${candidate.confianca}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </option>
            ))}
          </select>
          <small>
            O código será salvo no cadastro. Quando houver mais de uma versão,
            confirme a correta.
          </small>
        </Field>
      )}
    </div>
  );
}
