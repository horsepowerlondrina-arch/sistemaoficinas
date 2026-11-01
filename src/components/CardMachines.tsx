import { useEffect, useState } from "react";
import { api, send } from "../lib/api";
import { useApp } from "../lib/context";
import { useUnsavedSettings } from "../lib/useUnsavedSettings";
import { Field } from "./ui";
import { machineRate, type CardMachine } from "../../shared/cardMachines";

export function useCardMachines() {
  const [machines, setMachines] = useState<CardMachine[]>([]),
    [error, setError] = useState("");
  const { session } = useApp();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    api<CardMachine[]>("/card-machines")
      .then((rows) => {
        if (active) setMachines(rows);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [revision, session.tenant.id]);
  return { machines, error, reload: () => setRevision((n) => n + 1) };
}
export function CardMachineChoice({
  machines,
  machineId,
  method,
  installments,
  onChange,
  onRefresh,
  error,
}: {
  machines: CardMachine[];
  machineId: string;
  method: string;
  installments: number;
  onChange: (id: string) => void;
  onRefresh: () => void;
  error?: string;
}) {
  const machine = machines.find((m) => m.id === machineId),
    rate = machineRate(machine, method, installments);
  return (
    <div className="card-machine-choice">
      <Field label="Máquina de cartão">
        <select value={machineId} onChange={(e) => onChange(e.target.value)}>
          <option value="">Selecione uma máquina</option>
          {machines
            .filter((m) => m.active)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.operator}
                {m.is_default ? " · Padrão" : ""}
              </option>
            ))}
        </select>
      </Field>
      <button type="button" className="button small" onClick={onRefresh}>
        Atualizar máquinas e taxas
      </button>
      <p role={rate === undefined ? "alert" : undefined}>
        {error ||
          (rate === undefined
            ? "Cadastre ou selecione uma máquina ativa com taxa para esta modalidade e parcelas."
            : `Taxa total da operação: ${(rate / 100).toFixed(2)}%`)}
      </p>
    </div>
  );
}
const blank = () => ({
  id: "",
  name: "",
  operator: "",
  active: true,
  is_default: false,
  max_installments: 12,
  rates: {} as Record<string, string>,
});
type Form = ReturnType<typeof blank>;
export function CardMachines() {
  const { notify } = useApp();
  const [machines, setMachines] = useState<CardMachine[]>([]),
    [form, setForm] = useState<Form | null>(null),
    [saved, setSaved] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const dirty = !!form && JSON.stringify(form) !== saved;
  useUnsavedSettings(dirty);
  const reload = async () => {
    setMachines(await api("/card-machines"));
    setLoaded(true);
  };
  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);
  const open = (machine?: CardMachine) => {
    if (dirty && !window.confirm("Descartar alterações não salvas?")) return;
    const next = machine
      ? {
          ...machine,
          active: !!machine.active,
          is_default: !!machine.is_default,
          rates: Object.fromEntries(
            machine.rates.map((r) => [
              `${r.method}:${r.installments}`,
              String(r.fee_bps / 100),
            ]),
          ),
        }
      : blank();
    setForm(next);
    setSaved(JSON.stringify(next));
    setError("");
  };
  const rateInput = (method: string, n: number) => {
    const key = `${method}:${n}`;
    return (
      <Field
        key={key}
        label={
          method === "Cartão de débito" ? "Débito (%)" : `Crédito ${n}x (%)`
        }
      >
        <input
          type="number"
          min="0"
          max="99.99"
          step="0.01"
          placeholder="Não cadastrada"
          value={form!.rates[key] ?? ""}
          onChange={(e) =>
            setForm({
              ...form!,
              rates: { ...form!.rates, [key]: e.target.value },
            })
          }
        />
      </Field>
    );
  };
  return (
    <section className="panel work-order-section card-machines">
      <h2>Máquinas de cartão</h2>
      <p>
        Taxas percentuais totais por operação. Campo vazio deixa a modalidade
        indisponível; 0 registra uma taxa de zero por cento. Alterações valem
        para novos planos de recebimento.
      </p>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {!loaded && !error && <p role="status">Carregando máquinas...</p>}
      {loaded && (
        <>
          <button
            type="button"
            className="button primary"
            onClick={() => open()}
          >
            Cadastrar máquina
          </button>
          {!machines.length && <p>Nenhuma máquina cadastrada.</p>}
          <div className="form-grid">
            {machines.map((m) => (
              <section className="panel settings-card" key={m.id}>
                <h3>{m.name}</h3>
                <p>
                  {m.operator} · {m.active ? "Ativa" : "Desativada"}
                  {m.is_default ? " · Padrão" : ""}
                </p>
                <p>
                  Até {m.max_installments} parcelas · {m.rates.length} taxas
                  cadastradas
                </p>
                <button
                  type="button"
                  className="button"
                  aria-label={`Editar ${m.name}`}
                  onClick={() => open(m)}
                >
                  Editar
                </button>
              </section>
            ))}
          </div>
        </>
      )}
      {form && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const rates = Object.entries(form.rates)
                .filter(([, v]) => v.trim() !== "")
                .map(([key, value]) => {
                  const [method, n] = key.split(":");
                  return {
                    method,
                    installments: Number(n),
                    fee_bps: Math.round(Number(value) * 100),
                  };
                })
                .filter((r) => r.installments <= form.max_installments);
              await send(
                "/card-machines" + (form.id ? "/" + form.id : ""),
                { ...form, rates },
                form.id ? "PUT" : "POST",
              );
              setForm(null);
              setSaved("");
              await reload();
              notify(
                "Máquina e taxas salvas. Recebimentos anteriores preservados.",
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>{form.id ? "Editar máquina" : "Nova máquina"}</h3>
          <fieldset disabled={busy} className="product-batch-fields">
            <div className="form-grid">
              <Field label="Nome da máquina">
                <input
                  required
                  maxLength={80}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label="Operadora">
                <input
                  required
                  maxLength={80}
                  value={form.operator}
                  onChange={(e) =>
                    setForm({ ...form, operator: e.target.value })
                  }
                />
              </Field>
              <Field label="Máximo de parcelas">
                <input
                  type="number"
                  required
                  min={1}
                  max={24}
                  value={form.max_installments}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      max_installments: Number(e.target.value),
                    })
                  }
                />
              </Field>
            </div>
            <p>
              Ao reduzir o limite, as taxas acima dele serão removidas somente
              desta tabela. O histórico dos recebimentos será preservado.
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) =>
                  setForm({
                    ...form,
                    active: e.target.checked,
                    is_default: e.target.checked ? form.is_default : false,
                  })
                }
              />
              Máquina ativa
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                disabled={!form.active}
                checked={form.is_default}
                onChange={(e) =>
                  setForm({ ...form, is_default: e.target.checked })
                }
              />
              Máquina padrão da oficina
            </label>
            <div className="form-grid">
              {rateInput("Cartão de débito", 1)}
              {Array.from(
                { length: Math.max(0, Math.min(24, form.max_installments)) },
                (_, i) => rateInput("Cartão de crédito", i + 1),
              )}
            </div>
            {dirty && <p role="status">Alterações não salvas.</p>}
            <button className="button primary" type="submit">
              {busy ? "Salvando..." : "Salvar máquina"}
            </button>
            <button
              className="button"
              type="button"
              onClick={() => {
                if (
                  !dirty ||
                  window.confirm("Descartar alterações não salvas?")
                )
                  setForm(null);
              }}
            >
              Cancelar edição
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}

export function InstallmentInterestSettings() {
  const { data, refresh, notify } = useApp();
  const [value, setValue] = useState(
      Number(data.payment_settings?.interest_bps || 0) / 100,
    ),
    [saved, setSaved] = useState(value),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useUnsavedSettings(value !== saved);
  return (
    <form
      className="panel work-order-section"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await send(
            "/payment-settings",
            {
              debit_fee_bps: data.payment_settings?.debit_fee_bps || 0,
              credit_fee_bps: data.payment_settings?.credit_fee_bps || 0,
              interest_bps: Math.round(value * 100),
            },
            "PUT",
          );
          setSaved(value);
          await refresh();
          notify("Juros padrão salvos.");
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Juros do parcelamento</h2>
      <p>
        Percentual total sugerido para boletos parcelados. As taxas de cartão
        são administradas em cada máquina e o repasse permanece desligado por
        padrão.
      </p>
      <Field label="Juros totais do cliente — parcelamento (%)">
        <input
          type="number"
          required
          min={0}
          max={100}
          step="0.01"
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
        />
      </Field>
      {error && <p role="alert">{error}</p>}
      <button className="button" disabled={busy}>
        Salvar juros do parcelamento
      </button>
    </form>
  );
}
