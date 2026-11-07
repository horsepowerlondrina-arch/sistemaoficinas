import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FinanceNav } from "./Expenses";
import { useApp } from "../lib/context";
import { money, today } from "../lib/types";
import { reportDate } from "../lib/orderReports";
import { gainReport, type GainFilters } from "../lib/gainReports";
import { PageHeading, Field, Modal } from "../components/ui";

const kindLabel = { products: "Peças", services: "Serviços", both: "Peças e serviços" };

function GainContent({ report, company }: { report: ReturnType<typeof gainReport>; company: string }) {
  return <div className="os-result-content gain-report-content">
    <h1>Lucro bruto por período</h1>
    <p>{company} · {kindLabel[report.filters.kind]} · Finalização: {reportDate(report.filters.from)} a {reportDate(report.filters.to)}</p>
    <p className="report-explanation">Venda após desconto proporcional menos custo de peças e serviços de terceiros registrados na OS. Não inclui taxas de cartão, mão de obra interna, impostos ou despesas gerais. OS com custo de peça ausente não entram no total de lucro e custo.</p>
    {report.totals.missingCostOrders > 0 && <p role="status">{report.totals.missingCostOrders} OS com custo de peça não informado. A venda permanece no total, mas o lucro dessas OS não foi calculado.</p>}
    <div className="report-summary">
      <span>OS no relatório <b>{report.rows.length}</b></span>
      <span>Venda <b>{money(report.totals.sale)}</b></span>
      <span>Custo conhecido <b>{money(report.totals.cost)}</b></span>
      <span>Lucro bruto conhecido <b>{money(report.totals.profit)}</b></span>
    </div>
    <div className="report-table-scroll"><table>
      <thead><tr><th>OS</th><th>Finalização</th><th>Cliente</th><th>Venda</th><th>Custo</th><th>Lucro bruto</th></tr></thead>
      <tbody>
        {report.rows.map((row) => <tr key={row.order.id}>
          <td>{row.order.number}</td><td>{reportDate(row.day)}</td><td>{row.order.customer_name}</td>
          <td>{money(row.sale)}</td><td>{row.missingCost ? "Custo não informado" : money(row.cost)}</td>
          <td>{row.profit === null ? "Custo não informado" : money(row.profit)}</td>
        </tr>)}
        {!report.rows.length && <tr><td colSpan={6}>Nenhuma OS finalizada com {kindLabel[report.filters.kind].toLowerCase()} no período.</td></tr>}
      </tbody>
    </table></div>
  </div>;
}

export function GainsReport() {
  const { data, session, notify } = useApp();
  const day = today();
  const [draft, setDraft] = useState<GainFilters>({ from: day.slice(0, 7) + "-01", to: day, kind: "both" });
  const [filters, setFilters] = useState(draft);
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const report = gainReport(data.orders, filters);
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("printing-os-results");
    return () => document.body.classList.remove("printing-os-results");
  }, [open]);
  const exportExcel = async () => {
    setExporting(true);
    try {
      const { downloadGainWorkbook } = await import("../lib/gainWorkbook");
      downloadGainWorkbook(report, session.tenant.name);
      notify("Relatório de ganhos exportado em Excel.");
    } catch {
      notify("Não foi possível exportar o relatório.");
    } finally {
      setExporting(false);
    }
  };
  return <>
    <FinanceNav />
    <PageHeading title="Ganhos por período" description="Lucro bruto das OS finalizadas, em peças, serviços ou ambos." />
    <section className="panel gains-report-panel">
      <form className="order-report-filters" onSubmit={(event) => {
        event.preventDefault();
        if (draft.from > draft.to) { notify("A data inicial deve ser anterior ou igual à final."); return; }
        setFilters(draft);
      }}>
        <div className="report-filter-dates">
          <Field label="De"><input type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} required /></Field>
          <Field label="Até"><input type="date" min={draft.from} value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} required /></Field>
          <Field label="Tipo de ganho"><select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as GainFilters["kind"] })}>
            <option value="both">Peças e serviços</option><option value="products">Somente peças</option><option value="services">Somente serviços</option>
          </select></Field>
        </div>
        <div className="report-actions"><button type="submit" className="button primary">Aplicar filtros</button>
          <button type="button" className="button" onClick={() => setOpen(true)}>Relatório / PDF</button>
          <button type="button" className="button" disabled={exporting} onClick={() => void exportExcel()}>Baixar Excel</button>
        </div>
      </form>
      <GainContent report={report} company={session.tenant.name} />
    </section>
    {open && <>
      <Modal wide title="Relatório de ganhos" onClose={() => setOpen(false)}>
        <div className="modal-body">
          <div className="report-actions">
            <button className="button primary" onClick={() => window.print()}>Imprimir / salvar PDF</button>
            <button className="button" disabled={exporting} onClick={() => void exportExcel()}>Baixar Excel (.xlsx)</button>
          </div>
          <GainContent report={report} company={session.tenant.name} />
        </div>
      </Modal>
      {createPortal(<div className="os-results-print"><GainContent report={report} company={session.tenant.name} /></div>, document.body)}
    </>}
  </>;
}
