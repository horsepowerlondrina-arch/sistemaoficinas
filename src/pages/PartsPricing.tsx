import { salePrice, type PricingPolicy } from "../../shared/pricing";
import { useUnsavedSettings } from "../lib/useUnsavedSettings";
import { NumericInput } from "../components/NumericInput";
import { useState } from "react";
import { useApp } from "../lib/context";
import { send } from "../lib/api";
import { Field, Submit } from "../components/ui";
import { money } from "../lib/types";
export function PartsPricing() {
  const { data, refresh, notify } = useApp();
  const [serviceMarkup, setServiceMarkup] = useState(
    data.parts_pricing?.service_markup_bps ?? 3000,
  );
  const [rules, setRules] = useState(() =>
    data.parts_pricing!.rules.map((r) => ({ ...r })),
  );
  const [mode,setMode] = useState<PricingPolicy["mode"]>(data.parts_pricing?.mode ?? "legacy");
  const [rate,setRate] = useState(data.parts_pricing?.rate_bps ?? 4000);
  const policy = {mode,rate_bps:rate,rules,service_markup_bps:serviceMarkup};
  const [savedPolicy,setSavedPolicy] = useState(() => JSON.stringify(policy));
  const dirty = JSON.stringify(policy) !== savedPolicy;
  useUnsavedSettings(dirty);
  const [cost, setCost] = useState(10000),
    [freight, setFreight] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const base = cost + freight;
  let price = 0, simulationError = "";
  try { price = salePrice(base, policy); } catch (e) { simulationError = (e as Error).message; }
  return (
    <form
      className="panel work-order-section"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await send(
            "/parts-pricing",
            {
              mode,
              rate_bps: rate,
              rules,
              service_markup_bps: serviceMarkup,
            },
            "PUT",
          );
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
      <h2>Lucro das peças</h2>
      <p className="muted">
        A base é o custo unitário mais o frete por unidade. No modo por faixas, a venda usa o maior
        valor entre o acréscimo da faixa e o ganho mínimo. Nos demais modos, usa o percentual selecionado. A regra vale para
        novas importações do Sky e ao confirmar custo ou frete nos cadastros.
        Você pode ajustar o preço de venda manualmente após o cálculo.
      </p>
      <Field label="Regra de preço das peças"><select value={mode} disabled={busy} onChange={e=>setMode(e.target.value as PricingPolicy["mode"])}><option value="legacy">Faixas de custo e ganho mínimo</option><option value="markup">Acréscimo sobre o custo</option><option value="margin">Margem sobre a venda</option></select></Field>
      {mode !== "legacy" && <Field label={mode === "margin" ? "Margem sobre a venda (%)" : "Acréscimo sobre o custo (%)"}><NumericInput type="number" required min="0" max={mode === "margin" ? "99.99" : "1000"} step="0.01" value={rate/100} onChange={e=>setRate(Math.round(Number(e.target.value)*100))}/></Field>}
      {mode === "legacy" && <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Custo com frete até (R$)</th>
              <th>Acréscimo (%)</th>
              <th>Ganho mínimo / un. (R$)</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => (
              <tr key={i}>
                <td>
                  {r.up_to === null ? (
                    "Acima da última faixa"
                  ) : (
                    <NumericInput
                      aria-label={`Limite da faixa ${i + 1}`}
                      type="number"
                      required
                      min="0.01"
                      step="0.01"
                      value={r.up_to / 100}
                      onChange={(e) =>
                        setRules((v) =>
                          v.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  up_to: Math.round(
                                    Number(e.target.value) * 100,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  )}
                </td>
                <td>
                  <NumericInput
                    aria-label={`Acréscimo da faixa ${i + 1}`}
                    type="number"
                    required
                    min="0"
                    max="1000"
                    step="0.01"
                    value={r.markup_bps / 100}
                    onChange={(e) =>
                      setRules((v) =>
                        v.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                markup_bps: Math.round(
                                  Number(e.target.value) * 100,
                                ),
                              }
                            : x,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <NumericInput
                    aria-label={`Ganho mínimo da faixa ${i + 1}`}
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={r.minimum_profit / 100}
                    onChange={(e) =>
                      setRules((v) =>
                        v.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                minimum_profit: Math.round(
                                  Number(e.target.value) * 100,
                                ),
                              }
                            : x,
                        ),
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      }
      <h3>Serviços de terceiros</h3>
      <p className="muted">
        Ao confirmar o custo de um serviço, o preço de venda será o custo mais
        este percentual. Custos e preços dos atendimentos anteriores são
        preservados.
      </p>
      <Field label="Acréscimo sobre o custo de terceiros (%)">
        <NumericInput
          type="number"
          required
          min="0"
          max="1000"
          step="0.01"
          value={serviceMarkup / 100}
          onChange={(e) =>
            setServiceMarkup(Math.round(Number(e.target.value) * 100))
          }
        />
      </Field>
      <p className="muted">
        Exemplo: custo de R$ 100,00 → venda de{" "}
        {money(Math.round((10000 * (10000 + serviceMarkup)) / 10000))}.
      </p>
      <h3>Simular uma peça</h3>
      <div className="form-grid">
        <Field label="Custo sem frete (R$)">
          <NumericInput
            type="number"
            min="0"
            step="0.01"
            value={cost / 100}
            onChange={(e) => setCost(Math.round(Number(e.target.value) * 100))}
          />
        </Field>
        <Field label="Frete por unidade (R$)">
          <NumericInput
            type="number"
            min="0"
            step="0.01"
            value={freight / 100}
            onChange={(e) =>
              setFreight(Math.round(Number(e.target.value) * 100))
            }
          />
        </Field>
      </div>
      {simulationError && <p role="alert">{simulationError}</p>}
      <p>
        Base: <strong>{money(base)}</strong> · Venda:{" "}
        <strong>{money(price)}</strong> · Ganho bruto:{" "}
        <strong>{money(price - base)}</strong>
      </p>
      <p className="muted">
        OS já lançadas preservam seus valores. Ganho bruto não
        desconta taxas de cartão nem despesas da oficina.
      </p>
      {error && (
        <div role="alert" className="error-box">
          {error}
        </div>
      )}
      {dirty && <p role="status">Alterações não salvas.</p>}
      <Submit busy={busy}>Salvar política de preços</Submit>
    </form>
  );
}
