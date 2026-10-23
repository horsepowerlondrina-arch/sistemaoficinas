import { createPostgresDatabase } from "./postgres.js";
import { localEnvironment } from "../localConfig.js";
export async function createLocalDatabase() {
  const db = createPostgresDatabase(localEnvironment(), { local: true });
  try {
    const role = await db.prepare("SELECT current_user AS name, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname=current_user").get();
    if (!role || role.name !== "hp_local_app" || role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb)
      throw new Error("O backend local exige hp_local_app sem privilégios administrativos.");
    const ready = await db.prepare("SELECT version FROM local_setup.migrations WHERE version='001-local'").get();
    if (!ready) throw new Error("Execute npm run db:local:migrate.");
    return db;
  } catch (error) { await db.close(); throw error; }
}
