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
      <p className="muted">
        Custos inicial e final são inclusivos. A primeira faixa começa em R$
        0,00; a seguinte começa um centavo após o fim da anterior.
      </p>
      <div className="table-scroll">
        <table
          aria-label={
            thirdParty
              ? "Tabela de Serviços de Terceiros"
              : "Tabela de Peças e Produtos"
          }
        >
          <thead>
            <tr>
              <th>Custo inicial (R$)</th>
              <th>Custo final (R$)</th>
              <th>Lucro — acréscimo (%)</th>
              {!thirdParty && <th>Ganho mínimo / un. (R$)</th>}
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td>
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
                </td>
                <td>
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
                </td>
                <td>
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
                </td>
                {!thirdParty && (
                  <td>
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
                  </td>
                )}
                <td>
                  <button
                    type="button"
                    className="button small"
                    aria-label={`Excluir faixa ${i + 1} de ${label}`}
                    disabled={rows.length === 1}
                    onClick={() => setRows(rows.filter((_, n) => n !== i))}
                  >
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
      <p className="muted">
        Mantenha ao menos uma faixa. Ao excluir uma linha, revise os limites
        para evitar lacunas. Sem uma faixa correspondente, o cálculo será
        bloqueado.
      </p>
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
      className="panel work-order-section"
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
      <fieldset disabled={busy} className="product-batch-fields">
        <h2>Peças e Produtos</h2>
        <p className="muted">
          A base é o custo unitário mais o frete por unidade. No modo por
          faixas, a venda usa o maior valor entre o acréscimo da faixa e o ganho
          mínimo. Nos demais modos, usa o percentual selecionado. A regra vale
          para novas importações do Sky e ao confirmar custo ou frete nos
          cadastros. Você pode ajustar o preço de venda manualmente após o
          cálculo.
        </p>
        <Field label="Regra de preço das peças">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as PricingPolicy["mode"])}
          >
            <option value="legacy">Faixas de custo e ganho mínimo</option>
            <option value="markup">Acréscimo sobre o custo</option>
            <option value="margin">Margem sobre a venda</option>
          </select>
        </Field>
        {mode !== "legacy" && (
          <Field
            label={
              mode === "margin"
                ? "Margem sobre a venda (%)"
                : "Acréscimo sobre o custo (%)"
            }
          >
            <NumericInput
              type="number"
              required
              min="0"
              max={mode === "margin" ? "99.99" : "1000"}
              step="0.01"
              value={rate / 100}
              onChange={(e) =>
                setRate(Math.round(Number(e.target.value) * 100))
              }
            />
          </Field>
        )}
        {mode !== "legacy" && (
          <p className="muted">
            A tabela abaixo fica preservada e só será utilizada no modo Faixas
            de custo e ganho mínimo.
          </p>
        )}
        <ProfitTable rows={rules} setRows={setRules} />
        <h3>Simular uma peça</h3>
        <div className="form-grid">
          <Field label="Custo sem frete (R$)">
            <NumericInput
              type="number"
              min="0"
              step="0.01"
              value={cost / 100}
              onChange={(e) =>
                setCost(Math.round(Number(e.target.value) * 100))
              }
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
        {simulationError ? (
          <p role="alert">{simulationError}</p>
        ) : (
          <p data-testid="product-price-simulation">
            Base: <strong>{money(base)}</strong> · Venda:{" "}
            <strong>{money(price)}</strong> · Ganho bruto:{" "}
            <strong>{money(price - base)}</strong>
          </p>
        )}
        <h3>Serviços de Terceiros</h3>
        <p className="muted">
          Tabela independente: a venda é o custo do serviço mais o percentual da
          faixa. Serviços próprios mantêm seus preços definidos; mão de obra do
          Catálogo Técnico mantém tempo e valor da hora. O cálculo por custo só
          é aplicado quando solicitado.
        </p>
        <ProfitTable rows={serviceRules} setRows={setServiceRules} thirdParty />
        <h3>Simular um serviço de terceiros</h3>
        <Field label="Custo do serviço de terceiros (R$)">
          <NumericInput
            type="number"
            min="0"
            step="0.01"
            value={serviceCost / 100}
            onChange={(e) =>
              setServiceCost(Math.round(Number(e.target.value) * 100))
            }
          />
        </Field>
        {serviceError ? (
          <p role="alert">{serviceError}</p>
        ) : (
          <p data-testid="service-price-simulation">
            Custo: <strong>{money(serviceCost)}</strong> · Venda:{" "}
            <strong>{money(servicePrice)}</strong> · Ganho bruto:{" "}
            <strong>{money(servicePrice - serviceCost)}</strong>
          </p>
        )}
        <p className="muted">
          Orçamentos e OS já lançados preservam seus valores. Ganho bruto não
          desconta taxas de cartão nem despesas da oficina.
        </p>
        {error && (
          <div role="alert" className="error-box">
            {error}
          </div>
        )}
        {dirty && <p role="status">Alterações não salvas.</p>}
        <Submit busy={busy}>Salvar política de preços</Submit>
      </fieldset>
    </form>
  );
}
