import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { workshopRetentionRoutes } from "../server/workshopRetentionRoutes.js";

test("retention cron requires a secret and stays disabled by default", async () => {
  const app=express();
  const secret="c".repeat(40);
  app.use(workshopRetentionRoutes({} as never,{} as never,{CRON_SECRET:secret,APP_ENV:"development"}));
  const server=app.listen(0,"127.0.0.1");
  try{
    await new Promise<void>(resolve=>server.once('listening',resolve));
    const address=server.address();
    if(!address || typeof address==="string")throw new Error("Server unavailable");
    const url=`http://127.0.0.1:${address.port}/api/retention/daily`;
    assert.equal((await fetch(url)).status,401);
    assert.equal((await fetch(url,{headers:{Authorization:"Bearer "+"x".repeat(40)}})).status,401);
    const disabled=await fetch(url,{headers:{Authorization:`Bearer ${secret}`}});
    assert.equal(disabled.status,503);
    assert.match(await disabled.text(),/desativada/);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
