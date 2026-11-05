import test from "node:test";
import assert from "node:assert/strict";
import { billingReadOnly,billingDate,nextBillingMonth,moneyCents,validatePaidAmount } from "../shared/stripeBilling.js";
test("billing grants the due day and becomes read-only next São Paulo day",()=>{
 const account={managed:true,paidUntil:null,trialUntil:null,dueOn:"2026-11-05"};
 assert.equal(billingReadOnly(account,new Date("2026-11-06T02:59:59Z")),false);
 assert.equal(billingReadOnly(account,new Date("2026-11-06T03:00:00Z")),true);
 assert.equal(billingDate(new Date("2026-11-06T02:59:59Z")),"2026-11-05");
 assert.equal(billingReadOnly({...account,managed:false},new Date("2027-01-01")),false);
 assert.equal(billingReadOnly({...account,paidUntil:"2026-12-05"},new Date("2026-11-07")),false);
});
test("existing trial is respected without granting a new trial",()=>{
 const a={managed:true,paidUntil:null,trialUntil:"2026-11-10T12:00:00Z",dueOn:"2026-11-05"};
 assert.equal(billingReadOnly(a,new Date("2026-11-10T11:59:59Z")),false);
 assert.equal(billingReadOnly(a,new Date("2026-11-10T12:00:00Z")),true);
});
test("monthly periods clamp to valid month ends",()=>{
 assert.equal(nextBillingMonth("2026-01-31"),"2026-02-28");
 assert.equal(nextBillingMonth("2028-01-31"),"2028-02-29");
 assert.equal(nextBillingMonth("2026-12-31"),"2027-01-31");
 assert.throws(()=>nextBillingMonth("2026-02-31"));
});
test("prices and provider amounts preserve integer cents",()=>{
 assert.equal(moneyCents(1099),1099);
 for(const bad of [0,49,10.99,NaN,Infinity,"1099",100000001])assert.throws(()=>moneyCents(bad));
 validatePaidAmount(1099,1099,"brl");
 assert.throws(()=>validatePaidAmount(1098,1099,"brl"));
 assert.throws(()=>validatePaidAmount(1099,1099,"usd"));
});
