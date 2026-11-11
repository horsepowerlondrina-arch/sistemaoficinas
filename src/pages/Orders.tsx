import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Download, Filter, ChevronDown } from "lucide-react";
import { useApp } from "../lib/context";
import { money, statusLabel } from "../lib/types";
import { PageHeading, SearchBox } from "../components/ui";
import { orderFilterStorageKey, readOrderFilterSearch, saveOrderFilterSearch } from "../lib/orderFilterSession";
import { OrderTable } from "../components/OrderTable";
import { OrderResultReport } from "../components/OrderResultReport";
import {
  dateBasisLabel,
  orderResult,
  selectReportOrders,
  type OrderFilters,
} from "../lib/orderReports";
export function Orders() {
  const { data, notify, session } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filterStorageKey = orderFilterStorageKey(session.tenant.id, session.user.id);
  const filterSearch = params.toString();
  useEffect(() => {
    if (filterSearch) return;
    const saved = readOrderFilterSearch(sessionStorage, filterStorageKey);
    if (saved) setParams(saved, { replace: true });
  }, [filterStorageKey]);
  useEffect(() => {
    saveOrderFilterSearch(sessionStorage, filterStorageKey, filterSearch);
  }, [filterStorageKey, filterSearch]);
  const [search, setSearch] = useState("");
  const status = params.get("status") || "active";
  const initialStatuses =
    status === "all"
      ? []
      : status === "active"
        ? [
            "open",
            "working",
            "ready",
            ...(session.role === "owner" ? ["quote", "awaiting_payment"] : []),
          ]
        : status.split(",");
  const requestedBasis = params.get("basis");
  const filters: OrderFilters = {
    from: params.get("from") || "",
    to: params.get("to") || "",
    basis:
      requestedBasis === "completion"
        ? "completion"
        : requestedBasis === "payment" && session.role === "owner"
          ? "payment"
          : "opening",
    statuses: initialStatuses,
  };
  const [draft, setDraft] = useState(filters);
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    setDraft(JSON.parse(filterKey) as OrderFilters);
  }, [filterKey]);
  const [showReport, setShowReport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const rows = selectReportOrders(data.orders, filters, data, search, session.role === "owner");
  const financialRows = rows.filter((o) => o.status !== "quote");
  const appliedFiltersCount =
    Number(filters.statuses.length > 0) +
    Number(!!filters.from || !!filters.to) +
    Number(filters.basis !== "opening");
  const results = showReport ? financialRows.map((o) => orderResult(o, data)) : [];
  const exportExcel = async (mode: "detailed" | "compact") => {
    setExporting(true);
    try {
      const { downloadResults } = await import("../lib/reportWorkbook");
      downloadResults(
        financialRows.map((o) => orderResult(o, data)),
        filters,
        search,
        session.tenant.name,
        mode,
      );
      notify("Relatório exportado em Excel.");
    } catch {
      notify("Não foi possível exportar o relatório. Tente novamente.");
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="orders-list-page">
      <PageHeading
        eyebrow="ATENDIMENTO"
        title="Ordens de Serviço"
        description="Uma única OS, do status Orçamento até a entrega."
        actions={session.role === "owner" ? <>
          <button className="button" onClick={() => setShowReport(true)} disabled={!financialRows.length}>
            <Download size={17} />Relatório PDF / Excel
          </button>
          <button className="button primary" onClick={() => navigate("/ordens/nova?status=quote")}>
            <Plus size={18} />Nova Ordem de Serviço
          </button>
        </> : undefined}
      />
      <section className="panel">
        <div className="table-toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Buscar cliente, placa ou número..." />
        </div>
        <details className="order-filter-panel">
          <summary>
            <span className="order-filter-summary-label">
              <Filter size={16} />
              Filtros da consulta
              <small>{appliedFiltersCount} {appliedFiltersCount === 1 ? "filtro aplicado" : "filtros aplicados"}</small>
            </span>
            <ChevronDown size={17} aria-hidden="true" />
          </summary>
          <form
            className="order-report-filters"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.from && draft.to && draft.from > draft.to) {
                notify(
                  "A data inicial deve ser anterior ou igual à data final.",
                );
                return;
              }
              setParams({
                status: draft.statuses.length
                  ? draft.statuses.join(",")
                  : "all",
                basis: draft.basis,
                from: draft.from,
                to: draft.to,
              });
            }}
          >
            <div className="report-filter-dates">
              <label className="field">
                <span>Filtrar período por</span>
                <select
                  value={draft.basis}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      basis: e.target.value as OrderFilters["basis"],
                    })
                  }
                >
                  {Object.entries(dateBasisLabel)
                    .filter(
                      ([key]) => session.role === "owner" || key !== "payment",
                    )
                    .map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span>De</span>
                <input
                  type="date"
                  value={draft.from}
                  onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Até</span>
                <input
                  type="date"
                  min={draft.from}
                  value={draft.to}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                />
              </label>
            </div>
            <fieldset className="report-statuses">
              <legend>Status da OS</legend>
              <label>
                <input
                  type="checkbox"
                  checked={!draft.statuses.length}
                  onChange={() => setDraft({ ...draft, statuses: [] })}
                />{" "}
                Todas
              </label>
              {[
                ...(session.role === "owner" ? ["quote"] : []),
                "open",
                "working",
                "ready",
                "awaiting_payment",
                "completed",
                "cancelled",
              ]
                .filter(
                  (s) => session.role === "owner" || s !== "awaiting_payment",
                )
                .map((s) => (
                  <label key={s}>
                    <input
                      type="checkbox"
                      checked={draft.statuses.includes(s)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          statuses: e.target.checked
                            ? [...draft.statuses, s]
                            : draft.statuses.filter((v) => v !== s),
                        })
                      }
                    />
                    {statusLabel[s]}
                  </label>
                ))}
            </fieldset>
            <div className="report-actions">
              <button type="submit" className="button primary">
                Aplicar filtros
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  const cleared: OrderFilters = {
                    from: "",
                    to: "",
                    basis: "opening",
                    statuses: [],
                  };
                  setDraft(cleared);
                  setSearch("");
                  setParams({ status: "all" });
                }}
              >
                Limpar filtros
              </button>
            </div>
            {filters.basis === "payment" && (
              <p className="report-explanation">
                Seleciona cada OS com pagamento realizado no período uma única
                vez. O relatório apresenta o resultado completo da OS.
              </p>
            )}
          </form>
        </details>
        <OrderTable orders={rows} />
        <div className="panel-foot">
          <span>
            {rows.length} ordens de serviço
          </span>
          {session.role === "owner" && (
            <span>
              Total da consulta{" "}
              <strong>{money(rows.reduce((s, o) => s + o.total, 0))}</strong>
            </span>
          )}
        </div>
      </section>
      {showReport && session.role === "owner" && (
        <OrderResultReport
          results={results}
          filters={filters}
          search={search}
          company={session.tenant.name}
          onClose={() => setShowReport(false)}
          onExcel={(mode) => {
            if (!exporting) void exportExcel(mode);
          }}
          exporting={exporting}
        />
      )}
    </div>
  );
}
