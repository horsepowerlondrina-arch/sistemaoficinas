import { createWorkbook, type Cell } from "./xlsx";
import type { CashReport } from "./cashReports";
const value = (cents: number): Cell => ({ value: cents / 100, style: "money" });
export function cashWorkbook(report: CashReport, company: string) {
  return createWorkbook([
    {
      name: "Resumo",
      widths: [38, 24],
      rows: [
        ["Controle de caixa", company],
        ["Início", report.filters.from],
        ["Fim", report.filters.to],
        ["Contas", report.accounts.map((a) => a.name).join(", ")],
        ["Saldo inicial do período", value(report.initial)],
        ["Saldos cadastrados no período", value(report.openings)],
        ["Entradas líquidas", value(report.entries)],
        ["Saídas", value(report.exits)],
        ["Saldo final", value(report.closing)],
        [
          "Nota",
          "Saldos cadastrados são implantação do controle, não receita da oficina. Recebimentos entram líquidos de taxas.",
        ],
      ],
    },
    {
      name: "Movimentos",
      widths: [14, 25, 45, 18, 18, 16, 16, 18, 18],
      rows: [
        [
          "Data",
          "Conta",
          "Descrição",
          "Forma",
          "Tipo",
          "Bruto recebido",
          "Taxa",
          "Movimento líquido",
          "Saldo acumulado",
        ],
        ...report.rows.map((m) => [
          m.day,
          m.account_name || "",
          m.description,
          m.method,
          m.origin === "opening"
            ? "Implantação"
            : m.origin === "adjustment"
              ? "Ajuste"
              : m.amount > 0
                ? "Entrada"
                : "Saída",
          value(m.gross_amount),
          value(m.fee_amount),
          value(m.amount),
          value(m.balance),
        ]),
      ],
    },
  ]);
}
export function downloadCashWorkbook(report: CashReport, company: string) {
  const bytes = cashWorkbook(report, company),
    url = URL.createObjectURL(
      new Blob([bytes as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
  const a = document.createElement("a");
  a.href = url;
  a.download =
    "oficina-caixa-" +
    report.filters.from +
    "-a-" +
    report.filters.to +
    ".xlsx";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
