import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminClient } from "../scripts/local-admin.js";
import { digest, hashPassword, verifyPassword } from "../server/auth/session.js";

test("PostgreSQL 17: workshop password recovery is single-use, scoped and revokes only owner sessions", async () => {
  const admin = adminClient();
  await admin.connect();
  const userA=randomUUID(), userB=randomUUID();
  const emailA=`reset-${userA}@example.test`, emailB=`reset-${userB}@example.test`;
  const token=digest(`token-${userA}`), expired=digest(`expired-${userA}`);
  try {
    await admin.query("BEGIN");
    await admin.query("INSERT INTO horse_power.users(id,name,email,password_hash) VALUES($1,'Fictício A',$2,$3),($4,'Fictício B',$5,$6)",
      [userA,emailA,hashPassword("Old-Fictional-A"),userB,emailB,hashPassword("Old-Fictional-B")]);
    await admin.query("INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,'local-a','owner'),($2,'local-b','owner')",[userA,userB]);
    await admin.query("INSERT INTO horse_power.sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,'local-a',$3),($4,$5,'local-b',$6)",
      [digest("session-"+userA),userA,Date.now()+60_000,digest("session-"+userB),userB,Date.now()+60_000]);
    await admin.query("SET LOCAL ROLE hp_local_app");
    const issued=await admin.query("SELECT horse_power.issue_password_reset($1,$2,$3) AS email",
      [emailA,digest("ip-"+userA),token]);
    assert.equal(issued.rows[0].email,emailA);
    const unknown=await admin.query("SELECT horse_power.issue_password_reset($1,$2,$3) AS email",
      ["absent@example.test",digest("ip-unknown"),digest("unknown-token")]);
    assert.equal(unknown.rows[0].email,null);
    const newHash=hashPassword("New-Fictional-A");
    assert.equal((await admin.query("SELECT horse_power.complete_password_reset($1,$2) AS completed",[token,newHash])).rows[0].completed,true);
    assert.equal((await admin.query("SELECT horse_power.complete_password_reset($1,$2) AS completed",[token,newHash])).rows[0].completed,false);
    await admin.query("RESET ROLE");
    const users=await admin.query("SELECT id,password_hash FROM horse_power.users WHERE id IN ($1,$2)",[userA,userB]);
    assert.equal(verifyPassword("New-Fictional-A",users.rows.find((r:{id:string})=>r.id===userA).password_hash),true);
    assert.equal(verifyPassword("Old-Fictional-B",users.rows.find((r:{id:string})=>r.id===userB).password_hash),true);
    const sessions=await admin.query("SELECT user_id FROM horse_power.sessions WHERE user_id IN ($1,$2)",[userA,userB]);
    assert.deepEqual(sessions.rows.map((r:{user_id:string})=>r.user_id),[userB]);
    await admin.query("SET LOCAL ROLE hp_local_app");
    assert.equal((await admin.query("SELECT horse_power.issue_password_reset($1,$2,$3) AS email",
      [emailA,digest("ip-expired"),expired])).rows[0].email,emailA);
    await admin.query("RESET ROLE");
    await admin.query("UPDATE horse_power.password_reset_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[expired]);
    await admin.query("SET LOCAL ROLE hp_local_app");
    assert.equal((await admin.query("SELECT horse_power.complete_password_reset($1,$2) AS completed",
      [expired,hashPassword("Should-Not-Apply")])).rows[0].completed,false);
    await admin.query("RESET ROLE");
    await admin.query("ROLLBACK");
  } catch (error) {
    await admin.query("ROLLBACK").catch(()=>{});
    throw error;
  } finally { await admin.end(); }
});
