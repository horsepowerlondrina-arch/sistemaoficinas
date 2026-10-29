import express, { type Response, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { writeAdminAudit } from "./auth/platformAdmin.js";
import { transferFileSha256, TRANSFER_MEDIA_TYPE } from "../shared/transferPackage.js";
import type { PlatformPermission } from "./auth/platformAdmin.js";
import type { PlatformAdminDataTransfer } from "./services/platformAdminDataTransfer.js";
import { TransferVerificationError, type TransferVerificationFailureCode } from "./services/dataTransferVerification.js";

type Actor = { id: string; email: string };
type PermissionMiddleware = (permission: PlatformPermission) => RequestHandler;

type VerificationFailure = { status: number; code: string; message: string };
type ImportFailure = { status: number; code: string; message: string };
export function classifyPlatformAdminImportFailure(error: unknown): ImportFailure {
  const databaseCode = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code || "") : "";
  const detail = error instanceof Error ? error.message : "";
  if (/prévia.*mudou|gere uma nova prévia|dados.*mudaram/i.test(detail))
    return { status: 409, code: "stale_preview", message: "Os dados mudaram desde a prévia. Gere uma nova prévia antes de confirmar." };
  if (/aprovação.*(pendente|não corresponde|já foi utilizada)|segundo administrador/i.test(detail))
    return { status: 409, code: "approval_required", message: "A aprovação administrativa necessária está ausente, pendente ou já foi utilizada." };
  if (/proprietário autenticada|permissão|não autorizado/i.test(detail) || databaseCode === "42501")
    return { status: 403, code: "authorization", message: "A conta administrativa não possui o contexto ou a autorização necessários para esta operação." };
  if (databaseCode === "23505")
    return { status: 409, code: "unique_conflict", message: "Há um registro com identificador ou chave única conflitante. Nenhuma alteração foi mantida; revise a prévia e os conflitos." };
  if (databaseCode === "23503")
    return { status: 409, code: "relationship_conflict", message: "O pacote contém vínculos que não puderam ser preservados. Nenhuma alteração foi mantida." };
  if (/frase secreta|pacote.*inválido|versão.*pacote/i.test(detail))
    return { status: 422, code: "invalid_package", message: "O pacote .hptx é inválido ou a frase secreta não confere. Confira o arquivo e tente gerar uma nova prévia." };
  if (/^(08|25|53|57|58|XX)/.test(databaseCode))
    return { status: 503, code: "database_unavailable", message: "O banco está temporariamente indisponível. Nenhuma alteração foi mantida; tente novamente após consultar o histórico." };
  return { status: 500, code: "processing_failed", message: "Não foi possível processar a importação. Nenhuma alteração foi mantida; consulte o histórico e gere uma nova prévia antes de tentar novamente." };
}

function verificationFailure(error: unknown): VerificationFailure {
  if (error instanceof TransferVerificationError) {
    const known: Record<TransferVerificationFailureCode, VerificationFailure> = {
      invalid_package: { status: 422, code: "invalid_package", message: "Pacote inválido ou frase secreta incorreta. Confira o arquivo .hptx e tente novamente." },
      workshop_unavailable: { status: 404, code: "workshop_unavailable", message: "A oficina selecionada não está disponível para conferência." },
      authorization: { status: 403, code: "authorization", message: "Não foi possível confirmar o contexto autorizado da oficina para esta conferência." },
    };
    return known[error.code];
  }
  const databaseCode = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code || "") : "";
  if (databaseCode === "42501" || /^(08|25|53|57|58|XX)/.test(databaseCode)) {
    return { status: 503, code: "database_unavailable", message: "O serviço de dados está indisponível para conferir o pacote agora. Nenhum dado foi alterado." };
  }
  return { status: 500, code: "processing_failed", message: "Falha ao processar a conferência. Nenhum dado foi alterado; tente novamente mais tarde." };
}

export function createPlatformAdminDataTransferRoutes(
  pool: Pool,
  transfer: PlatformAdminDataTransfer | undefined,
  requireSession: RequestHandler,
  requirePermission: PermissionMiddleware,
) {
  const router=express.Router();
  const admin=(res:Response)=>res.locals.admin as Actor;
  const target=async (tenantId:string) => {
    if (!transfer) throw new Error("transfer-unavailable");
    return transfer.target(tenantId);
  };
  const audit=(actor:Actor,tenantId:string,action:string,result:"success"|"failure"|"blocked",technical:Record<string,string|number|boolean|null>={}) =>
    writeAdminAudit(pool,{actorId:actor.id,actorEmail:actor.email,subjectTenantId:tenantId,action,result,technical});
  const unavailable=(res:Response) => res.status(503).json({error:"A transferência administrativa não está disponível neste processo."});
  const packageSchema=z.object({packageText:z.string().min(1).max(4*1024*1024),passphrase:z.string().min(12).max(1024),mode:z.enum(["empty","merge","replace"])}).strict();

  router.get("/admin-api/workshops/:id/data-transfer/backups",requireSession,requirePermission("data-transfer:manage"),async(req,res)=>{
    if(!transfer)return unavailable(res);
    const tenantId=String(req.params.id);
    try { await target(tenantId); const backups=await transfer.backups(tenantId);
      await audit(admin(res),tenantId,"admin.data_transfer.backups_listed","success",{count:backups.length});
      res.set("Cache-Control","no-store").json(backups);
    } catch { res.status(400).json({error:"Não foi possível consultar as cópias de segurança desta oficina."}); }
  });
  router.get("/admin-api/workshops/:id/data-transfer/backups/:backupId",requireSession,requirePermission("data-transfer:manage"),async(req,res)=>{
    if(!transfer)return unavailable(res);
    const tenantId=String(req.params.id),backupId=String(req.params.backupId);
    try { await target(tenantId); const archive=await transfer.backup(tenantId,backupId);
      if(!archive){res.status(404).json({error:"Cópia de segurança não encontrada."});return;}
      await audit(admin(res),tenantId,"admin.data_transfer.backup_downloaded","success",{backup_id:backupId});
      res.set("Cache-Control","no-store").set("Content-Type",TRANSFER_MEDIA_TYPE)
        .set("Content-Disposition","attachment; filename=\"backup-oficina-"+new Date().toISOString().slice(0,10)+".hptx\"").send(archive);
    } catch { res.status(400).json({error:"Não foi possível baixar a cópia de segurança."}); }
  });
  router.post("/admin-api/workshops/:id/data-transfer/export",requireSession,requirePermission("data-transfer:manage"),async(req,res)=>{
    const input=z.object({passphrase:z.string().min(12).max(1024)}).strict().safeParse(req.body);
    if(!input.success){res.status(400).json({error:"Informe a frase secreta do pacote."});return;}
    if(!transfer)return unavailable(res);
    const actor=admin(res),tenantId=String(req.params.id);
    try { const result=await transfer.exportPackage(tenantId,input.data.passphrase);
      await audit(actor,tenantId,"admin.data_transfer.exported","success",{package_sha256:transferFileSha256(result.archive)});
      res.set("Cache-Control","no-store").set("Content-Type",TRANSFER_MEDIA_TYPE)
        .set("Content-Disposition","attachment; filename=\"oficina-"+new Date().toISOString().slice(0,10)+".hptx\"").send(result.archive);
    } catch { await audit(actor,tenantId,"admin.data_transfer.export_failed","failure").catch(()=>{}); res.status(400).json({error:"Não foi possível exportar os dados desta oficina."}); }
  });
  router.post("/admin-api/workshops/:id/data-transfer/preview",requireSession,requirePermission("data-transfer:manage"),async(req,res)=>{
    const input=packageSchema.safeParse(req.body);
    if(!input.success){res.status(400).json({error:"Arquivo, frase secreta ou modo inválidos. O limite online é 4 MiB."});return;}
    if(!transfer)return unavailable(res);
    const actor=admin(res),tenantId=String(req.params.id),sha=transferFileSha256(Buffer.from(input.data.packageText,"utf8"));
    try { const report=await transfer.preview(tenantId,input.data.packageText,input.data.passphrase,input.data.mode);
      await audit(actor,tenantId,"admin.data_transfer.previewed","success",{mode:input.data.mode,package_sha256:sha});
      res.set("Cache-Control","no-store").json(report);
    } catch { await audit(actor,tenantId,"admin.data_transfer.preview_failed","failure",{mode:input.data.mode,package_sha256:sha}).catch(()=>{}); res.status(400).json({error:"Não foi possível gerar a prévia do pacote."}); }
  });
  router.post("/admin-api/workshops/:id/data-transfer/verify",requireSession,requirePermission("data-transfer:manage"),async(req,res)=>{
    const input=packageSchema.safeParse(req.body);
    if(!input.success){res.status(400).json({error:"Arquivo, frase secreta ou modo inválidos. O limite online é 4 MiB."});return;}
    if(!transfer)return unavailable(res);
    const actor=admin(res),tenantId=String(req.params.id),sha=transferFileSha256(Buffer.from(input.data.packageText,"utf8"));
    let report: unknown;
    try { report=await transfer.verify(tenantId,input.data.packageText,input.data.passphrase,input.data.mode); }
    catch (error) {
      const failure=verificationFailure(error);
      await audit(actor,tenantId,"admin.data_transfer.verification_failed","failure",{mode:input.data.mode,package_sha256:sha,reason:failure.code}).catch(()=>{});
      res.status(failure.status).json({error:failure.message,code:failure.code});
      return;
    }
    try { await audit(actor,tenantId,"admin.data_transfer.verified","success",{mode:input.data.mode,package_sha256:sha}); }
    catch {
      res.status(503).json({error:"A conferência foi executada sem alterações, mas a auditoria não pôde ser confirmada. Verifique o histórico administrativo antes de repetir.",code:"audit_unavailable"});
      return;
    }
    res.set("Cache-Control","no-store").json(report);
  });

  router.get("/admin-api/workshops/:id/data-transfer/history",requireSession,requirePermission("data-transfer:manage"),async(req,res)=>{
    const tenantId=String(req.params.id);
    try {
      await target(tenantId);
      const rows=await pool.query("SELECT id,actor_email,action,result,technical_context,created_at FROM platform_admin.audit_events WHERE subject_tenant_id=$1 AND action LIKE 'admin.data_transfer.%' ORDER BY created_at DESC LIMIT 100",[tenantId]);
      res.set("Cache-Control","no-store").json(rows.rows);
    } catch { res.status(400).json({error:"Não foi possível consultar o histórico de transferências desta oficina."}); }
  });

  router.get("/admin-api/workshops/:id/data-transfer/critical-requests",requireSession,requirePermission("data-transfer:manage"),async(req,res)=>{
    if(!transfer)return unavailable(res);
    const tenantId=String(req.params.id);
    try {
      await target(tenantId);
      const prefix="data_transfer_replace:"+tenantId+":";
      const found=await pool.query("SELECT c.id,c.operation,c.requested_by,c.approved_by,c.status,c.requested_at,c.decided_at,r.email AS requester_email,a.email AS approver_email FROM platform_admin.critical_operation_requests c JOIN platform_admin.administrators r ON r.id=c.requested_by LEFT JOIN platform_admin.administrators a ON a.id=c.approved_by WHERE c.operation LIKE $1 ORDER BY c.requested_at DESC LIMIT 20",[prefix+"%"]);
      const requests=[];
      for(const row of found.rows){
        const match=String(row.operation).match(/^data_transfer_replace:[0-9a-f-]{36}:([a-f0-9]{64})$/i);
        if(!match)continue;
        const consumed=await transfer.approvalConsumed(tenantId,String(row.id));
        requests.push({id:String(row.id),packageSha256:match[1],status:consumed?"executed":row.status,requesterEmail:String(row.requester_email),approverEmail:row.approver_email?String(row.approver_email):null,requestedAt:row.requested_at,decidedAt:row.decided_at});
      }
      res.set("Cache-Control","no-store").json(requests);
    } catch { res.status(400).json({error:"Não foi possível consultar as aprovações desta oficina."}); }
  });
  router.post("/admin-api/workshops/:id/data-transfer/critical-requests",requireSession,requirePermission("data-transfer:manage"),requirePermission("critical:request"),async(req,res)=>{
    const input=z.object({packageSha256:z.string().regex(/^[a-f0-9]{64}$/i)}).strict().safeParse(req.body);
    if(!input.success){res.status(400).json({error:"Identidade do pacote inválida."});return;}
    if(!transfer)return unavailable(res);
    const actor=admin(res),tenantId=String(req.params.id),sha=input.data.packageSha256.toLowerCase();
    try {
      await target(tenantId);
      const operation="data_transfer_replace:"+tenantId+":"+sha;
      const prior=await pool.query("SELECT id,status FROM platform_admin.critical_operation_requests WHERE operation=$1 AND status IN ('requested','approved') ORDER BY requested_at DESC LIMIT 1",[operation]);
      if(prior.rowCount){res.json({id:String(prior.rows[0].id),status:prior.rows[0].status});return;}
      const id=randomUUID();
      await pool.query("INSERT INTO platform_admin.critical_operation_requests(id,operation,requested_by,status) VALUES($1,$2,$3,'requested')",[id,operation,actor.id]);
      await audit(actor,tenantId,"admin.data_transfer.replace_requested","success",{critical_request_id:id,package_sha256:sha});
      res.status(201).json({id,status:"requested"});
    } catch { await audit(actor,tenantId,"admin.data_transfer.replace_request_failed","failure",{package_sha256:sha}).catch(()=>{}); res.status(400).json({error:"Não foi possível solicitar aprovação para a substituição."}); }
  });
  router.post("/admin-api/workshops/:id/data-transfer/critical-requests/:requestId/approve",requireSession,requirePermission("data-transfer:manage"),requirePermission("critical:approve"),async(req,res)=>{
    if(!transfer)return unavailable(res);
    const actor=admin(res),tenantId=String(req.params.id),requestId=String(req.params.requestId);
    if(!/^[0-9a-f-]{32,36}$/i.test(requestId)){res.status(400).json({error:"Solicitação inválida."});return;}
    try {
      await target(tenantId);
      const prefix="data_transfer_replace:"+tenantId+":";
      const result=await pool.query("UPDATE platform_admin.critical_operation_requests SET status='approved',approved_by=$1,decided_at=now() WHERE id=$2 AND operation LIKE $3 AND status='requested' AND requested_by<>$1 RETURNING id",[actor.id,requestId,prefix+"%"]);
      if(!result.rowCount){res.status(409).json({error:"A solicitação não pode ser aprovada por esta conta ou já foi decidida."});return;}
      await audit(actor,tenantId,"admin.data_transfer.replace_approved","success",{critical_request_id:requestId});
      res.json({ok:true});
    } catch { await audit(actor,tenantId,"admin.data_transfer.replace_approval_failed","failure",{critical_request_id:requestId}).catch(()=>{}); res.status(400).json({error:"Não foi possível aprovar a substituição."}); }
  });
  router.post("/admin-api/workshops/:id/data-transfer/import",requireSession,requirePermission("data-transfer:manage"),async(req,res)=>{
    const input=z.object({packageText:z.string().min(1).max(4*1024*1024),passphrase:z.string().min(12).max(1024),confirmationId:z.string().length(64),mode:z.enum(["empty","merge","replace"]),workshopConfirmation:z.string().max(200).optional(),criticalRequestId:z.string().regex(/^[0-9a-f-]{32,36}$/i).optional(),confirm:z.literal(true)}).strict().safeParse(req.body);
    if(!input.success){res.status(400).json({error:"Confirmação de importação inválida."});return;}
    if(!transfer)return unavailable(res);
    const actor=admin(res),tenantId=String(req.params.id),packageSha=transferFileSha256(Buffer.from(input.data.packageText,"utf8"));
    let importCommitted=false;
    try {
      await target(tenantId);
      if(input.data.mode==="replace"){
        if(!input.data.criticalRequestId){res.status(409).json({error:"A substituição requer aprovação de um segundo administrador."});return;}
        const operation="data_transfer_replace:"+tenantId+":"+packageSha;
        const approved=await pool.query("SELECT id,requested_by,approved_by FROM platform_admin.critical_operation_requests WHERE id=$1 AND operation=$2 AND status='approved'",[input.data.criticalRequestId,operation]);
        if(!approved.rowCount||approved.rows[0].requested_by===approved.rows[0].approved_by){res.status(409).json({error:"A aprovação não corresponde a este pacote ou ainda está pendente."});return;}
        if(await transfer.approvalConsumed(tenantId,input.data.criticalRequestId)){res.status(409).json({error:"Esta aprovação de substituição já foi utilizada."});return;}
      } else if(input.data.criticalRequestId){res.status(400).json({error:"A aprovação crítica só se aplica ao modo Substituir."});return;}
      await audit(actor,tenantId,"admin.data_transfer.import_started","success",{mode:input.data.mode,package_sha256:packageSha,...(input.data.criticalRequestId?{critical_request_id:input.data.criticalRequestId}:{})});
      const result=await transfer.import(tenantId,input.data.packageText,input.data.passphrase,input.data.confirmationId,input.data.mode,input.data.workshopConfirmation,input.data.criticalRequestId);
      importCommitted=true;
      const action=input.data.mode==="replace"?"admin.data_transfer.replaced":input.data.mode==="merge"?"admin.data_transfer.merged":"admin.data_transfer.imported";
      await audit(actor,tenantId,action,"success",{mode:input.data.mode,package_sha256:packageSha,...(input.data.criticalRequestId?{critical_request_id:input.data.criticalRequestId}:{})});
      res.json(result);
    } catch (error) { if(importCommitted){res.status(503).json({error:"A transferência foi concluída, mas a auditoria final não foi confirmada. Consulte o histórico antes de tentar novamente.",code:"audit_unavailable"});return;} const failure=classifyPlatformAdminImportFailure(error); await audit(actor,tenantId,"admin.data_transfer.import_failed","failure",{mode:input.data.mode,package_sha256:packageSha,reason:failure.code}).catch(()=>{}); res.status(failure.status).json({error:failure.message,code:failure.code}); }
  });

  return router;
}
