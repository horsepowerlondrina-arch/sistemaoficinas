export const billingPlans = ["basic", "professional", "premium"] as const;
export type BillingPlan = typeof billingPlans[number];
export const billingPlanNames: Record<BillingPlan,string> = {
  basic:"Básico", professional:"Profissional", premium:"Premium",
};
export function moneyCents(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 50 || value > 100000000)
    throw new Error("Informe um valor entre R$ 0,50 e R$ 1.000.000,00.");
  return value;
}
export function billingDate(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error("Data de cobrança inválida.");
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const get=(type:string)=>parts.find(p=>p.type===type)!.value;
  return get("year")+"-"+get("month")+"-"+get("day");
}
export function nextBillingMonth(day:string):string {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Data de cobrança inválida.");
  const [y,m,d]=day.split("-").map(Number);
  const source=new Date(Date.UTC(y,m-1,d));
  if(source.toISOString().slice(0,10)!==day) throw new Error("Data de cobrança inválida.");
  const last=new Date(Date.UTC(y,m+1,0)).getUTCDate();
  return new Date(Date.UTC(y,m,Math.min(d,last))).toISOString().slice(0,10);
}
export type BillingAccess = {
  managed:boolean;
  paidUntil:string|null;
  trialUntil:string|null;
  dueOn:string|null;
};
export function billingReadOnly(value:BillingAccess,now=new Date()):boolean {
  if(!value.managed)return false;
  const today=billingDate(now);
  if(value.trialUntil&&new Date(value.trialUntil).getTime()>now.getTime())return false;
  if(value.paidUntil&&value.paidUntil>=today)return false;
  return !!value.dueOn&&today>value.dueOn;
}
export function validatePaidAmount(actual:unknown,expected:number,currency:unknown) {
  if(currency!=="brl"||actual!==expected||!Number.isSafeInteger(actual))
    throw new Error("O pagamento não corresponde à mensalidade.");
}

export type BillingSummary={
 enabled:boolean;test_mode?:boolean;
 prices:{id:string;plan_code:BillingPlan;amount_cents:number}[];
 account:{plan_code:BillingPlan;method:"card"|"pix";managed:boolean;due_on:string|null;paid_until:string|null;recurring:boolean;cancel_at_period_end:boolean;subscription_status:string|null}|null;
 payments:{provider_id:string;amount_cents:number;period_start:string;period_end:string;status:string}[];
 read_only:boolean;
};
export type BillingOverview={
 enabled:boolean;test_mode?:boolean;
 prices:BillingSummary["prices"];
 accounts:{tenant_id:string;name:string;plan_code:BillingPlan;method:string;due_on:string|null;paid_until:string|null;managed:boolean;subscription_status:string|null;cancel_at_period_end:boolean}[];
};
