import { createApp } from "./app.js";
import { createPostgresDatabase } from "./db/postgres.js";
import { assertDevelopmentIsolation } from "./developmentIsolation.js";
assertDevelopmentIsolation(process.env);
const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
if (!process.env.APP_ORIGIN && productionHost)
  process.env.APP_ORIGIN = `https://${productionHost}`;
if (!process.env.PUBLIC_ORIGIN)
  process.env.PUBLIC_ORIGIN = process.env.APP_ORIGIN;
if (!process.env.APP_ORIGIN) throw new Error("Configure APP_ORIGIN.");
const db = createPostgresDatabase();
export default createApp(db);
