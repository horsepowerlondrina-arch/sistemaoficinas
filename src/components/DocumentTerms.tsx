import { workshopIdentity } from "../../shared/workshopIdentity";
export function DocumentTerms({shop,validUntil}:{shop:Record<string,unknown>;validUntil?:string}){
 const value=workshopIdentity(shop);
 return <section className="document-terms">
  {validUntil&&<p><b>Validade comercial do orçamento:</b> {validUntil.split("-").reverse().join("/")}</p>}
  {([["payment_terms","Condições de pagamento"],["warranty_text","Garantia"],["default_notes","Observações"],["pix_key","Chave Pix"],["receiving_info","Recebimento"],["document_footer",""]] as const).map(([key,label])=>value[key]?<p className="document-text" key={key}>{label&&<b>{label}: </b>}{value[key]}</p>:null)}
  <p className="document-rights">As condições comerciais não afastam os direitos e garantias previstos na legislação aplicável.</p>
 </section>;
}
