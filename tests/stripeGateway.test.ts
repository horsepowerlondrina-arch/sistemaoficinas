import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifiedStripeEvent, stripeTestKey, stripeForm, createStripeGateway } from "../server/services/stripeGateway.js";
const secret="whsec_fictional_unit_test_only";
const now=Date.UTC(2026,10,5);
function sign(raw:Buffer,timestamp=now/1000) {
 return "t="+timestamp+",v1="+createHmac("sha256",secret).update(timestamp+".").update(raw).digest("hex");
}
const raw=Buffer.from(JSON.stringify({id:"evt_fictional",type:"invoice.paid",livemode:false,data:{object:{id:"in_fictional"}}}));
test("Stripe verifies raw body, timestamp and test environment",()=>{
 assert.equal(verifiedStripeEvent(raw,sign(raw),secret,now).id,"evt_fictional");
 assert.throws(()=>verifiedStripeEvent(Buffer.concat([raw,Buffer.from(" ")]),sign(raw),secret,now));
 assert.throws(()=>verifiedStripeEvent(raw,sign(raw,now/1000-301),secret,now));
 assert.throws(()=>verifiedStripeEvent(raw,sign(raw)+",t="+now/1000,secret,now));
 const live=Buffer.from(raw.toString().replace('"livemode":false','"livemode":true'));
 assert.throws(()=>verifiedStripeEvent(live,sign(live),secret,now));
 assert.throws(()=>verifiedStripeEvent(raw,sign(raw),"",now));
});
test("Stripe refuses live credentials and correctly encodes nested checkout parameters",()=>{
 assert.throws(()=>stripeTestKey("sk_live_fictional"));
 assert.throws(()=>stripeTestKey(undefined));
 assert.equal(stripeTestKey("sk_test_fictional"),"sk_test_fictional");
 const form=stripeForm({line_items:[{price:"price_a",quantity:1}],metadata:{tenant:"fixture a"}});
 assert.equal(form.get("line_items[0][price]"),"price_a");
 assert.equal(form.get("metadata[tenant]"),"fixture a");
});
test("Stripe client restricts destination and requires idempotency",async()=>{
 let calls=0;
 const send:typeof fetch=async(input,init)=>{
   calls++; assert.equal(String(input),"https://api.stripe.com/v1/customers");
   assert.equal(init?.redirect,"error");
   assert.equal((init?.headers as Record<string,string>)["Idempotency-Key"],"customer:fixture");
   return new Response(JSON.stringify({id:"cus_fixture",livemode:false}));
 };
 const request=createStripeGateway("sk_test_fictional",send);
 await assert.rejects(request("//evil.example/customers"));
 await assert.rejects(request("/customers",{}));
 assert.equal(calls,0);
 assert.deepEqual(await request("/customers",{name:"Fictional"},"customer:fixture"),{id:"cus_fixture",livemode:false});
});
test("Stripe client never exposes provider error payloads",async()=>{
 const request=createStripeGateway("sk_test_fictional",async()=>new Response("private provider error",{status:500}));
 await assert.rejects(request("/customers"),error=>error instanceof Error&&!error.message.includes("private"));
});
