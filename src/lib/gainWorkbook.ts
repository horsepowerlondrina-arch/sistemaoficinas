import type { gainReport } from "./gainReports";
type ReturnTypeOfGainReport = ReturnType<typeof gainReport>;
import { createWorkbook, type Cell } from "./xlsx";

const amount = (cents: number | null): Cell =>
  cents === null ? "Custo não informado" : { value: cents / 100, style: "money" };

export function gainWorkbook(report: ReturnTypeOfGainReport, company: string) {
  const kindLabel = { products: "Peças", services: "Serviços", both: "Peças e serviços" }[report.filters.kind];
  return createWorkbook([{
    name: "Ganhos",
    widths: [14, 18, 32, 18, 18, 18],
    rows: [
      [{ value: "Lucro bruto por período", style: "bold" }, company],
      ["Período", report.filters.from + " a " + report.filters.to],
      ["Tipo", kindLabel],
      ["Critério", "Data de finalização da OS"],
      ["Observação", "Lucro bruto após desconto proporcional e custos registrados. Não inclui taxas de cartão, mão de obra interna, impostos ou despesas gerais."],
      ["Custos ausentes", report.totals.missingCostOrders + " OS excluídas do total de lucro e custo"],
      [],
      ["OS", "Finalização", "Cliente", "Venda", "Custo", "Lucro bruto"],
      ...report.rows.map((row) => [
        row.order.number, row.day, row.order.customer_name,
        amount(row.sale), amount(row.missingCost ? null : row.cost), amount(row.profit),
      ]),
      ["TOTAL", "", "", amount(report.totals.sale), amount(report.totals.cost), amount(report.totals.profit)],
    ],
  }]);
}

export function downloadGainWorkbook(report: ReturnTypeOfGainReport, company: string) {
  const bytes = gainWorkbook(report, company);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `oficina-ganhos-${report.filters.kind}-${report.filters.from}-${report.filters.to}.xlsx`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
