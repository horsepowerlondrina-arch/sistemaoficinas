import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { DB } from "./db/transactions.js";
import type { Pool } from "pg";
import { runWorkshopRetentionDaily } from "./services/workshopRetentionRunner.js";
import { recordWorkshopRetentionDelivery } from "./services/workshopRetentionNotices.js";

/** Verify the raw Standard Webhooks payload before reading any event field. */
export function verifyRetentionWebhook(body: Buffer, headers: {id?:string;timestamp?:string;signature?:string}, secret: string, now=Date.now()) {
  const {id,timestamp,signature}=headers;
  if (!secret.startsWith('whsec_') || !/^[A-Za-z0-9+/=_-]+$/.test(secret.slice(6)) ||
    !id || id.length>200 || !timestamp || !/^\d{10}$/.test(timestamp) ||
    Math.abs(now-Number(timestamp)*1000)>300_000 || !signature || body.length>262_144)
    return false;
  const key=Buffer.from(secret.slice(6),'base64');
  if (key.length<16)return false;
  const expected=createHmac('sha256',key).update(`${id}.${timestamp}.`).update(body).digest();
  return signature.split(' ').some(part=>{
    if (!part.startsWith('v1,'))return false;
    const received=Buffer.from(part.slice(3),'base64');
    return received.length===expected.length && timingSafeEqual(received,expected);
  });
}

export function workshopRetentionRoutes(db:DB,pool:Pool,env:NodeJS.ProcessEnv=process.env){
  const app=express.Router();
  app.post('/api/retention/resend/webhook',express.raw({type:'application/json',limit:'256kb'}),async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(env.APP_ENV==='horse_power' || !Buffer.isBuffer(req.body) ||
      !verifyRetentionWebhook(req.body,{
        id:req.get('svix-id'),timestamp:req.get('svix-timestamp'),signature:req.get('svix-signature'),
      },env.RESEND_RETENTION_WEBHOOK_SECRET||'')){
      res.status(401).json({error:'Notificação não autorizada.'});return;
    }
    try{
      const payload:unknown=JSON.parse(req.body.toString('utf8'));
      if(!payload || typeof payload!=='object')throw new Error('invalid_event');
      const event=payload as {type?:unknown;data?:{email_id?:unknown}};
      const kind=event.type==='email.delivered'?'delivered':
        ['email.bounced','email.suppressed','email.failed','email.complained'].includes(String(event.type))?'failed':null;
      if(kind && typeof event.data?.email_id==='string')
        await recordWorkshopRetentionDelivery(pool,event.data.email_id,kind);
      res.json({received:true});
    }catch{res.status(503).json({error:'Notificação pendente de processamento.'});}
  });
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
