import test from "node:test";
import assert from "node:assert/strict";
import { localDatabaseUrl, localEnvironment, assertLocalProcess } from "../server/localConfig";
test("local PostgreSQL accepts only loopback, dedicated DB and unprivileged role", () => {
  for (const host of ["127.0.0.1","localhost","[::1]"])
    assert.ok(localDatabaseUrl("postgresql://hp_local_app:example@"+host+":5432/horse_power_local"));
  for (const url of [undefined,"sqlite:file","postgres://hp_local_app:x@remote.example/horse_power_local","postgres://postgres:x@localhost/horse_power_local","postgres://hp_local_app:x@localhost/postgres","postgres://hp_local_app:x@localhost/horse_power_local?host=remote.example","postgres://hp_local_app:x@localhost/horse_power_local?sslmode=no-verify"])
    assert.throws(()=>localDatabaseUrl(url));
});
test("local entry rejects cloud execution and libpq overrides", () => {
  for (const env of [{VERCEL:"1"},{NODE_ENV:"production"},{PGHOST:"remote"},{PGSERVICE:"cloud"},{PGOPTIONS:"-c role=postgres"},{PGSSLMODE:"require"}])
    assert.throws(()=>assertLocalProcess(env));
});
test("local settings discard online domains, database and paid credentials", () => {
  const env: NodeJS.ProcessEnv={LOCAL_DATABASE_URL:"postgres://hp_local_app:x@127.0.0.1/horse_power_local",DATABASE_URL:"unused",APP_ORIGIN:"https://example.com",FIPEPLACA_TOKENS_JSON:"dummy"};
  assert.ok(localEnvironment(env).includes("127.0.0.1"));
  assert.equal(env.APP_ENV,"local"); assert.equal(env.ENABLE_PAID_VEHICLE_LOOKUP,"false");
  assert.equal(env.FIPEPLACA_TOKENS_JSON,undefined); assert.equal(env.APP_ORIGIN,"http://127.0.0.1:5173");
});
