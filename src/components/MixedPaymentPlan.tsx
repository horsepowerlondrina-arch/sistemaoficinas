import { useEffect, useState } from "react";
import { useApp } from "../lib/context";
import { send } from "../lib/api";
import { money, today, type Entity } from "../lib/types";
import { Field } from "./ui";
import { NumericInput } from "./NumericInput";
import { selectPaymentMethod } from "../../shared/paymentMethod";
const methods = [
  "Pix",
  "Dinheiro",
  "Cartão de débito",
  "Cartão de crédito",
  "Transferência",
  "Boleto",
];
type Part = {
  key: string;
  amount: number;
  method: string;
  installments: number;
  card_fee_bps: number;
  interest_bps: number;
  first_due_on: string;
  sale_on: string;
  pass_card_fee: boolean;
};
const fresh = (method: string, amount: number): Part => ({
  key: crypto.randomUUID(),
  amount,
  method,
  installments: 1,
  card_fee_bps: 0,
  interest_bps: 0,
  first_due_on: today(),
  sale_on: today(),
  pass_card_fee: false,
});
export function MixedPaymentPlan({ receivable, onSaved }: { receivable: Entity; onSaved?: () => void }) {
  const { data, refresh, notify } = useApp();
  const [parts, setParts] = useState<Part[]>(() => [
    fresh("Pix", receivable.amount),
    fresh("Dinheiro", 0),
  ]);
  const [preview, setPreview] = useState<Entity | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const total = parts.reduce((s, p) => s + p.amount, 0);
  const change = (key: string, patch: Partial<Part>) =>
    setParts((old) => old.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  useEffect(() => {
    let current = true;
    setPreview(null);
    if (total !== receivable.amount || parts.some((p) => p.amount <= 0)) {
      setError("Divida o valor da OS entre as formas de pagamento.");
      return;
    }
    const timer = setTimeout(() => {
      send(`/receivables/${receivable.id}/preview`, {
        payments: parts.map(({ key, ...p }) => p),
      })
        .then((p) => {
          if (current) {
            setPreview(p);
            setError("");
          }
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [parts, receivable.id, receivable.amount, total]);
  return (
    <section className="panel work-order-section">
      <h2>Dividir o pagamento</h2>
      <p>
        Informe o valor da OS destinado a cada forma. As taxas e os juros são
        calculados separadamente.
      </p>
      <fieldset disabled={busy} className="product-batch-fields">
        {parts.map((p, index) => (
          <section
            key={p.key}
            className="product-batch-item"
            aria-label={`Pagamento ${index + 1}`}
          >
            <div className="form-grid">
              <Field label="Forma de pagamento">
                <select
                  value={p.method}
                  onChange={(e) => {
                    const method = e.target.value;
                    change(
                      p.key,
                      selectPaymentMethod(
                        p,
                        method,
                        method === "Cartão de crédito"
                          ? data.payment_settings?.credit_fee_bps || 0
                          : method === "Cartão de débito"
                            ? data.payment_settings?.debit_fee_bps || 0
                            : 0,
                      ),
                    );
                  }}
                >
                  {methods
                    .filter(
                      (m) =>
                        m === p.method || !parts.some((i) => i.method === m),
                    )
                    .map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                </select>
              </Field>
              <Field label="Valor da OS nesta forma (R$)">
                <NumericInput
                  min={0.01}
                  step="0.01"
                  value={p.amount / 100}
                  onChange={(e) =>
                    change(p.key, {
                      amount: Math.round(Number(e.target.value) * 100),
                    })
                  }
                />
              </Field>
              <Field label="Parcelas">
                <NumericInput
                  min={1}
                  max={p.method === "Cartão de crédito" ? 12 : 24}
                  disabled={!["Cartão de crédito", "Boleto"].includes(p.method)}
                  value={p.installments}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    change(p.key, {
                      installments: n,
                      card_fee_bps:
                        data.card_rates?.find(
                          (r) => r.method === p.method && r.installments === n,
                        )?.fee_bps ?? p.card_fee_bps,
                      interest_bps:
                        n > 1 ? data.payment_settings?.interest_bps || 0 : 0,
                    });
                  }}
                />
              </Field>
              <Field label="Primeiro vencimento">
                <input
                  type="date"
                  value={p.first_due_on}
                  onChange={(e) =>
                    change(p.key, { first_due_on: e.target.value })
                  }
                />
              </Field>
              {p.method === "Cartão de crédito" && (
                <Field label="Data da venda no cartão">
                  <input
                    type="date"
                    max={today()}
                    value={p.sale_on}
                    onChange={(e) => change(p.key, { sale_on: e.target.value })}
                  />
                </Field>
              )}
              {p.method.startsWith("Cartão") && (
                <Field label="Taxa da operadora (%)">
                  <NumericInput
                    min={0}
                    max={100}
                    step="0.01"
                    value={p.card_fee_bps / 100}
                    onChange={(e) =>
                      change(p.key, {
                        card_fee_bps: Math.round(Number(e.target.value) * 100),
                      })
                    }
                  />
                </Field>
              )}
              {p.installments > 1 && (
                <Field label="Juros totais do parcelamento (%)">
                  <NumericInput
                    min={0}
                    max={100}
                    step="0.01"
                    value={p.interest_bps / 100}
                    onChange={(e) =>
                      change(p.key, {
                        interest_bps: Math.round(Number(e.target.value) * 100),
                      })
                    }
                  />
                </Field>
              )}
            </div>
            {p.method.startsWith("Cartão") && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={p.pass_card_fee}
                  onChange={(e) =>
                    change(p.key, { pass_card_fee: e.target.checked })
                  }
                />
                Repassar a taxa deste cartão ao cliente
              </label>
            )}
            {preview?.plans[index] && (
              <p>
                Cliente paga{" "}
                <strong>{money(preview.plans[index].gross)}</strong> · Taxa{" "}
                {money(preview.plans[index].fee)} · Líquido{" "}
                <strong>{money(preview.plans[index].net)}</strong>
              </p>
            )}
            {parts.length > 2 && (
              <button
                type="button"
                className="button small"
                onClick={() =>
                  setParts((old) => old.filter((i) => i.key !== p.key))
                }
              >
                Remover forma
              </button>
            )}
          </section>
        ))}
        <button
          className="button"
          disabled={parts.length === methods.length}
          onClick={() => {
            const method = methods.find(
              (m) => !parts.some((p) => p.method === m),
            )!;
            setParts((old) => [
              ...old,
              fresh(method, Math.max(0, receivable.amount - total)),
            ]);
          }}
        >
          Adicionar forma de pagamento
        </button>
      </fieldset>
      <p>
        Valor da OS: <strong>{money(receivable.amount)}</strong> · Distribuído:{" "}
        <strong>{money(total)}</strong> · Falta distribuir:{" "}
        <strong>{money(receivable.amount - total)}</strong>
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <p>
          Total do cliente: <strong>{money(preview.gross)}</strong> · Taxas:{" "}
          {money(preview.fee)} · Líquido da oficina:{" "}
          <strong>{money(preview.net)}</strong>
        </p>
      )}
      <button
        className="button primary"
        disabled={busy || !preview}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await send(`/receivables/${receivable.id}/plan`, {
              payments: parts.map(({ key, ...p }) => p),
            });
            await refresh();
          onSaved?.();
            notify(
              "Condições salvas. Confirme cada recebimento e sua conta de destino.",
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Salvando..." : "Salvar divisão do pagamento"}
      </button>
    </section>
  );
}
