import { useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../lib/context";
import { money, today } from "../lib/types";
import { revenueBreakdown, workshopDate } from "../lib/workflow";
import { PageHeading, Stat, Field, Empty } from "../components/ui";
import { FinanceNav } from "./Expenses";
import { Package, Wallet } from "lucide-react";
export function ServicesProfit() {
  const { data } = useApp();
  const [from, setFrom] = useState(today().slice(0, 7) + "-01"),
    [to, setTo] = useState(today());
  const totals = revenueBreakdown(data.orders, from, to);
  const orders = data.orders.filter(
    (o) =>
      o.status === "completed" &&
      workshopDate(o.completed_on || "") >= from &&
      workshopDate(o.completed_on || "") <= to &&
      o.items.some((i) => i.kind === "service"),
  );
  return (
    <>
      <FinanceNav />
      <PageHeading
        title="Lucro dos serviços"
        description="Serviços das OS finalizadas, com desconto proporcional e custos de terceiros registrados no atendimento."
      />
      <div className="stats-grid three">
        <Stat
          detail="OS finalizadas no período"
          label="Faturamento de serviços"
          value={money(totals.services)}
          icon={<Package />}
        />
        <Stat
          detail="OS finalizadas no período"
          label="Custo de terceiros"
          value={money(totals.serviceCost)}
          icon={<Wallet />}
        />
        <Stat
          detail="OS finalizadas no período"
          label="Lucro bruto dos serviços"
          value={money(totals.serviceProfit)}
          icon={<Wallet />}
        />
      </div>
      <section className="panel work-order-section">
        <div className="form-grid">
          <Field label="Finalizadas de">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="Até">
            <input
              type="date"
              min={from}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
        </div>
        <p className="muted">
          Serviços próprios têm custo zero neste relatório. Serviços de terceiros usam o custo registrado na OS. Lucro bruto antes de taxas de cartão, mão de obra interna e despesas fixas; inclui vendas ainda a receber.
        </p>
        {orders.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>OS / serviço</th>
                  <th>Quantidade</th>
                  <th>Custo unitário de terceiros</th>
                  <th>Venda unitária</th>
                  <th>Receita de serviços / OS</th>
                  <th>Lucro bruto / OS</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const sum = revenueBreakdown([o], from, to);
                  return o.items
                    .filter((i) => i.kind === "service")
                    .map((i, n) => (
                      <tr key={i.id}>
                        <td>
                          <Link to={`/ordens/${o.id}`}>OS #{o.number}</Link>
                          <small>{i.name}</small>
                        </td>
                        <td>{i.quantity}</td>
                        <td>{money(i.cost)}</td>
                        <td>{money(i.price)}</td>
                        <td>{n === 0 ? money(sum.services) : "—"}</td>
                        <td>{n === 0 ? money(sum.serviceProfit) : "—"}</td>
                      </tr>
                    ));
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nenhuma venda de serviços no período" />
        )}
      </section>
    </>
  );
}
