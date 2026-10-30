import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { serviceTabFromSearch, type ServiceTab } from "../../shared/serviceTabs";
import { WorkshopServices } from "../components/RepairServicePicker";
import { TechnicalServiceCatalog } from "../components/TechnicalServiceCatalog";
import { PageHeading } from "../components/ui";

export function Services({ technicalCatalogEnabled }: { technicalCatalogEnabled: boolean }) {
  const [params, setParams] = useSearchParams();
  const tab = serviceTabFromSearch(params.toString());
  const [newServiceTrigger, setNewServiceTrigger] = useState(0);
  const [privateDialogOpen, setPrivateDialogOpen] = useState(false);
  const [tabNotice, setTabNotice] = useState("");

  const changeTab = (next: ServiceTab) => {
    if (next === tab) return;
    if (privateDialogOpen) {
      setTabNotice("Conclua ou cancele o cadastro aberto antes de mudar de aba. Seus dados preenchidos permanecem no formulário.");
      return;
    }
    setTabNotice("");
    const nextParams = new URLSearchParams(params);
    if (next === "times") nextParams.set("aba", "tempos");
    else nextParams.delete("aba");
    setParams(nextParams);
  };

  return <>
    <PageHeading title="Serviços" description="Gerencie serviços próprios e consulte os tempos técnicos." actions={tab === "private" ?
      <button type="button" className="button primary" onClick={() => setNewServiceTrigger((value) => value + 1)}><Plus size={16} aria-hidden="true" /> Novo serviço</button> : undefined} />
    <section className="panel service-tabs-panel">
      <div className="tabs service-tabs" role="tablist" aria-label="Tipos de serviço">
        <button type="button" role="tab" aria-selected={tab === "private"} aria-controls="private-services-panel" tabIndex={tab === "private" ? 0 : -1} className={tab === "private" ? "active" : ""} onClick={() => changeTab("private")} onKeyDown={(event) => { if (["ArrowRight", "ArrowLeft"].includes(event.key)) { event.preventDefault(); changeTab("times"); if (!privateDialogOpen && event.currentTarget.nextElementSibling instanceof HTMLElement) event.currentTarget.nextElementSibling.focus(); } }}>Serviços Próprios</button>
        <button type="button" role="tab" aria-selected={tab === "times"} aria-controls="technical-times-panel" tabIndex={tab === "times" ? 0 : -1} className={tab === "times" ? "active" : ""} onClick={() => changeTab("times")} onKeyDown={(event) => { if (["ArrowRight", "ArrowLeft"].includes(event.key)) { event.preventDefault(); changeTab("private"); if (event.currentTarget.previousElementSibling instanceof HTMLElement) event.currentTarget.previousElementSibling.focus(); } }}>Catálogo de Tempos</button>
      </div>
      {tabNotice && <p className="service-tab-notice" role="status">{tabNotice}</p>}
      <div id="private-services-panel" role="tabpanel" hidden={tab !== "private"}>
        <WorkshopServices embedded newServiceTrigger={newServiceTrigger} onFormOpenChange={setPrivateDialogOpen} />
      </div>
      {tab === "times" && <div id="technical-times-panel" role="tabpanel"><TechnicalServiceCatalog enabled={technicalCatalogEnabled} initialQuery={params.get("q") || ""} /></div>}
    </section>
  </>;
}
