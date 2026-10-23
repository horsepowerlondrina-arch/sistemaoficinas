type Row=Record<string,any>;
export interface CustomerPayment { method:string; amount:number; date:string; installments:number }
export interface CustomerPaymentSummary {
  status:"paid"|"partial";
  total:number;
  paid:number;
  balance:number;
  payments:CustomerPayment[];
}
function paymentDate(value:string){
  if(!value)return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
  const date=new Date(value);if(Number.isNaN(date.getTime()))return '';
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const get=(type:string)=>parts.find(p=>p.type===type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
/** Customer-facing gross payments; excludes operator fees, net receipts and account details. */
export function customerPayments(orderStatus:string,receivable:Row|undefined,installments:Row[]):CustomerPaymentSummary|null{
  if(orderStatus!=='completed'||!receivable)return null;
  const parts=installments.filter(p=>p.receivable_id===receivable.id);
  const paidParts=parts.filter(p=>p.status==='paid');
  if(!paidParts.length && !(receivable.status==='paid'&&!parts.length))return null;
  const payments:CustomerPayment[]=[];
  for(const p of paidParts){
    // The customer's card payment happens on sale day, not on the bank settlement day.
    const date=paymentDate(p.method==='Cartão de crédito'?String(receivable.card_sale_on||''):String(p.paid_at||''));
    let row=payments.find(i=>i.method===p.method&&i.date===date);
    if(!row){row={method:String(p.method),amount:0,date,installments:0};payments.push(row);}
    row.amount+=Number(p.gross);row.installments++;
  }
  const total=Number(receivable.plan_configured?receivable.gross_total:receivable.amount);
  if(!parts.length)payments.push({method:String(receivable.method||'Não informada'),amount:total,date:paymentDate(String(receivable.paid_at||'')),installments:1});
  const paid=payments.reduce((s,p)=>s+p.amount,0);
  const balance=parts.length?parts.filter(p=>p.status==='open').reduce((s,p)=>s+Number(p.gross),0):Math.max(0,total-paid);
  return {status:balance===0?'paid':'partial',total,paid,balance,payments};
}
