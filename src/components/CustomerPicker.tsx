import { useId, useRef, useState } from "react";
import { normalizeCustomerName } from "../../shared/customerIdentity";
import type { Entity } from "../lib/types";

export function CustomerPicker({
  customers,
  value,
  selectedId,
  onChange,
  onSelect,
  disabled = false,
}: {
  customers: Entity[];
  value: string;
  selectedId: string;
  onChange: (name: string) => void;
  onSelect: (customer: Entity) => void;
  disabled?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const options = useRef<HTMLDivElement>(null);
  const words = normalizeCustomerName(value).split(" ").filter(Boolean);
  const matches = customers
    .filter(
      (c) =>
        c.active &&
        words.every((w) => normalizeCustomerName(c.name).includes(w)),
    )
    .slice(0, 12);
  const choose = (customer: Entity) => {
    onSelect(customer);
    setOpen(false);
  };
  return (
    <div
      className="field customer-picker-field"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <span id={`${listId}-label`}>Nome do cliente</span>
      <input
        role="combobox"
        aria-labelledby={`${listId}-label`}
        aria-expanded={open && !!matches.length}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && matches[active] ? `${listId}-${active}` : undefined
        }
        value={value}
        disabled={disabled}
        maxLength={150}
        autoComplete="off"
        placeholder="Digite o nome para buscar ou cadastrar"
        onFocus={() => {
          setActive(0);
          setOpen(true);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Escape") {
            setOpen(false);
            e.stopPropagation();
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
            const next = Math.max(
              0,
              Math.min(
                matches.length - 1,
                active + (e.key === "ArrowDown" ? 1 : -1),
              ),
            );
            setActive(next);
            options.current?.children[next]?.scrollIntoView({
              block: "nearest",
            });
          }
          if (e.key === "Enter" && open && matches.length) {
            e.preventDefault();
            e.stopPropagation();
            choose(matches[active] || matches[0]);
          }
        }}
      />
      {open && !!matches.length && (
        <div
          id={listId}
          ref={options}
          role="listbox"
          aria-label="Clientes encontrados"
          className="catalog-dropdown catalog-options"
          style={{
            position: "static",
            marginTop: 4,
            maxHeight: 220,
            overflowY: "auto",
          }}
        >
          {matches.map((c, index) => (
            <button
              key={c.id}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={selectedId === c.id}
              className={index === active ? "active" : ""}
              style={{
                width: "100%",
                border: 0,
                background: index === active ? "#fff0f1" : "white",
                textAlign: "left",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(c)}
            >
              <strong>{c.name}</strong>
              <small>{c.phone || "Telefone não informado"}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
