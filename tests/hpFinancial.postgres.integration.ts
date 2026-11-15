import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminClient } from "../scripts/local-admin.js";
import { createLocalDatabase } from "../server/db/local.js";
import { cashControl } from "../server/services/cashControl.js";

test("Horse Power PostgreSQL 17: exact cash cents, zero/future balances and workshop isolation", async () => {
  const owner = adminClient();
  await owner.connect();
  const db = await createLocalDatabase();
  const tenant = randomUUID(), other = randomUUID(), account = randomUUID(), foreign = randomUUID();
  try {
    // This client only accepts the disposable loopback database, never Supabase.
    await owner.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,'Financeiro fictício A'),($2,'Financeiro fictício B')", [tenant, other]);
    await owner.query("INSERT INTO horse_power.cash_accounts(id,tenant_id,name,kind,opening_balance,opening_on) VALUES($1,$2,'Caixa A','cash',10000,'2000-01-01'),($3,$4,'Caixa B','cash',99999,'2000-01-01')", [account, tenant, foreign, other]);
    const ctx = { tenantId: tenant, userId: 'local-owner-a', role: 'owner' };
    await db.withRequestContext!({ 'app.tenant_id': tenant, 'app.user_id': ctx.userId }, async () => {
      let state = await cashControl(db, ctx);
      assert.equal(state.accounts.length, 1);
      assert.equal(state.accounts[0].id, account);
      assert.equal(state.accounts[0].balance, 10000);
      assert.equal(state.accounts[0].pending_receipts, 0);
      assert.equal(typeof state.accounts[0].balance, 'number');
      assert.equal(Boolean(state.accounts[0].pending_receipts), false);
      const insert = "INSERT INTO horse_power.cash_movements(id,tenant_id,account_id,day,amount,description,origin,source_id) VALUES($1,$2,$3,$4,$5,'Movimento fictício','adjustment',$1)";
      await owner.query(insert, [randomUUID(), tenant, account, '2000-01-02', 13501]);
      await owner.query(insert, [randomUUID(), tenant, account, '2000-01-02', -2500]);
      state = await cashControl(db, ctx);
      assert.equal(state.accounts[0].balance, 21001);
      assert.equal(state.accounts[0].pending_receipts, 0);
      await owner.query(insert, [randomUUID(), tenant, account, '2999-01-01', 2345]);
      state = await cashControl(db, ctx);
      assert.equal(state.accounts[0].balance, 21001);
      assert.equal(state.accounts[0].pending_receipts, 2345);
      assert.equal(Number.isSafeInteger(state.accounts[0].pending_receipts), true);
      assert.equal(state.movements.length, 3);
      assert.equal((await cashControl(db, { ...ctx, tenantId: other })).accounts.some(row => row.id === account), false);
    });
  } finally {
    await db.close();
    await owner.end();
  }
});
