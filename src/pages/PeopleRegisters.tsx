import { useSearchParams } from "react-router-dom";
import { Registers } from "./Registers";
export function PeopleRegisters() {
  const [params, setParams] = useSearchParams();
  const vehicles = params.get("aba") === "veiculos";
  return (
    <Registers
      key={vehicles ? "vehicles" : "customers"}
      kind={vehicles ? "vehicles" : "customers"}
      tabs={<div className="tabs" role="tablist" aria-label="Cadastros de clientes e veículos">
        <button
          type="button"
          role="tab"
          aria-selected={!vehicles}
          className={!vehicles ? "active" : ""}
          onClick={() => setParams({ aba: "clientes" })}
        >
          Clientes
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={vehicles}
          className={vehicles ? "active" : ""}
          onClick={() => setParams({ aba: "veiculos" })}
        >
          Veículos
        </button>
      </div>}
    />
  );
}
