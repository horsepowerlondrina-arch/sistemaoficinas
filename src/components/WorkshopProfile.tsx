import { useState, useEffect, useRef, type FormEvent } from "react";
import { useApp } from "../lib/context";
import { send } from "../lib/api";
import { workshopIdentity, DAYS, type BusinessDay, type WorkshopIdentity } from "../../shared/workshopIdentity";
import { OrderPrint } from "./OrderPrint";
import { Field, Submit } from "./ui";
async function logoFromFile(file:File) {
 if(!["image/png","image/jpeg","image/webp"].includes(file.type) || file.size>5*1024*1024)
   throw new Error("Selecione PNG, JPG ou WebP de até 5 MB.");
 const url=URL.createObjectURL(file);
 try {
  const image=new Image();image.src=url;
  await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error("Não foi possível ler a imagem."));});
  const canvas=document.createElement("canvas"),context=canvas.getContext("2d");
  if(!context)throw new Error("Não foi possível preparar o logotipo.");
  let size=Math.min(900,Math.max(image.naturalWidth,image.naturalHeight));
  for(let attempt=0;attempt<10;attempt++){
   const scale=size/Math.max(image.naturalWidth,image.naturalHeight);
   canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
   canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
   context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
   const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/png"));
   if(blob && blob.size<=200*1024) return await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("Não foi possível preparar o logotipo."));reader.readAsDataURL(blob);
   });
   size=Math.floor(size*0.8);
  }
  throw new Error("A imagem é muito detalhada. Selecione um logotipo menor.");
 }finally{URL.revokeObjectURL(url);}
}
export function WorkshopProfile() {
 const {session,refreshSession,notify}=useApp();
 const [draft,setDraft]=useState<WorkshopIdentity>(()=>workshopIdentity(session.tenant));
 const [busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[error,setError]=useState("");
 const [cepBusy,setCepBusy]=useState(false),[cepMessage,setCepMessage]=useState("");
 const cepRequest=useRef<AbortController|null>(null);
 useEffect(()=>()=>cepRequest.current?.abort(),[]);
 const input=(key:keyof WorkshopIdentity,label:string,max:number,type="text")=><Field key={key} label={label}><input type={type} maxLength={max} required={key==="name"} disabled={busy} value={String(draft[key]??"")} onChange={e=>setDraft(v=>({...v,[key]:e.target.value}))}/></Field>;
 const area=(key:keyof WorkshopIdentity,label:string,max:number)=><Field key={key} label={label} full><textarea maxLength={max} rows={3} disabled={busy} value={String(draft[key]??"")} onChange={e=>setDraft(v=>({...v,[key]:e.target.value}))}/></Field>;
 async function lookupCep(){
  const postal=draft.postal_code.replace(/\D/g,"");if(!/^\d{8}$/.test(postal)){setCepMessage("Informe um CEP com 8 dígitos. O endereço pode ser preenchido manualmente.");return;}
  cepRequest.current?.abort();const controller=new AbortController();cepRequest.current=controller;
  setCepBusy(true);setCepMessage("");const timeout=setTimeout(()=>controller.abort(),8000);
  try{
   const response=await fetch("https://viacep.com.br/ws/"+postal+"/json/",{signal:controller.signal,credentials:"omit",referrerPolicy:"no-referrer"});
   if(!response.ok)throw new Error();const value=await response.json();if(value.erro)throw new Error();
   const string=(key:string)=>typeof value[key]==="string"?value[key].slice(0,150):"";
   setDraft(v=>v.postal_code.replace(/\D/g,"")===postal?{...v,street:v.street||string("logradouro"),district:v.district||string("bairro"),city:v.city||string("localidade"),state:v.state||string("uf")}:v);
   setCepMessage("Consulta concluída. Apenas campos vazios foram preenchidos; revise e edite livremente.");
  }catch{if(cepRequest.current===controller)setCepMessage("Não foi possível consultar o CEP. Preencha o endereço manualmente.");}
  finally{clearTimeout(timeout);if(cepRequest.current===controller)setCepBusy(false);}
 }
 async function save(e:FormEvent){
  e.preventDefault();if(busy||uploading)return;setBusy(true);setError("");
  try{const saved=await send("/workshop-profile",{...draft,tenant_id:session.tenant.id},"PUT");setDraft(saved);await refreshSession();notify("Dados da oficina salvos. Documentos já emitidos foram preservados.");}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 function setDay(index:number,key:keyof BusinessDay,value:string|boolean){setDraft(v=>({...v,business_hours:v.business_hours.map((day,i)=>i===index?{...day,[key]:value}:day)}));}
 return <form className="workshop-profile-form" onSubmit={save}>
  <section className="panel work-order-section"><h2>Identificação</h2><div className="form-grid">
   {input("name","Nome fantasia *",150)}{input("legal_name","Razão social",200)}
   {input("document","CPF ou CNPJ",30)}{input("state_registration","Inscrição estadual",40)}{input("municipal_registration","Inscrição municipal",40)}
  </div></section>
  <section className="panel work-order-section"><h2>Contatos</h2><div className="form-grid">
   {input("phone","Telefone",80,"tel")}{input("whatsapp","WhatsApp",80,"tel")}
   <button type="button" className="button" disabled={busy} onClick={()=>setDraft(v=>({...v,whatsapp:v.phone}))}>Copiar telefone para WhatsApp</button>
   {input("email","E-mail comercial",200,"email")}{input("website","Site (http:// ou https://)",300,"url")}{input("instagram","Instagram (URL do perfil)",300,"url")}
   {area("social_links","Outras redes sociais (um endereço http(s) por linha)",1000)}
  </div></section>
  <section className="panel work-order-section"><h2>Endereço</h2><div className="form-grid">
   {input("postal_code","CEP",9)}<button type="button" className="button" disabled={busy||cepBusy} onClick={()=>void lookupCep()}>{cepBusy?"Consultando CEP…":"Consultar CEP"}</button>
   {cepMessage&&<p role="status">{cepMessage}</p>}
   {input("street","Logradouro",200)}{input("number","Número (opcional; pode usar s/n)",30)}{input("district","Bairro",120)}{input("complement","Complemento",150)}{input("city","Cidade",100)}{input("state","UF",2)}
   {input("address","Endereço completo (opcional; preserva o cadastro anterior)",300)}{input("maps_url","Link do Google Maps (opcional)",300,"url")}
  </div><p className="muted">O endereço completo, se informado, será usado nos documentos. A consulta envia somente o CEP ao ViaCEP e nunca impede o preenchimento manual.</p></section>
  <section className="panel work-order-section"><h2>Identidade visual</h2><div className="form-grid">
   <Field label="Logotipo da oficina (PNG, JPG ou WebP · até 5 MB)" full><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||uploading} onChange={async e=>{
    const file=e.target.files?.[0];e.target.value="";if(!file)return;setUploading(true);setError("");
    try{const logo=await logoFromFile(file);setDraft(v=>({...v,document_logo:logo}));}catch(e){setError((e as Error).message);}finally{setUploading(false);}
   }}/></Field>
   {draft.document_logo&&<button type="button" className="button" disabled={busy||uploading} onClick={()=>setDraft(v=>({...v,document_logo:""}))}>Remover logotipo</button>}
   <Field label="Cor de destaque"><input type="color" disabled={busy} value={draft.accent_color} onChange={e=>setDraft(v=>({...v,accent_color:e.target.value}))}/></Field>
  </div><p className="muted">Uma única logo para interface e documentos. Sem imagem, serão exibidos nome e iniciais. O contraste do texto sobre a cor é ajustado automaticamente.</p></section>
  <section className="panel work-order-section"><h2>Horários</h2>
   <label className="schedule-enabled"><input type="checkbox" disabled={busy} checked={draft.business_hours.length>0} onChange={e=>setDraft(v=>({...v,business_hours:e.target.checked?DAYS.map((_,day)=>({day,closed:true,open:"",close:"",break_start:"",break_end:""})):[]}))}/>Informar horários de atendimento</label>
   <p className="muted">Informativos, sem bloquear o acesso ao sistema. Sem feriados ou horários especiais.</p>
   {draft.business_hours.map((day,index)=><fieldset className="business-day" key={day.day}><legend>{DAYS[day.day]}</legend>
    <label><input type="checkbox" disabled={busy} checked={day.closed} onChange={e=>setDay(index,"closed",e.target.checked)}/>Fechado</label>
    {!day.closed&&<div className="form-grid">{([["open","Abertura"],["close","Fechamento"],["break_start","Início do intervalo (opcional)"],["break_end","Fim do intervalo (opcional)"]] as const).map(([key,label])=><Field key={key} label={DAYS[day.day]+" · "+label}><input type="time" disabled={busy} required={key==="open"||key==="close"} value={day[key]} onChange={e=>setDay(index,key,e.target.value)}/></Field>)}</div>}
   </fieldset>)}
  </section>
  <section className="panel work-order-section"><h2>Documentos</h2>
   <p>Aplicados somente às novas emissões. Revisões emitidas são imutáveis; a validade comercial do orçamento não altera a validade do link compartilhado.</p><div className="form-grid">
    {area("payment_terms","Condições de pagamento",2000)}{area("warranty_text","Texto de garantia",3000)}
    <p className="muted">As condições comerciais não afastam os direitos e garantias previstos na legislação aplicável. Esse aviso acompanha os documentos e não é editável.</p>
    <Field label="Validade padrão de orçamentos em dias (0 = não informar)"><input type="number" min={0} max={365} disabled={busy} value={draft.quote_validity_days} onChange={e=>setDraft(v=>({...v,quote_validity_days:Number(e.target.value)}))}/></Field>
    {area("default_notes","Observações padrão",3000)}{area("document_footer","Rodapé dos documentos",1000)}
    {input("pix_key","Chave Pix",200)}{area("receiving_info","Informações de recebimento",2000)}
   </div><p className="muted">Informações para o cliente. Não geram cobranças, movimentações ou conciliação. Taxas e regras financeiras continuam nas abas próprias.</p>
  </section>
  <section className="panel work-order-section profile-document-preview"><h2>Prévia do documento antes de salvar</h2><p className="muted">Exemplo com os dados deste formulário. Não emite uma revisão e não salva alterações.</p>
   <OrderPrint order={{id:"preview",number:"Prévia",status:"quote",entered_on:new Date().toISOString().slice(0,10),items:[],discount:0}} tenant={{id:session.tenant.id,...draft}}/>
  </section>
  {uploading&&<p role="status">Preparando logotipo…</p>}{error&&<p className="error-box" role="alert">{error}</p>}
  <div className="capture-actions"><Submit busy={busy||uploading}>Salvar dados da oficina</Submit></div>
 </form>;
}
