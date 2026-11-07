import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "./ui";
import { money, statusLabel } from "../lib/types";
import { displayStatus } from "../lib/workflow";
import {
  dateBasisLabel,
  durationLabel,
  reportDate,
  reportTotals,
  type OrderFilters,
  type OrderResult,
} from "../lib/orderReports";

function ReportContent({
  results,
  filters,
  search,
  company,
  mode,
}: {
  results: OrderResult[];
  filters: OrderFilters;
  search: string;
  company: string;
  mode: "detailed" | "compact";
}) {
  const totals = reportTotals(results);
  const missing = results.filter((r) => r.missingCost).length;
  return (
    <div className="os-result-content">
      <h1>Resultado estimado da OS · {mode === "compact" ? "compacto" : "detalhado"}</h1>
      <p>{company}</p>
      <p>
        {dateBasisLabel[filters.basis]}:{" "}
        {filters.from ? reportDate(filters.from) : "sem início"} até{" "}
        {filters.to ? reportDate(filters.to) : "sem fim"}. Situações:{" "}
        {filters.statuses.map((s) => statusLabel[s]).join(", ") || "todas"}.
        {search && ` Pesquisa: ${search}.`}
      </p>
      {missing > 0 && <p>{missing} OS com custo de peças não informado, excluídas do total de resultado. Custos apresentados são parciais.</p>}
      <div className="report-summary">
        <span>{results.length} OS</span>
        <span>
          Valor das OS <b>{money(totals.total)}</b>
        </span>
        <span>
          Custos <b>{money(totals.cost)}</b>
        </span>
        <span>
          Taxas realizadas <b>{money(totals.fees)}</b>
        </span>
        <span>
          Resultado estimado <b>{money(totals.result)}</b>
        </span>
      </div>
      {mode === "compact" ? (
        <div className="report-table-scroll">
          <table>
            <thead><tr><th>OS</th><th>Valor da OS</th><th>Custos conhecidos</th><th>Taxas realizadas</th><th>Resultado estimado</th><th>Margem</th></tr></thead>
            <tbody>
              {results.map((r) => <tr key={r.order.id}>
                <td>{r.order.number}</td>
                <td>{money(r.total)}</td>
                <td>{r.missingCost ? "Custo não informado" : money(r.productCost + r.serviceCost)}</td>
                <td>{money(r.fees)}</td>
                <td>{r.result === null ? "Custo não informado" : money(r.result)}</td>
                <td>{r.margin === null ? "—" : `${(r.margin * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      ) : results.map((r) => (
        <article className="os-result-order" key={r.order.id}>
          <h2>
            OS {r.order.number} · {r.order.customer_name}
          </h2>
          <p>
            {r.order.plate} · {statusLabel[displayStatus(r.order)]} · Abertura:{" "}
            {reportDate(r.order.entered_on)} · Finalização:{" "}
            {reportDate(r.order.completed_on)}
          </p>
          {(["products", "services"] as const).map((kind) => (
            <section key={kind}>
              <h3>{kind === "products" ? "Peças" : "Serviços"}</h3>
              <div className="report-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Descrição</th>
                      <th>Qtd.</th>
                      {kind === "services" && <th>Duração</th>}
                      <th>Venda unit.</th>
                      <th>
                        {kind === "products"
                          ? "Custo unit. com frete"
                          : "Custo unit. de terceiros"}
                      </th>
                      <th>Venda total</th>
                      <th>Custo total</th>
                      <th>Resultado*</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r[kind].map((i) => (
                      <tr key={i.id}>
                        <td>{i.name}</td>
                        <td>{i.quantity}</td>
                        {kind === "services" && (
                          <td>{durationLabel(i.duration_seconds)}</td>
                        )}
                        <td>{money(i.price)}</td>
                        <td>{i.missingCost ? "Custo não informado" : money(i.cost)}</td>
                        <td>{money(i.sale)}</td>
                        <td>{i.missingCost ? "Custo não informado" : money(i.totalCost)}</td>
                        <td>{i.result === null ? "Custo não informado" : money(i.result)}</td>
                      </tr>
                    ))}
                    {!r[kind].length && (
                      <tr>
                        <td colSpan={kind === "services" ? 8 : 7}>
                          Nenhum item.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={kind === "services" ? 5 : 4}>Subtotal</th>
                      <th>
                        {money(
                          kind === "products" ? r.productSale : r.serviceSale,
                        )}
                      </th>
                      <th>
                        {kind === "products" && r.missingCost ? "Custo não informado" : money(kind === "products" ? r.productCost : r.serviceCost)}
                      </th>
                      <th>
                        {kind === "products" && r.missingCost ? "Custo não informado" : money(kind === "products" ? r.productSale - r.productCost : r.serviceSale - r.serviceCost)}
                      </th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          ))}
          <p>* Antes do desconto e das taxas.</p>
          <h3>Pagamentos realizados</h3>
          <div className="report-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Forma</th>
                  <th>Valor bruto</th>
                  <th>Taxa</th>
                  <th>Valor líquido</th>
                </tr>
              </thead>
              <tbody>
                {r.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{reportDate(p.day)}</td>
                    <td>{p.method}</td>
                    <td>{money(p.gross)}</td>
                    <td>{money(p.fee)}</td>
                    <td>{money(p.net)}</td>
                  </tr>
                ))}
                {!r.payments.length && (
                  <tr>
                    <td colSpan={5}>Nenhum pagamento realizado.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="report-summary">
            <span>
              Desconto <b>{money(r.discount)}</b>
            </span>
            <span>
              Valor da OS <b>{money(r.total)}</b>
            </span>
            <span>
              Custos <b>{r.missingCost ? "Custo de peças não informado" : money(r.productCost + r.serviceCost)}</b>
            </span>
            <span>
              Taxas realizadas <b>{money(r.fees)}</b>
            </span>
            <span>
              Resultado estimado <b>{r.result === null ? "Custo não informado" : money(r.result)}</b>
            </span>
            <span>
              Margem estimada{" "}
              <b>
                {r.margin === null
                  ? "—"
                  : `${(r.margin * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`}
              </b>
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}
export function OrderResultReport(props: {
  results: OrderResult[];
  filters: OrderFilters;
  search: string;
  company: string;
  onClose: () => void;
  onExcel: (mode: "detailed" | "compact") => void;
  exporting: boolean;
}) {
  const [mode, setMode] = useState<"detailed" | "compact">("detailed");
  useEffect(() => {
    document.body.classList.add("printing-os-results");
    return () => document.body.classList.remove("printing-os-results");
  }, []);
  return (
    <>
      <Modal
        wide
        title="Relatório das OS selecionadas"
        description="Confira os detalhes e escolha como salvar o relatório."
        onClose={props.onClose}
      >
        <div className="modal-body">
          <div className="report-actions">
            <label><input type="radio" name="report-mode" checked={mode === "detailed"} onChange={() => setMode("detailed")} /> Detalhado</label>
            <label><input type="radio" name="report-mode" checked={mode === "compact"} onChange={() => setMode("compact")} /> Compacto</label>
            <button className="button primary" onClick={() => window.print()}>
              Imprimir / salvar PDF
            </button>
            <button
              className="button"
              onClick={() => props.onExcel(mode)}
              disabled={props.exporting}
            >
              {props.exporting ? "Gerando Excel..." : "Baixar Excel (.xlsx)"}
            </button>
          </div>
          <ReportContent {...props} mode={mode} />
        </div>
      </Modal>
      {createPortal(
        <div className="os-results-print">
          <ReportContent {...props} mode={mode} />
        </div>,
        document.body,
      )}
    </>
  );
}
