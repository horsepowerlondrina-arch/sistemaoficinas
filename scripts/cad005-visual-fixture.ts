import { adminClient } from "./local-admin";

// adminClient rejects cloud environments and non-loopback databases.
const db = adminClient();
await db.connect();
try {
  await db.query("BEGIN");
  if (process.argv[2] === "setup") {
    await db.query("INSERT INTO horse_power.vehicles(id,tenant_id,customer_id,plate,brand,model,year,fipe_model,model_year,fuel) VALUES('cad005-visual-vehicle','local-a','local-a-customer','CAD0A05','Marca Fictícia','Modelo legado',2020,'Modelo FIPE Fictício 1.0 Flex',2021,'Flex')");
    await db.query("INSERT INTO horse_power.orders(id,tenant_id,number,kind,status,customer_id,vehicle_id,entered_on,due_on,problem) VALUES('cad005-visual-order','local-a',(SELECT COALESCE(MAX(number),0)+1 FROM horse_power.orders WHERE tenant_id='local-a'),'quote','quote','local-a-customer','local-a-vehicle','2026-10-30','2026-10-30','Relato fictício preservado')");
  } else if (process.argv[2] === "cleanup") {
    await db.query("DELETE FROM horse_power.order_items WHERE tenant_id='local-a' AND order_id='cad005-visual-order'");
    await db.query("DELETE FROM horse_power.orders WHERE tenant_id='local-a' AND id='cad005-visual-order'");
    await db.query("DELETE FROM horse_power.vehicles WHERE tenant_id='local-a' AND id='cad005-visual-vehicle'");
  } else throw new Error("Specify setup or cleanup for the disposable fixture.");
  await db.query("COMMIT");
} catch (error) { await db.query("ROLLBACK"); throw error; }
finally { await db.end(); }
