import app from "../server/cloud.js";
import { createVercelApiHandler } from "../server/vercelApiHandler.js";

export default createVercelApiHandler(app);
