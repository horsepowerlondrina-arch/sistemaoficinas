import {
  normalizePricingRules,
  salePrice,
  thirdPartySalePrice,
  type PricingPolicy,
  type PricingRule,
} from "../../shared/pricing";
import { useUnsavedSettings } from "../lib/useUnsavedSettings";
import { NumericInput } from "../components/NumericInput";
import { useState } from "react";
import { useApp } from "../lib/context";
import { send } from "../lib/api";
import { Field, Submit } from "../components/ui";
import { money } from "../lib/types";

type Row = PricingRule & { from: number; key: string };
const editable = (rules: PricingRule[]): Row[] =>
  normalizePricingRules(rules).map((r) => ({ ...r, key: crypto.randomUUID() }));
const payload = (rows: Row[]) => rows.map(({ key, ...rule }) => rule);
function rangeError(rows: PricingRule[]) {
  try {
    normalizePricingRules(rows);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}
function ProfitTable({
  rows,
  setRows,
  thirdParty,
}: {
  rows: Row[];
  setRows: (rows: Row[]) => void;
  thirdParty?: boolean;
}) {
  const label = thirdParty ? "terceiros" : "peças";
  const change = (index: number, patch: Partial<Row>) =>
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const last = rows[rows.length - 1];
  const add = () => {
    const end = last.up_to ?? Math.min(last.from + 9999, 99999999);
    setRows([
      ...rows.slice(0, -1),
      { ...last, up_to: end },
      { ...last, key: crypto.randomUUID(), from: end + 1, up_to: null },
    ]);
  };
  const error = rangeError(rows);
  return (
    <>
      <p className="muted">Faixas de custo em reais, sem lacunas ou sobreposições.</p>
      <div className="pricing-ranges" aria-label={thirdParty ? "Faixas dos serviços de terceiros" : "Faixas de peças e produtos"}>
        {rows.map((r, i) => (
          <div className={thirdParty ? "pricing-range third-party" : "pricing-range"} key={r.key}>
            <Field label="Custo inicial (R$)">
              <NumericInput
                    aria-label={`Custo inicial de ${label} faixa ${i + 1}`}
                    type="number"
                    required
                    min="0"
                    max="1000000"
                    step="0.01"
                    value={r.from / 100}
                    onChange={(e) =>
                      change(i, {
                        from: Math.round(Number(e.target.value) * 100),
                      })
                    }
              />
            </Field>
            <div className="field"><span>Custo final (R$)</span>
              {r.up_to !== null && (
                    <NumericInput
                      aria-label={`Custo final de ${label} faixa ${i + 1}`}
                      type="number"
                      required
                      min="0"
                      max="1000000"
                      step="0.01"
                      value={r.up_to / 100}
                      onChange={(e) =>
                        change(i, {
                          up_to: Math.round(Number(e.target.value) * 100),
                        })
                      }
                    />
              )}
              {i === rows.length - 1 && (
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={r.up_to === null}
                        onChange={(e) =>
                          change(i, {
                            up_to: e.target.checked
                              ? null
                              : Math.min(r.from + 9999, 100000000),
                          })
                        }
                      />
                      Sem limite máximo de {label}
                    </label>
              )}
            </div>
            <Field label="Acréscimo (%)">
              <NumericInput
                    aria-label={`Lucro de ${label} faixa ${i + 1}`}
                    type="number"
                    required
                    min="0"
                    max="1000"
                    step="0.01"
                    value={r.markup_bps / 100}
                    onChange={(e) =>
                      change(i, {
                        markup_bps: Math.round(Number(e.target.value) * 100),
                      })
                    }
              />
            </Field>
            {!thirdParty && (
              <Field label="Ganho mínimo / un. (R$)">
                <NumericInput
                      aria-label={`Ganho mínimo de peças faixa ${i + 1}`}
                      type="number"
                      required
                      min="0"
                      max="1000000"
                      step="0.01"
                      value={r.minimum_profit / 100}
                      onChange={(e) =>
                        change(i, {
                          minimum_profit: Math.round(
                            Number(e.target.value) * 100,
                          ),
                        })
                      }
                />
              </Field>
            )}
            <button
                    type="button"
                    className="button small"
                    aria-label={`Excluir faixa ${i + 1} de ${label}`}
                    disabled={rows.length === 1}
                    onClick={() => setRows(rows.filter((_, n) => n !== i))}
            >Excluir</button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="button"
        disabled={rows.length >= 20 || (last.up_to ?? last.from) >= 100000000}
        onClick={add}
      >
        Adicionar faixa de {label}
      </button>
      {error && (
        <p role="alert" className="error-box">
          {thirdParty ? "Serviços de Terceiros" : "Peças e Produtos"}: {error}
        </p>
      )}

    </>
  );
}
export function PartsPricing() {
  const { data, refresh, notify } = useApp();
  const initial = data.parts_pricing!;
  const [rules, setRules] = useState(() => editable(initial.rules));
  const [serviceRules, setServiceRules] = useState(() =>
    editable(
      initial.service_rules ?? [
        {
          from: 0,
          up_to: null,
          markup_bps: initial.service_markup_bps ?? 3000,
          minimum_profit: 0,
        },
      ],
    ),
  );
  const [mode, setMode] = useState<PricingPolicy["mode"]>(
    initial.mode ?? "legacy",
  );
  const [activeSection, setActiveSection] = useState<"parts" | "third-party">("parts");
  const [rate, setRate] = useState(initial.rate_bps ?? 4000);
  const policy = {
    mode,
    rate_bps: rate,
    rules: payload(rules),
    service_rules: payload(serviceRules),
    service_markup_bps: initial.service_markup_bps ?? 3000,
  };
  const [savedPolicy, setSavedPolicy] = useState(() => JSON.stringify(policy));
  const dirty = JSON.stringify(policy) !== savedPolicy;
  useUnsavedSettings(dirty);
  const [cost, setCost] = useState(10000),
    [freight, setFreight] = useState(0),
    [serviceCost, setServiceCost] = useState(10000),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const base = cost + freight;
  let price = 0,
    servicePrice = 0,
    simulationError = "",
    serviceError = "";
  try {
    price = salePrice(base, policy);
  } catch (e) {
    simulationError = (e as Error).message;
  }
  try {
    servicePrice = thirdPartySalePrice(serviceCost, policy);
  } catch (e) {
    serviceError = (e as Error).message;
  }
  const invalid =
    rangeError(rules) ||
    rangeError(serviceRules) ||
    (mode === "margin" && rate >= 10000
      ? "A margem sobre a venda deve ser menor que 100%."
      : "");
  return (
    <form
      className="parts-pricing-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (invalid) {
          setError(invalid);
          return;
        }
        setBusy(true);
        setError("");
        try {
          await send("/parts-pricing", policy, "PUT");
          setSavedPolicy(JSON.stringify(policy));
          await refresh();
          notify("Política de preços de peças e terceiros salva.");
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="tabs settings-section-links" role="tablist" aria-label="Lucro de peças e terceiros">
        <button type="button" role="tab" id="pricing-parts-tab" aria-controls="pricing-parts-panel" aria-selected={activeSection === "parts"} className={activeSection === "parts" ? "active" : ""} onClick={() => setActiveSection("parts")}>Peças e produtos</button>
        <button type="button" role="tab" id="pricing-third-tab" aria-controls="pricing-third-panel" aria-selected={activeSection === "third-party"} className={activeSection === "third-party" ? "active" : ""} onClick={() => setActiveSection("third-party")}>Serviços de terceiros</button>
      </div>
      <fieldset disabled={busy} className="pricing-fields">
        {activeSection === "parts" ? <div id="pricing-parts-panel" role="tabpanel" aria-labelledby="pricing-parts-tab" className="pricing-content-grid">
          <section className="panel work-order-section">
            <h2>Regra de preço das peças</h2>
            <p className="muted">Escolha como o preço sugerido será calculado.</p>
            <Field label="Método de cálculo"><select value={mode} onChange={(e) => setMode(e.target.value as PricingPolicy["mode"])}>
              <option value="legacy">Faixas de custo e ganho mínimo</option>
              <option value="markup">Acréscimo sobre o custo</option>
              <option value="margin">Margem sobre a venda</option>
            </select></Field>
            {mode !== "legacy" && <Field label={mode === "margin" ? "Margem sobre a venda (%)" : "Acréscimo sobre o custo (%)"}>
              <NumericInput type="number" required min="0" max={mode === "margin" ? "99.99" : "1000"} step="0.01" value={rate / 100} onChange={(e) => setRate(Math.round(Number(e.target.value) * 100))}/>
            </Field>}
            {mode === "legacy" ? <><h3>Faixas de custo</h3><ProfitTable rows={rules} setRows={setRules}/></>
              : <p className="muted">As faixas continuam guardadas e reaparecem quando este método for selecionado.</p>}
          </section>
          <section className="panel work-order-section">
            <h2>Simular preço</h2><p className="muted">Confira o resultado antes de salvar.</p>
            <Field label="Custo da peça (R$)"><NumericInput type="number" min="0" step="0.01" value={cost / 100} onChange={(e) => setCost(Math.round(Number(e.target.value) * 100))}/></Field>
            <Field label="Frete por unidade (R$)"><NumericInput type="number" min="0" step="0.01" value={freight / 100} onChange={(e) => setFreight(Math.round(Number(e.target.value) * 100))}/></Field>
            {simulationError ? <p role="alert">{simulationError}</p> : <p className="pricing-simulation" data-testid="product-price-simulation">Preço sugerido <strong>{money(price)}</strong></p>}
            <p className="muted">A simulação não altera produtos cadastrados.</p>
          </section>
        </div> : <div id="pricing-third-panel" role="tabpanel" aria-labelledby="pricing-third-tab" className="pricing-content-grid">
          <section className="panel work-order-section">
            <h2>Lucro dos serviços de terceiros</h2>
            <p className="muted">Defina o acréscimo sugerido conforme o custo contratado.</p>
            <h3>Faixas de custo</h3>
            <ProfitTable rows={serviceRules} setRows={setServiceRules} thirdParty/>
          </section>
          <section className="panel work-order-section">
            <h2>Simular preço</h2><p className="muted">Confira o resultado antes de salvar.</p>
            <Field label="Custo do serviço (R$)"><NumericInput type="number" min="0" step="0.01" value={serviceCost / 100} onChange={(e) => setServiceCost(Math.round(Number(e.target.value) * 100))}/></Field>
            {serviceError ? <p role="alert">{serviceError}</p> : <p className="pricing-simulation" data-testid="service-price-simulation">Preço sugerido <strong>{money(servicePrice)}</strong></p>}
            <p className="muted">A simulação não altera serviços cadastrados.</p>
          </section>
        </div>}
        {error && <div role="alert" className="error-box">{error}</div>}
        <div className="pricing-save-footer"><p role="status">{dirty ? "Alterações não salvas." : "Política de preços salva."}</p><Submit busy={busy}>Salvar política de preços</Submit></div>
      </fieldset>
    </form>
  );
}
