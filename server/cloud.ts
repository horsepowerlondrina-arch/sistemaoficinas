import { createCloudRuntime } from "./cloudRuntime.js";
const { app } = await createCloudRuntime();
export default app;
