import express, { type RequestHandler, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { BillingConflict, type StripeBilling } from "./services/stripeBilling.js";
import { verifiedStripeEvent } from "./services/stripeGateway.js";
import type { DB } from "./db/database.js";
import type { Context } from "./auth/session.js";
export function billingError(error:unknown,res:Response){
 if(error instanceof z.ZodError){res.status(400).json({error:"Confira os campos do pagamento."});return;}
 if(error instanceof BillingConflict){res.status(409).json({error:error.message});return;}
 res.status(503).json({error:"Não foi possível confirmar a cobrança. Nenhum acesso foi liberado sem confirmação. Atualize a situação e tente novamente."});
}
export function stripePublicRoutes(billing:StripeBilling,secret:string,cronSecret:string,schedulerSecret?:string){
 const app=express.Router();
 app.use((_req,res,next)=>{res.set("Cache-Control","no-store");next();});
 app.post("/api/billing/stripe/webhook",express.raw({type:"application/json",limit:"256kb"}),async(req,res)=>{
  let event;
  try{if(!Buffer.isBuffer(req.body))throw new Error();event=verifiedStripeEvent(req.body,req.get("stripe-signature")||"",secret);}
  catch{res.status(400).json({error:"Notificação inválida."});return;}
  try{await billing.webhook(event);res.json({received:true});}catch{res.status(503).json({error:"Notificação pendente de processamento."});}
 });
 app.get("/api/billing/stripe/renew",async(req,res)=>{
  const received=Buffer.from(req.get("authorization")||"");
  const authorized=[cronSecret,schedulerSecret].some(key=>{
   if(!key||key.length<32)return false;
   const expected=Buffer.from("Bearer "+key);
   return received.length===expected.length&&timingSafeEqual(received,expected);
  });
  if(!authorized){res.status(401).json({error:"Acesso não autorizado."});return;}
  try{res.json(await billing.renew());}catch(e){billingError(e,res);}
 });
 return app;
}
export function stripeWorkshopRoutes(db:DB,billing?:StripeBilling){
 const app=express.Router();
 app.use("/account/billing",(req,res,next)=>{
  const ctx:Context=res.locals.context;
  if(ctx?.role!=="owner"){res.status(403).json({error:"Somente o proprietário pode gerenciar a assinatura."});return;}
  if(!billing){if(req.method==="GET"){res.json({enabled:false,prices:[],account:null,accounts:[],payments:[],read_only:false});return;}res.status(503).json({error:"A cobrança está desabilitada neste ambiente."});return;}next();
 });
 app.get("/account/billing",async(_req,res)=>{try{res.json(await billing!.summary(res.locals.context.tenantId));}catch(e){billingError(e,res);}});
 app.post("/account/billing/checkout",async(req,res)=>{
  try{
   const ctx:Context=res.locals.context;
   const user=await db.prepare("SELECT email FROM users WHERE id=?").get(ctx.userId);
   if(!user)throw new Error("Proprietário indisponível.");
   res.json(await billing!.checkout(ctx.tenantId,String(user.email),req.body));
  }catch(e){billingError(e,res);}
 });
 app.post("/account/billing/refresh",async(_req,res)=>{try{res.json(await billing!.refresh(res.locals.context.tenantId));}catch(e){billingError(e,res);}});
 app.post("/account/billing/cancel",async(req,res)=>{
  if(req.body?.confirm!==true){res.status(400).json({error:"Confirme o cancelamento da renovação."});return;}
  try{res.json(await billing!.cancel(res.locals.context.tenantId));}catch(e){billingError(e,res);}
 });
 return app;
}
export function stripeAdminRoutes(billing:StripeBilling|undefined,session:RequestHandler,permission:(value:"platform:settings")=>RequestHandler){
 const app=express.Router();
 app.use("/admin-api/billing",session,permission("platform:settings"),(_req,res,next)=>{
  if(!billing){res.status(503).json({error:"A cobrança está desabilitada neste ambiente."});return;}next();
 });
 app.get("/admin-api/billing",async(_req,res)=>{try{res.json(await billing!.overview());}catch(e){billingError(e,res);}});
 app.post("/admin-api/billing/prices",async(req,res)=>{try{res.status(201).json(await billing!.savePrice(req.body,res.locals.admin));}catch(e){billingError(e,res);}});
 return app;
}
