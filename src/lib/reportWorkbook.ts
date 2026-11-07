import { statusLabel } from "./types";
import { displayStatus } from "./workflow";
import {
  dateBasisLabel,
  durationLabel,
  reportDate,
  reportNote,
  reportTotals,
  type OrderFilters,
  type OrderResult,
} from "./orderReports";
import { createWorkbook, type Cell, type Sheet } from "./xlsx";
const currency = (cents: number | null): Cell => cents === null ? "Custo não informado" : ({
  value: cents / 100,
  style: "money",
});
const heading = (values: string[]): Cell[] =>
  values.map((value) => ({ value, style: "bold" }));
export function resultWorkbook(
  results: OrderResult[],
  filters: OrderFilters,
  search: string,
  company: string,
  mode: "detailed" | "compact" = "detailed",
) {
  const totals = reportTotals(results);
  if (mode === "compact") {
    return createWorkbook([{
      name: "Totais por OS",
      widths: [12, 18, 20, 20, 20, 20],
      rows: [
        heading(["Totais das OS", company]),
        [dateBasisLabel[filters.basis], `De ${reportDate(filters.from)} até ${reportDate(filters.to)}`],
        ["Situações", filters.statuses.map((s) => statusLabel[s]).join(", ") || "Todas"],
        ["Pesquisa", search || "Todas"],
        [reportNote],
        [],
        heading(["OS", "Valor da OS", "Custos conhecidos", "Taxas realizadas", "Resultado estimado", "Margem (%)"]),
        ...results.map((r) => [
          r.order.number, currency(r.total), currency(r.missingCost ? null : r.productCost + r.serviceCost),
          currency(r.fees), currency(r.result),
          r.margin === null ? "—" : Math.round(r.margin * 10000) / 100,
        ]),
        ["TOTAL", currency(totals.total), currency(totals.cost), currency(totals.fees), currency(totals.result),
          results.some((r) => r.missingCost) ? "—" : totals.total ? Math.round((totals.result / totals.total) * 10000) / 100 : "—"],
      ],
    }]);
  }
  const sheets: Sheet[] = [
    {
      name: "Resumo",
      widths: [12, 32, 14, 22, ...Array(11).fill(20)],
      rows: [
        heading(["Resultado estimado da OS", company]),
        [
          dateBasisLabel[filters.basis],
          `De ${reportDate(filters.from)} até ${reportDate(filters.to)}`,
        ],
        [
          "Situações",
          filters.statuses.map((s) => statusLabel[s]).join(", ") || "Todas",
        ],
        ["Pesquisa", search || "Todas"],
        [reportNote],
        [],
        heading([
          "OS",
          "Cliente",
          "Placa",
          "Situação",
          "Abertura",
          "Finalização",
          "Venda peças",
          "Custo peças",
          "Venda serviços",
          "Custo de terceiros",
          "Desconto",
          "Valor OS",
          "Taxas realizadas",
          "Resultado estimado",
          "Margem (%)",
        ]),
        ...results.map((r) => [
          r.order.number,
          r.order.customer_name,
          r.order.plate,
          statusLabel[displayStatus(r.order)],
          reportDate(r.order.entered_on),
          reportDate(r.order.completed_on),
          currency(r.productSale),
          currency(r.missingCost ? null : r.productCost),
          currency(r.serviceSale),
          currency(r.serviceCost),
          currency(r.discount),
          currency(r.total),
          currency(r.fees),
          currency(r.result),
          r.margin === null ? "—" : Math.round(r.margin * 10000) / 100,
        ]),
        [
          "TOTAL",
          "",
          "",
          "",
          "",
          "",
          currency(results.reduce((s, r) => s + r.productSale, 0)),
          currency(results.reduce((s, r) => s + r.productCost, 0)),
          currency(results.reduce((s, r) => s + r.serviceSale, 0)),
          currency(results.reduce((s, r) => s + r.serviceCost, 0)),
          currency(results.reduce((s, r) => s + r.discount, 0)),
          currency(totals.total),
          currency(totals.fees),
          currency(totals.result),
          results.some((r) => r.missingCost) ? "—" : totals.total
            ? Math.round((totals.result / totals.total) * 10000) / 100
            : "—",
        ],
      ],
    },
    ...(["products", "services"] as const).map((kind) => ({
      name: kind === "products" ? "Peças" : "Serviços",
      widths: [12, 32, 14, 45, 12, 20, 20, 20, 20, 20, 14],
      rows: [
        heading([
          "OS",
          "Cliente",
          "Placa",
          "Descrição",
          "Quantidade",
          "Venda unitária",
          kind === "products"
            ? "Custo unitário com frete"
            : "Custo unitário de terceiros",
          "Venda total",
          "Custo total",
          "Resultado antes de desconto e taxas",
          "Duração",
        ]),
        ...results.flatMap((r) =>
          r[kind].map((i) => [
            r.order.number,
            r.order.customer_name,
            r.order.plate,
            i.name,
            i.quantity,
            currency(i.price),
            currency(i.missingCost ? null : i.cost),
            currency(i.sale),
            currency(i.missingCost ? null : i.totalCost),
            currency(i.result),
            kind === "services" ? durationLabel(i.duration_seconds) : "—",
          ]),
        ),
      ],
    })),
    {
      name: "Pagamentos",
      widths: [12, 32, 14, 20, 20, 20, 20],
      rows: [
        heading([
          "OS",
          "Cliente",
          "Pagamento realizado",
          "Forma",
          "Valor bruto",
          "Taxa",
          "Valor líquido",
        ]),
        ...results.flatMap((r) =>
          r.payments.map((p) => [
            r.order.number,
            r.order.customer_name,
            reportDate(p.day),
            p.method || "—",
            currency(p.gross),
            currency(p.fee),
            currency(p.net),
          ]),
        ),
      ],
    },
  ];
  return createWorkbook(sheets);
}
export function downloadResults(
  results: OrderResult[],
  filters: OrderFilters,
  search: string,
  company: string,
  mode: "detailed" | "compact" = "detailed",
) {
  const bytes = resultWorkbook(results, filters, search, company, mode);
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `oficina-resultado-os-${mode}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
