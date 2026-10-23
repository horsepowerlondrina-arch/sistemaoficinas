import { workshopIdentity,formatWorkshopDocument,workshopAddress,readableHours,contrastInk } from "../../shared/workshopIdentity";
export function DocumentHeader({shop}:{shop:Record<string,unknown>}){
 const identity=workshopIdentity(shop),address=workshopAddress(identity),hours=readableHours(identity);
 return <header className="document-header" style={{borderTop:"4px solid "+identity.accent_color}}>
  {identity.document_logo?<img className="document-logo" src={identity.document_logo} alt={"Logotipo de "+identity.name}/>:<div className="document-monogram" style={{background:identity.accent_color,color:contrastInk(identity.accent_color)}} aria-hidden="true">{identity.name.split(/\s+/).slice(0,2).map(s=>s[0]).join("").toUpperCase()}</div>}
  <div className="document-company"><h1>{identity.name}</h1>
   {identity.legal_name&&identity.legal_name!==identity.name&&<p>{identity.legal_name}</p>}
   {identity.document&&<p>CPF/CNPJ: {formatWorkshopDocument(identity.document)}</p>}
   {identity.state_registration&&<p>Inscrição estadual: {identity.state_registration}</p>}
   {identity.municipal_registration&&<p>Inscrição municipal: {identity.municipal_registration}</p>}
   {address&&<p>{address}</p>}
   {identity.address&&[identity.city,identity.state].filter(Boolean).length>0&&<p>{[identity.city,identity.state].filter(Boolean).join(" / ")}</p>}
   {identity.email&&<p>{identity.email}</p>}
   {identity.website&&<p>{identity.website}</p>}{identity.instagram&&<p>{identity.instagram}</p>}
   {identity.social_links&&<p className="document-text">{identity.social_links}</p>}
   {identity.maps_url&&<p>{identity.maps_url}</p>}
   {!!hours.length&&<div className="document-hours"><b>Horários de atendimento</b>{hours.map(h=><p key={h}>{h}</p>)}</div>}
  </div>
  {(identity.phone||identity.whatsapp)&&<div className="document-contact">{identity.phone&&<p><small>Telefone</small><strong>{identity.phone}</strong></p>}{identity.whatsapp&&<p><small>WhatsApp</small><strong>{identity.whatsapp}</strong></p>}</div>}
 </header>;
}
