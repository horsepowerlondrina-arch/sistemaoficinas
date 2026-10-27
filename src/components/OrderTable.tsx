import { useState, type KeyboardEvent } from "react";
import { ArrowUpDown, CarFront, ChevronDown, ChevronUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { money, initials, type Order } from "../lib/types";
import { useApp } from "../lib/context";
import { displayStatus } from "../lib/workflow";
import {
  isOrderOverdue,
  orderListDateLabel,
  sortOrderList,
  type OrderListSortKey,
  type SortDirection,
} from "../lib/orderList";
import { Badge, Empty } from "./ui";

const sortableColumns: { key: OrderListSortKey; label: string }[] = [
  { key: "number", label: "OS / Cliente" },
  { key: "vehicle", label: "Veículo / Placa" },
  { key: "opening", label: "Abertura" },
  { key: "due", label: "Previsão de entrega" },
  { key: "status", label: "Status" },
  { key: "total", label: "Valor" },
];

export function OrderTable({ orders }: { orders: Order[] }) {
  const navigate = useNavigate();
  const { session } = useApp();
  const isAdmin = session.role === "owner";
  const [sortKey, setSortKey] = useState<OrderListSortKey>("opening");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const sortedOrders = sortOrderList(orders, sortKey, direction);
  const openOrder = (order: Order) => navigate(`/ordens/${order.id}`);
  const toggleSort = (key: OrderListSortKey) => {
    if (!isAdmin && key === "total") return;
    if (sortKey === key) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection("asc");
    }
  };
  const handleRowKey = (event: KeyboardEvent<HTMLElement>, order: Order) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openOrder(order);
    }
  };
  const sortIndicator = (key: OrderListSortKey) =>
    sortKey === key ? (
      direction === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />
    ) : (
      <ArrowUpDown size={13} />
    );
  const header = (key: OrderListSortKey, label: string, alignRight = false) => (
    <th
      key={key}
      scope="col"
      aria-sort={sortKey === key ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={alignRight ? "align-right" : undefined}
    >
      <button type="button" className="order-sort-button" onClick={() => toggleSort(key)}>
        {label}
        <span aria-hidden="true">{sortIndicator(key)}</span>
      </button>
    </th>
  );
  if (!orders.length)
    return (
      <Empty
        title="Nenhum atendimento por aqui"
        description="Crie uma OS ou ajuste os filtros para começar."
      />
    );
  return (
    <div className="order-list-view">
      <div className="order-mobile-sort">
        <label>
          <span>Ordenar por</span>
          <select
            aria-label="Ordenar atendimentos por"
            value={sortKey}
            onChange={(event) => {
              const nextKey = event.target.value as OrderListSortKey;
              setSortKey(nextKey);
              setDirection("asc");
            }}
          >
            {sortableColumns
              .filter((column) => isAdmin || column.key !== "total")
              .map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
          </select>
        </label>
        <button
          type="button"
          className="button order-sort-direction"
          aria-label={direction === "asc" ? "Ordenação crescente" : "Ordenação decrescente"}
          onClick={() => setDirection((current) => current === "asc" ? "desc" : "asc")}
        >
          {direction === "asc" ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          {direction === "asc" ? "Crescente" : "Decrescente"}
        </button>
      </div>
      <div className="table-scroll order-table-scroll order-desktop-list">
        <table className={isAdmin ? "order-list-table" : "order-list-table order-list-table-no-value"}>
          <colgroup>
            <col className="order-col-identity" />
            <col className="order-col-vehicle" />
            <col className="order-col-date" />
            <col className="order-col-due" />
            <col className="order-col-status" />
            {isAdmin && <col className="order-col-total" />}
          </colgroup>
          <thead>
            <tr>
              {header("number", "OS / Cliente")}
              {header("vehicle", "Veículo / Placa")}
              {header("opening", "Abertura")}
              {header("due", "Previsão de entrega")}
              {header("status", "Status")}
              {isAdmin && header("total", "Valor", true)}
            </tr>
          </thead>
          <tbody>
            {sortedOrders.map((order) => {
              const overdue = isOrderOverdue(order);
              return (
                <tr
                  key={order.id}
                  className="order-list-row"
                  role="link"
                  tabIndex={0}
                  aria-label={`Abrir OS ${order.number}, ${order.customer_name || "cliente não informado"}`}
                  onClick={() => openOrder(order)}
                  onKeyDown={(event) => handleRowKey(event, order)}
                >
                  <td data-label="OS / Cliente">
                    <div className="order-list-identity">
                      <span className="avatar">{initials(order.customer_name || "?")}</span>
                      <div>
                        <button
                          type="button"
                          className="cell-link"
                          onClick={(event) => { event.stopPropagation(); openOrder(order); }}
                        >
                          OS #{order.number} <span>· {order.customer_name || "Cliente não informado"}</span>
                        </button>
                        <small>
                          {order.items.filter((item) => item.kind === "service").map((item) => item.name).join(", ") || "Sem serviços adicionados"}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td data-label="Veículo / Placa">
                    <div className="vehicle-cell">
                      <CarFront size={15} />
                      <div>
                        <span>{[order.brand, order.model].filter(Boolean).join(" ") || "Veículo não informado"}</span>
                        <small className="plate">{order.plate || "Sem placa"}</small>
                      </div>
                    </div>
                  </td>
                  <td data-label="Abertura"><span className="date-cell">{orderListDateLabel(order.entered_on)}</span></td>
                  <td data-label="Previsão de entrega" className={overdue ? "order-due-cell overdue" : "order-due-cell"}>
                    <span className="date-cell">{orderListDateLabel(order.due_on)}</span>
                    {overdue && <small className="order-overdue-label">Vencida</small>}
                  </td>
                  <td data-label="Status"><Badge status={displayStatus(order)} /></td>
                  {isAdmin && <td data-label="Valor" className="align-right money">{money(order.total)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="orders-mobile-list" aria-label="Atendimentos">
        {sortedOrders.map((order) => {
          const overdue = isOrderOverdue(order);
          return (
            <article
              key={order.id}
              className={overdue ? "order-mobile-card overdue" : "order-mobile-card"}
              role="link"
              tabIndex={0}
              aria-label={`Abrir OS ${order.number}, ${order.customer_name || "cliente não informado"}`}
              onClick={() => openOrder(order)}
              onKeyDown={(event) => handleRowKey(event, order)}
            >
              <div className="order-mobile-card-heading">
                <strong>OS #{order.number} · {order.customer_name || "Cliente não informado"}</strong>
                <Badge status={displayStatus(order)} />
              </div>
              <div className="order-mobile-vehicle">
                <CarFront size={16} />
                <span>{[order.brand, order.model].filter(Boolean).join(" ") || "Veículo não informado"}<small>{order.plate || "Sem placa"}</small></span>
              </div>
              <dl className="order-mobile-meta">
                <div><dt>Abertura</dt><dd>{orderListDateLabel(order.entered_on)}</dd></div>
                <div className={overdue ? "order-mobile-due overdue" : "order-mobile-due"}>
                  <dt>Previsão de entrega</dt>
                  <dd>{orderListDateLabel(order.due_on)}{overdue && <small>Vencida</small>}</dd>
                </div>
                {isAdmin && <div><dt>Valor</dt><dd>{money(order.total)}</dd></div>}
              </dl>
            </article>
          );
        })}
      </div>
    </div>
  );
}
