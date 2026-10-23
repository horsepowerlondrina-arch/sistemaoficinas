import { useState } from "react";
import { workshopIdentity,contrastInk } from "../../shared/workshopIdentity";
export function WorkshopBrand({ shop }: { shop: Record<string, unknown> }) {
  const identity = workshopIdentity(shop);
  const name = identity.name.trim() || "Oficina";
  const [failedLogo, setFailedLogo] = useState("");
  const logo = identity.document_logo;
  return <span className="workshop-brand" style={{borderTop:"4px solid "+identity.accent_color,paddingTop:10}}>
    {logo && logo !== failedLogo
      ? <img className="workshop-brand-logo" src={logo} alt={"Logotipo de " + name} onError={() => setFailedLogo(logo)} />
      : <span className="workshop-brand-monogram" style={{background:identity.accent_color,color:contrastInk(identity.accent_color)}} aria-hidden="true">{name.split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join("").toLocaleUpperCase("pt-BR")}</span>}
    <span className="workshop-brand-name">{name}</span>
  </span>;
}
