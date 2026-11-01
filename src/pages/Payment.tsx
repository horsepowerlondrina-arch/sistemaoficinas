import { useCardMachines, CardMachineChoice } from "../components/CardMachines";
import { selectCardMachine } from "../../shared/cardMachines";
import { nextBankingDay } from "../../shared/bankingDays";
import { selectPaymentMethod } from "../../shared/paymentMethod";
import { NumericInput } from "../components/NumericInput";
import { MixedPaymentPlan } from "../components/MixedPaymentPlan";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApp } from "../lib/context";
import { send } from "../lib/api";
import { money, today, dateLabel, type Entity } from "../lib/types";
import { PageHeading, Field, Empty, Modal } from "../components/ui";
const methods = [
  "Pix",
  "Dinheiro",
  "Cartão de débito",
  "Cartão de crédito",
  "Transferência",
  "Boleto",
];
export function Payment() {
  const { id } = useParams();
  const { data, refresh, notify } = useApp();
  const navigate = useNavigate();
  const {machines,error:machineError,reload:reloadMachines}=useCardMachines();
  const [editingPlan, setEditingPlan] = useState(false);
  const original = data.receivables.find((r) => r.order_id === id);
  const r = original && editingPlan ? {...original,plan_configured:0} : original;
  const [form, setForm] = useState({
    machine_id: "",
    method: "Pix",
    installments: 1,
    card_fee_bps: 0,
    interest_bps: 0,
    first_due_on: today(),
    sale_on: today(),
    pass_card_fee: false,
  });
  const [accountId, setAccountId] = useState("");
  const [mixed, setMixed] = useState(false);
  const cashAccounts = (data.cash_accounts || []).filter((a) => a.active);
  const order = data.orders?.find((item) => item.id === id);
  const orderSubtotal = (order?.items || []).reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0,
  );
  const [discountMode, setDiscountMode] = useState<"money" | "percent">("money");
  const [discountValue, setDiscountValue] = useState(() => Number(order?.discount || 0) / 100);
  const discountInputValue = Math.round(Math.max(0, Number(discountValue) || 0) * 100);
  const discountAmount = Math.min(
    orderSubtotal,
    discountMode === "percent"
      ? Math.round((orderSubtotal * discountInputValue) / 10000)
      : discountInputValue,
  );
  const discountedTotal = orderSubtotal - discountAmount;
  const discountChoice = { mode: discountMode, value: discountInputValue };
  const hasRegisteredPayment = !!original && (
    original.status === "paid" ||
    data.installments.some((part) => part.receivable_id === original.id && part.status === "paid")
  );
  const [preview, setPreview] = useState<Entity | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<Entity | null>(null);
  useEffect(() => {
    if (order) {
      setDiscountMode("money");
      setDiscountValue(Number(order.discount || 0) / 100);
    }
  }, [id, order?.discount]);

  useEffect(() => {
    if (!original?.plan_configured) return;
    const firstDueOn = data.installments
      .filter((part) => part.receivable_id === original.id)
      .map((part) => part.due_on)
      .sort()[0];
    const interest = Math.round((Number(original.amount) * Number(original.interest_bps || 0)) / 10000);
    setMixed(original.method === "Misto");
    setForm((current) => ({
      ...current,
      machine_id: data.installments.find(p=>p.receivable_id===original.id)?.machine_id || "",
      method: original.method === "Misto" ? current.method : original.method,
      installments: Number(original.installment_count || 1),
      card_fee_bps: Number(original.card_fee_bps || 0),
      interest_bps: Number(original.interest_bps || 0),
      first_due_on: firstDueOn || original.due_on || current.first_due_on,
      sale_on: original.card_sale_on || current.sale_on,
      pass_card_fee: Number(original.gross_total || 0) > Number(original.amount || 0) + interest,
    }));
  }, [id, original?.plan_configured]);

  useEffect(() => {
    if (!r) return;
    if (discountedTotal <= 0) {
      setPreview(null);
      setError("");
      return;
    }
    if (r.plan_configured || mixed) return;
    let current = true;
    setPreview(null);
    const timer = setTimeout(() => {
      send(`/receivables/${r.id}/preview`, { ...form, discount: discountChoice })
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
  }, [r?.id, r?.plan_configured, form, mixed, editingPlan, discountMode, discountInputValue, discountedTotal]);
  useEffect(()=>{
    if(!r?.plan_configured&&machines.length)setForm(current=>selectCardMachine(current,machines));
  },[machines,r?.plan_configured]);
  if (!r)
    return (
      <Empty
        title="Nenhum valor a receber"
        description="Esta OS ainda não foi finalizada ou não possui saldo para cobrança."
        action={
          <button className="button" onClick={() => navigate(`/ordens/${id}`)}>
            Voltar à OS
          </button>
        }
      />
    );
  const parts = data.installments
    .filter((p) => p.receivable_id === r.id)
    .sort((a, b) => a.sequence - b.sequence);
  const existingMixedPayments = original?.method === "Misto"
    ? [...new Set(parts.map((part) => part.method))].map((method) => {
        const methodParts = parts.filter((part) => part.method === method);
        const principal = methodParts.reduce((sum, part) => sum + Number(part.principal || 0), 0);
        const gross = methodParts.reduce((sum, part) => sum + Number(part.gross || 0), 0);
        const fee = methodParts.reduce((sum, part) => sum + Number(part.fee || 0), 0);
        const interest = methodParts.reduce((sum, part) => sum + Number(part.interest || 0), 0);
        return {
          method,
          machine_id: methodParts[0]?.machine_id || "",
          amount: principal,
          installments: methodParts.length,
          card_fee_bps: methodParts[0]?.card_fee_bps ?? (method.startsWith("Cartão") && gross > 0 ? Math.round((fee * 10000) / gross) : 0),
          interest_bps: methodParts[0]?.interest_bps ?? (principal > 0 ? Math.round((interest * 10000) / principal) : 0),
          first_due_on: methodParts.map((part) => part.due_on).sort()[0] || today(),
          sale_on: original.card_sale_on || today(),
          pass_card_fee: methodParts[0]?.pass_card_fee != null ? !!methodParts[0].pass_card_fee : methodParts.some((part) => Number(part.gross) > Number(part.principal) + Number(part.interest)),
        };
      })
    : undefined;
  const credit = r.plan_configured ? parts.some(p=>p.method==="Cartão de crédito") : form.method === "Cartão de crédito";
  const saleOn = r.card_sale_on || form.sale_on;
  const settlementOn = nextBankingDay(saleOn || today());
  const openParts = parts.filter((p) => p.status === "open" && p.method === "Cartão de crédito");
  const creditTotal = openParts.reduce((v,p) => ({gross:v.gross+p.gross,fee:v.fee+p.fee,net:v.net+p.net}),{gross:0,fee:0,net:0});
  const configuredInterest=parts.length&&parts.every(p=>p.interest_bps!=null)
    ? [...new Set(parts.map(p=>p.method))].reduce((total,method)=>{const group=parts.filter(p=>p.method===method);return total+Math.round(group.reduce((s,p)=>s+Number(p.principal),0)*Number(group[0].interest_bps)/10000);},0)
    : Math.round((r.amount*r.interest_bps)/10000);
  const plan = r.plan_configured
    ? {
        base: r.amount,
        interest: configuredInterest,
        surcharge:
          r.gross_total -
          r.amount -
          configuredInterest,
        gross: r.gross_total,
        fee: r.fee_total,
        net: r.net_total,
      }
    : preview;
  const card = form.method.startsWith("Cartão"),
    canSplit = ["Cartão de crédito", "Boleto"].includes(form.method);
  const changeMethod = (method:string) => setForm(current=>selectCardMachine(selectPaymentMethod(current,method,0),machines));
  const updateDiscountValue = (value: number, mode = discountMode) => {
    setDiscountValue(value);
    const nextDiscount = Math.min(
      orderSubtotal,
      mode === "percent"
        ? Math.round((orderSubtotal * Math.round(Math.max(0, value) * 100)) / 10000)
        : Math.round(Math.max(0, value) * 100),
    );
    if (
      original?.plan_configured &&
      !hasRegisteredPayment &&
      nextDiscount !== Number(order?.discount || 0)
    ) {
      setMixed(original.method === "Misto");
      setEditingPlan(true);
    }
  };
  return (
    <>
      <button className="back-link" onClick={() => navigate(`/ordens/${id}`)}>
        ← Voltar à OS
      </button>
      <PageHeading
        eyebrow="RECEBIMENTO"
        title={`Receber OS #${r.order_number}`}
        description={r.customer_name}
      />
      <section className="panel work-order-section receipt-panel">
        {!!r.plan_configured && parts.filter((p,i,rows)=>p.machine_name&&rows.findIndex(x=>x.machine_id===p.machine_id&&x.method===p.method)===i).map(p=><p key={p.id}>Máquina: {p.machine_name} · {p.machine_operator} · {p.method} · {p.installment_count}x · Taxa utilizada: {(Number(p.card_fee_bps)/100).toFixed(2)}%</p>)}
        {error && <div className="error-box" role="alert">{error}</div>}
      {order && (
        <div className="receipt-section">
          <h2>Desconto</h2>
          <div className="form-grid">
            <Field label="Tipo de desconto">
              <select
                value={discountMode}
                disabled={busy || hasRegisteredPayment}
                onChange={(event) => {
                  const mode = event.target.value as "money" | "percent";
                  const value = mode === "percent"
                    ? orderSubtotal > 0
                      ? Number(((discountAmount / orderSubtotal) * 100).toFixed(2))
                      : 0
                    : discountAmount / 100;
                  setDiscountMode(mode);
                  updateDiscountValue(value, mode);
                }}
              >
                <option value="money">Em dinheiro (R$)</option>
                <option value="percent">Percentual (%)</option>
              </select>
            </Field>
            <Field label={discountMode === "percent" ? "Desconto (%)" : "Desconto (R$)"}>
              <NumericInput
                type="number"
                min={0}
                max={discountMode === "percent" ? 100 : orderSubtotal / 100}
                step="0.01"
                value={discountValue}
                disabled={busy || hasRegisteredPayment}
                onChange={(event) => updateDiscountValue(Math.max(0, Number(event.target.value) || 0))}
              />
            </Field>
          </div>
          {hasRegisteredPayment && (
            <p className="muted" role="status">
              O desconto fica bloqueado após um recebimento confirmado para preservar os valores já registrados.
            </p>
          )}
          {discountedTotal === 0 && (
            <p className="muted" role="status">A OS ficará sem saldo a receber.</p>
          )}
        </div>
      )}
      {discountedTotal > 0 && !!original?.plan_configured && !parts.some(p=>p.status==='paid') && !editingPlan && <div className="receipt-section"><h2>Forma de pagamento</h2><p>{r.method} · {Number(r.installment_count || 1)} parcela(s)</p><button className="button" onClick={()=>{setMixed(original.method === "Misto");setEditingPlan(true);}}>Alterar condições de pagamento</button></div>}
      {discountedTotal > 0 && editingPlan && <button className="button" onClick={()=>{setEditingPlan(false);setError('');}}>Cancelar alteração das condições</button>}
      {discountedTotal > 0 && mixed && (!r.plan_configured || editingPlan) && <MixedPaymentPlan receivable={{...r,amount:discountedTotal}} discount={discountChoice} subtotal={orderSubtotal} discountAmount={discountAmount} initialPayments={existingMixedPayments} onSaved={()=>{setEditingPlan(false);setMixed(false);}} />}
      {discountedTotal > 0 && !r.plan_configured && !mixed && (
        <div className="receipt-section">
          <h2>Forma de pagamento</h2>
          <div className="form-grid">
            <Field label="Forma de pagamento">
              <select
                value={form.method}
                onChange={(e) => changeMethod(e.target.value)}
              >
                {methods.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
          </div>
          <label className="checkbox-label receipt-split-option"><input type="checkbox" checked={mixed} onChange={e=>{setMixed(e.target.checked);setError('');}}/>Dividir entre formas de pagamento</label>
          <h2 className="receipt-subheading">Parcelas e vencimento</h2>
          <div className="form-grid">
            <Field label="Parcelas">
              <NumericInput
                type="number"
                min={1}
                max={form.method === "Cartão de crédito" ? machines.find(m=>m.id===form.machine_id)?.max_installments || 24 : 24}
                disabled={!canSplit}
                value={form.installments}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    installments: Number(e.target.value),
                    card_fee_bps: selectCardMachine({...f,installments:Number(e.target.value)},machines).card_fee_bps,
                    interest_bps: Number(e.target.value)>1 && f.method==='Boleto' ? data.payment_settings?.interest_bps || 0 : 0,
                  }))
                }
              />
            </Field>
            <Field label="Primeiro vencimento">
              <input
                type="date"
                value={form.first_due_on}
                onChange={(e) =>
                  setForm({ ...form, first_due_on: e.target.value })
                }
              />
            </Field>
            {credit && <Field label="Data da venda no cartão">
              <input type="date" value={form.sale_on} max={today()} required onChange={(e) => setForm({...form,sale_on:e.target.value})} />
            </Field>}
          </div>
          {card && <h2 className="receipt-subheading">Taxas do cartão</h2>}
          {!card && form.installments > 1 && <h2 className="receipt-subheading">Juros do parcelamento</h2>}
          {(card || form.installments > 1) && <div className="form-grid">
            {card && <CardMachineChoice machines={machines} machineId={form.machine_id} method={form.method} installments={form.installments} error={machineError} onRefresh={reloadMachines} onChange={id=>setForm(current=>selectCardMachine(current,machines,id))}/>}
            {form.installments > 1 && <Field label="Juros totais do parcelamento — cliente (%)">
              <NumericInput
                type="number"
                min={0}
                max={100}
                step="0.01"
                disabled={form.installments < 2}
                value={form.interest_bps / 100}
                onChange={(e) =>
                  setForm({
                    ...form,
                    interest_bps: Math.round(Number(e.target.value) * 100),
                  })
                }
              />
            </Field>}
            {card && <label className="checkbox-label receipt-pass-fee"><input type="checkbox" checked={form.pass_card_fee} onChange={(e) => setForm({ ...form, pass_card_fee: e.target.checked })} />Repassar taxa ao cliente</label>}
          </div>}
          {(card || form.installments > 1) && <p className="muted">
            Os juros são aplicados uma vez sobre o valor da OS. A taxa da
            operadora é descontada do total cobrado do cliente.
          </p>}
          <h2 className="receipt-subheading">Resumo do recebimento</h2>
          <div className="payment-summary receipt-financial-summary">
            <div><span>Subtotal</span><strong>{money(orderSubtotal)}</strong></div>
            <div><span>Desconto</span><strong>{money(discountAmount)}</strong></div>
            <div><span>Taxa repassada</span><strong>{money(Number(preview?.surcharge || 0))}</strong></div>
            <div><span>Total a receber</span><strong>{money(Number(preview?.gross || discountedTotal))}</strong></div>
            <div><span>Taxa da oficina</span><strong>{money(Number(preview?.fee || 0))}</strong></div>
            <div><span>Líquido da oficina</span><strong>{money(Number(preview?.net || discountedTotal))}</strong></div>
          </div>
          <div className="receipt-plan-actions">
            <button className="button primary" disabled={busy || !preview || discountedTotal <= 0} onClick={async () => {
              setBusy(true); setError("");
              try {
                await send(`/receivables/${r.id}/plan`, { ...form, discount: discountChoice });
                await refresh(); setEditingPlan(false);
                notify(credit ? "Condições salvas. Confirme o recebimento total do cartão." : "Condições salvas. Confirme as parcelas conforme receber.");
              } catch (e) { setError((e as Error).message); }
              finally { setBusy(false); }
            }}>Salvar condições de pagamento</button>
          </div>
        </div>
      )}
      {discountedTotal > 0 && !!r.plan_configured && plan && (
        <div className="receipt-section">
          <h2>Resumo do recebimento</h2>
          <div className="payment-summary receipt-financial-summary">
            {[
              ["Subtotal", orderSubtotal || Number(plan.base) + Number(order?.discount || 0)],
              ["Desconto", Number(order?.discount || 0)],
              ["Taxa repassada", r.method === "Misto" ? parts.reduce((sum, part) => sum + Math.max(0, Number(part.gross) - Number(part.principal) - Number(part.interest)), 0) : plan.surcharge || 0],
              ["Total a receber", plan.gross],
              ["Juros do parcelamento", r.method === "Misto" ? parts.reduce((sum, part) => sum + Number(part.interest || 0), 0) : plan.interest],
              ["Taxa da oficina", plan.fee],
              ["Líquido da oficina", plan.net],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <span>{label}</span>
                <strong>{money(Number(value))}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
      </section>
      {discountedTotal > 0 && (!mixed || !!r.plan_configured) && <section className="panel work-order-section">
        <h2>
          {r.status === "paid"
            ? "Recebimento concluído"
            : "Parcelas e vencimentos"}
        </h2>
        {!!r.plan_configured && (
          <p>
            {r.method} · Saldo do cliente: <strong>{money(r.balance)}</strong>
          </p>
        )}
        {credit && <p className="muted">O parcelamento é do cliente. A oficina recebe o líquido total em {dateLabel(settlementOn)}, no próximo dia útil após a venda (fins de semana e feriados bancários nacionais são considerados).</p>}
        {credit && !!r.plan_configured && openParts.length>0 && (
          <button className="button primary" disabled={busy} onClick={() => setConfirm({id:r.id,is_credit:true,...creditTotal})}>
            Receber total do cartão · {money(creditTotal.net)}
          </button>
        )}
        {credit && r.method!=="Misto" && r.status==="paid" && <p>{(r.paid_at || "").slice(0,10)>today() ? "Crédito agendado para " : "Crédito registrado em "}{dateLabel(r.paid_at)}.</p>}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Forma</th>
                <th>Parcela</th>
                <th>Vencimento</th>
                <th>Cliente paga</th>
                <th>Taxa</th>
                <th>Líquido</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {(r.plan_configured ? parts : preview?.installments || []).map(
                (p: Entity) => (
                  <tr key={p.sequence}>
                    <td>{p.method || form.method}</td>
                    <td>
                      {r.plan_configured ? parts.filter(i=>i.method===p.method).indexOf(p)+1 : p.sequence}/
                      {r.plan_configured
                        ? parts.filter(i=>i.method===p.method).length
                        : form.installments}
                    </td>
                    <td>{dateLabel(p.due_on)}</td>
                    <td>{money(p.gross)}</td>
                    <td>{money(p.fee)}</td>
                    <td>{money(p.net)}</td>
                    <td>
                      {r.plan_configured ? (
                        p.status === "paid" ? (
                          <span className="badge paid">{p.method==="Cartão de crédito" && (p.paid_at || "").slice(0,10)>today() ? "Agendada" : "Recebida"}</span>
                        ) : p.method==="Cartão de crédito" ? (
                          <span className="badge">Incluída no total</span>
                        ) : (
                          <button
                            className="button primary"
                            disabled={busy}
                            onClick={() => setConfirm(p)}
                          >
                            {parts.filter(i=>i.method===p.method).length===1 ? `Receber ${p.method}` : "Receber parcela"}
                          </button>
                        )
                      ) : (
                        "Prevista"
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </section>}
      {discountedTotal <= 0 && (
        <section className="panel work-order-section">
          <h2>Recebimento</h2>
          <p className="muted">Não há saldo a receber enquanto o total da OS permanecer zerado.</p>
        </section>
      )}
      {confirm && (
        <Modal
          title={confirm.is_credit ? "Confirmar recebimento total do cartão?" : `Confirmar recebimento de ${confirm.method}?`}
          description={`Cliente paga ${money(confirm.gross)}. O caixa receberá ${money(confirm.net)}, após ${money(confirm.fee)} de taxa.${confirm.is_credit ? " Crédito em " + dateLabel(settlementOn) + "." : ""}`}
          onClose={() => !busy && setConfirm(null)}
        >
          {confirm.is_credit && !r.card_sale_on && <div className="modal-body"><Field label="Data da venda no cartão"><input type="date" value={form.sale_on} max={today()} required onChange={(e)=>setForm({...form,sale_on:e.target.value})}/></Field></div>}
          {!!data.cash_accounts?.length && (
            <div className="modal-body">
              <Field label="Conta que recebe o valor líquido">
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  required
                >
                  <option value="">Selecione a conta</option>
                  {cashAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ·{" "}
                      {a.kind === "cash" ? "Dinheiro físico" : "Conta bancária"}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          <div className="modal-footer">
            <button
              className="button"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              Voltar
            </button>
            <button
              className="button primary"
              disabled={busy || (!!data.cash_accounts?.length && !accountId) || (confirm.is_credit && !saleOn)}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await send(confirm.is_credit ? `/receivables/${r.id}/settle-credit` : `/installments/${confirm.id}/settle`, {
                    sale_on: confirm.is_credit ? saleOn : undefined,
                    account_id: accountId || undefined,
                  });
                  await refresh();
                  setConfirm(null);
                  notify(confirm.is_credit ? "Total do cartão registrado para " + dateLabel(settlementOn) + "." : "Parcela recebida e caixa atualizado.");
                } catch (e) {
                  setError((e as Error).message);
                  setConfirm(null);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirmar recebimento
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

