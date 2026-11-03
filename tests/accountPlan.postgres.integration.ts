import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLocalDatabase } from "../server/db/local";
import { adminClient } from "../scripts/local-admin";

test("OPS-004: somente a oficina autenticada e seu proprietário leem o resumo do plano",async()=>{
 const credentials=JSON.parse(readFileSync(process.env.LOCAL_TEST_CREDENTIALS_FILE||"data/local-credentials.json","utf8"));
 const a=credentials.find((c:{tenant:string})=>c.tenant==="local-a");
 const admin=adminClient();await admin.connect();
 let owner:string;
 try{owner=(await admin.query("SELECT id FROM horse_power.users WHERE email=$1",[a.email])).rows[0].id;}
 finally{await admin.end();}
 const db=await createLocalDatabase();
 try{
   await db.withRequestContext!({"app.tenant_id":"local-a","app.user_id":owner},async()=>{
     const own=await db.prepare("SELECT horse_power.local_tenant_plan_summary(?) AS plan").get("local-a");
     assert.ok(own && Object.hasOwn(own,"plan"));
     await assert.rejects(db.prepare("SELECT horse_power.local_tenant_plan_summary(?) AS plan").get("local-b"),/Acesso à oficina não autorizado/);
   },()=>false);
 }finally{await db.close();}
});
