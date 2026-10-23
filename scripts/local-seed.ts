import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import { hashPassword } from "../server/auth/session.js";
import { adminClient } from "./local-admin.js";
const client = adminClient();
const credentialsPath = "data/local-credentials.json";
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(721834110)");
  if ((await client.query("SELECT 1 FROM horse_power.users LIMIT 1")).rowCount)
    throw new Error("Seed exclusivo de banco vazio. Nenhum usuário ou dado existente será substituído.");
  if (existsSync(credentialsPath)) throw new Error("Arquivo de credenciais já existe; preserve-o e confira o banco antes de repetir.");
  const credentials: {email: string; password: string; tenant: string}[] = [];
  for (const suffix of ["a", "b"]) {
    const tenant = "local-" + suffix, user = "local-owner-" + suffix;
    const email = "oficina-" + suffix + "@example.test", password = randomBytes(18).toString("base64url");
    credentials.push({email, password, tenant});
    await client.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,$2)", [tenant, "Oficina Fictícia " + suffix.toUpperCase()]);
    await client.query("INSERT INTO horse_power.users(id,name,email,password_hash) VALUES($1,$2,$3,$4)", [user, "Administrador Fictício " + suffix.toUpperCase(), email, hashPassword(password)]);
    await client.query("INSERT INTO horse_power.memberships VALUES($1,$2,'owner')", [user,tenant]);
    await client.query("INSERT INTO horse_power.customers(id,tenant_id,name,email) VALUES($1,$2,$3,$4)", [tenant+"-customer",tenant,"Cliente Fictício "+suffix.toUpperCase(),"cliente-"+suffix+"@example.test"]);
    await client.query("INSERT INTO horse_power.vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES($1,$2,$3,$4,'Marca Fictícia','Modelo Fictício',2024)",[tenant+"-vehicle",tenant,tenant+"-customer", suffix==="a" ? "ABC1D23" : "DEF4G56"]);
  }
  // Tiny synthetic catalog, distinct from the external technical source.
  const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12,"0");
  await client.query("INSERT INTO service_catalog.brands VALUES($1,'Marca Fictícia')",[id(1)]);
  await client.query("INSERT INTO service_catalog.families VALUES($1,$2)",[id(2),id(1)]);
  await client.query("INSERT INTO service_catalog.bases VALUES($1,$2,1)",[id(3),id(2)]);
  const porte = (await client.query("SELECT id FROM horse_power.labor_portes ORDER BY name LIMIT 1")).rows[0].id;
  await client.query("INSERT INTO service_catalog.classifications VALUES($1,'Porte Fictício')",[porte]);
  await client.query("INSERT INTO service_catalog.services VALUES($1,'Inspeção Fictícia')",[id(4)]);
  await client.query("INSERT INTO service_catalog.models VALUES($1,$2,$3,$4,'Modelo Fictício','000000-0',1,1,$5,'[]')",[id(5),id(1),id(2),porte,id(3)]);
  await client.query("INSERT INTO service_catalog.repair_times VALUES($1,$2,NULL,$3,'Inspeção Fictícia',30,'local-demo')",[id(6),id(3),id(4)]);
  await client.query("INSERT INTO service_catalog.releases(version,status,source_sha256,model_count,time_count,application_count,validated_at) VALUES('local-ficticio','active','synthetic',1,1,1,now())");
  await client.query("INSERT INTO service_catalog.tenant_access(tenant_id,enabled,grant_reason) VALUES('local-a',true,'Fixture local fictícia'),('local-b',false,'Fixture sem liberação')");
  await client.query("INSERT INTO horse_power.labor_rates VALUES('local-a',$1,12000)",[porte]);
  // Write before COMMIT: failure to persist credentials rolls back all inserts.
  const { mkdirSync } = await import("node:fs"); mkdirSync("data",{recursive:true});
  writeFileSync(credentialsPath, JSON.stringify(credentials,null,2)+"\n", {flag:"wx", mode:0o600});
  await client.query("COMMIT");
  console.log("Duas oficinas fictícias criadas. Credenciais aleatórias somente em data/local-credentials.json (ignorado pelo Git).");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Seed local falhou:", error instanceof Error ? error.message : "erro"); process.exitCode=1;
} finally { await client.end(); }
