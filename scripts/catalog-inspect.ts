import { DatabaseSync } from "node:sqlite";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const path = process.argv[2];
if (!path) throw new Error("Uso: npm run catalog:inspect -- caminho/catalogo.sqlite");
const db = new DatabaseSync(resolve(path), { readOnly: true });
try {
  const tables = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const report = tables.map(t => {
    const name = String(t.name).replaceAll('"','""');
    return {name:t.name,ddl:t.sql,columns:db.prepare('PRAGMA table_info("'+name+'")').all(),count:db.prepare('SELECT count(*) n FROM "'+name+'"').get()?.n};
  });
  const hash=createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk);
  console.log(JSON.stringify({path:resolve(path),sha256:hash.digest("hex"),tables:report},null,2));
} finally { db.close(); }
