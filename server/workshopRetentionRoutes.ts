import express from "express";
import { timingSafeEqual } from "node:crypto";
import type { DB } from "./db/transactions.js";
import type { Pool } from "pg";
import { runWorkshopRetentionDaily } from "./services/workshopRetentionRunner.js";

export function workshopRetentionRoutes(db:DB,pool:Pool,env:NodeJS.ProcessEnv=process.env){
  const app=express.Router();
  app.get('/api/retention/daily',async(req,res)=>{
    res.set('Cache-Control','no-store');
    const secret=env.CRON_SECRET||'';
    const received=Buffer.from(req.get('authorization')||'');
    const expected=Buffer.from(`Bearer ${secret}`);
    if(secret.length<32 || received.length!==expected.length || !timingSafeEqual(received,expected)){
      res.status(401).json({error:'Acesso não autorizado.'});return;
    }
    if(env.APP_ENV==='horse_power' || env.WORKSHOP_RETENTION_ENABLED!=='true'){
      res.status(503).json({error:'Retenção automática desativada.'});return;
    }
    try{
      const passphrase=env.WORKSHOP_RECOVERY_PASSPHRASE||'';
      if(Buffer.byteLength(passphrase)<12)throw new Error('missing_passphrase');
      res.json(await runWorkshopRetentionDaily(db,pool,passphrase));
    }catch{
      res.status(503).json({error:'Rotina de retenção indisponível; nenhuma exclusão foi autorizada sem validação.'});
    }
  });
  return app;
}
