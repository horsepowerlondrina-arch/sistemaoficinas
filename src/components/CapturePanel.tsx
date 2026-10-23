import { useApp } from "../lib/context";
import { productLabel, productDetails } from "../../shared/productIdentity";
import { NumericInput } from "./NumericInput";
import { useEffect, useRef, useState } from "react";
import { api, send } from "../lib/api";
import { extensionMessage } from "../lib/extension";
import { Modal } from "./ui";
import { Trash2 } from "lucide-react";
import { money, type Entity } from "../lib/types";
export function CapturePanel({
  orderId,
  source,
  onClose,
  catalog = false,
}: {
  orderId?: string;
  catalog?: boolean;
  source: "sky" | "tempario";
  onClose: (items: Entity[], committed: boolean) => Promise<void>;
}) {
  const { data } = useApp();
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [catalogId] = useState(() => crypto.randomUUID());
  const [batchId] = useState(() => crypto.randomUUID());
  const freightEditing = useRef(false);
  const editingCapture = useRef<string | null>(null);
  const targetId = catalog ? catalogId : orderId!;
  const stateUrl = catalog
    ? `/catalog-capture/${targetId}`
    : `/orders/${targetId}/capture-state`;
  const [connected, setConnected] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [items, setItems] = useState<Entity[]>([]);
  const [stagedItems, setStagedItems] = useState<Entity[]>([]);
  const [number, setNumber] = useState<number>();
  const [expires, setExpires] = useState(0);
  const [freight, setFreight] = useState(1750);
  const [freightBusy, setFreightBusy] = useState(false);
  const [plate, setPlate] = useState("");
  const [plateAutofill, setPlateAutofill] = useState(false);
  useEffect(() => {
    let current = true;
    async function load() {
      try {
        const r = await api(stateUrl);
        const status = await extensionMessage("HP_STATUS").catch(() => null);
        if (current && status && (!status.connected || typeof status.orderId === "string"))
          setConnected(status.connected && status.orderId === targetId);
        if (current) {
          setItems(r.items);
          if (!editingCapture.current)
            setStagedItems(r.staged_items || []);
          if (
            source === "sky" &&
            !freightEditing.current &&
            Number.isInteger(r.freight_total)
          )
            setFreight(r.freight_total);
        }
      } catch (e) {
        if (current) setError((e as Error).message);
      }
    }
    void load();
    const timer = setInterval(load, 2500);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [stateUrl]);
  async function connect() {
    setBusy(true);
    setError("");
    try {
      const extension = await extensionMessage("HP_STATUS");
      if (catalog && !extension.catalogCapture)
        throw new Error(
          "Atualize o Conector Horse Power para a versão 1.3 e recarregue a página.",
        );
      const target = await send(
        catalog
          ? `/catalog-capture/${targetId}/start`
          : `/orders/${targetId}/capture-session`,
        {
          freight_total: source === "sky" ? freight : 0,
          batch_id: batchId,
        },
      );
      await extensionMessage("HP_CONNECT", {
        target: { ...target, orderId: targetId },
      });
      setNumber(target.number);
      setPlate(target.plate);
      if (source === "sky" && Number.isInteger(target.freight_total))
        setFreight(target.freight_total);
      setPlateAutofill(extension.plateAutofill === true);
      setExpires(Date.now() + target.expires_minutes * 60000);
      setConnected(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveFreight() {
    if (!connected || source !== "sky" || freightBusy) return;
    setFreightBusy(true);
    setError("");
    try {
      const result = await extensionMessage("HP_SET_FREIGHT", {
        freight_total: freight,
      });
      if (Number.isInteger(result.freight_total))
        setFreight(result.freight_total);
      const state = await api(stateUrl);
      setItems(state.items);
      setStagedItems(state.staged_items || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFreightBusy(false);
    }
  }
  async function disconnect() {
    try {
      await extensionMessage("HP_DISCONNECT", { orderId: targetId });
      setConnected(false);
    } catch {
      /* The server may already have revoked the scoped connection. */
    }
  }
  async function updateCapturedItem(item: Entity, patch: Record<string, any>) {
    if (catalog || busy) return;
    setError("");
    try {
      const state = await send(
        `/orders/${targetId}/capture-items/${item.capture_receipt || item.id}`,
        patch,
        "PATCH",
      );
      setItems(state.items);
      setStagedItems(state.staged_items || []);
    } catch (e) {
      setError((e as Error).message);
      const state = await api(stateUrl);
      setItems(state.items);
      setStagedItems(state.staged_items || []);
    } finally {
      editingCapture.current = null;
    }
  }
  async function syncStagedItemsBeforeComplete() {
    if (catalog) return;
    for (const item of [...stagedItems]) {
      const patch =
        item.capture_source === "sky"
          ? { quantity: Math.max(0, Math.round(Number(item.quantity || 0))) }
          : {
              duration_seconds: Math.max(
                60,
                Math.round(Number(item.duration_seconds || 60)),
              ),
            };
      await send(
        `/orders/${targetId}/capture-items/${item.capture_receipt || item.id}`,
        patch,
        "PATCH",
      );
    }
  }
  async function complete() {
    if (busy || categoryBusy) return;
    setBusy(true);
    setError("");
    try {
      if (!catalog && source === "sky" && connected)
        await extensionMessage("HP_SET_FREIGHT", {
          freight_total: freight,
        });
      await syncStagedItemsBeforeComplete();
      const state = await send(
        catalog
          ? `/catalog-capture/${targetId}/end`
          : `/orders/${targetId}/end-capture`,
        {},
      );
      await disconnect();
      await onClose(state.items, true);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function discard() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const state = await send(
        catalog
          ? `/catalog-capture/${targetId}/end`
          : `/orders/${targetId}/discard-capture`,
        {},
      );
      await disconnect();
      await onClose(state.items, false);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={
        source === "sky"
          ? "Adicionar produto do Sky Peças"
          : "Adicionar serviço do Tempario"
      }
      description={
        catalog
          ? "Envie itens ao catálogo sem precisar abrir um orçamento. Depois, confirme as entradas físicas no estoque."
          : "Os itens capturados ficam em espera. Ajuste quantidade ou tempo e só envie ao atendimento ao clicar em Concluir captura."
      }
      onClose={() => void discard()}
    >
      <div className="modal-body capture-panel">
        <p>
          {connected
            ? `Conectado ${catalog ? "ao catálogo" : `ao atendimento #${number}`}. Vá ao fornecedor e clique em HP • Enviar no item desejado.`
            : "Conecte a extensão para definir esta tela como destino dos envios."}
        </p>
        {connected && (
          <p className="muted">
            Conexão válida até{" "}
            {new Date(expires).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
            . Ao terminar, revise os itens e clique em Concluir captura. Fechar no X descarta os itens ainda em espera.
          </p>
        )}
        {source === "sky" && (
          <label className="field">
            Frete total da compra (R$)
            <NumericInput
              type="number"
              min="0"
              step="0.01"
              disabled={freightBusy}
              value={freight / 100}
              onFocus={() => {
                freightEditing.current = true;
              }}
              onChange={(e) =>
                setFreight(Math.round(Number(e.target.value) * 100))
              }
              onBlur={() => {
                freightEditing.current = false;
                void saveFreight();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
            <small>
              Frete total da compra. O padrão é R$ 17,50. Você pode alterar a
              qualquer momento; o valor é redistribuído proporcionalmente entre
              as peças desta mesma captura, inclusive as já enviadas.
            </small>
          </label>
        )}
        <div className="capture-actions">
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() => void connect()}
          >
            {connected ? "Reconectar extensão" : "Conectar extensão"}
          </button>
          {connected && (
            <a
              className="button"
              href={
                source === "sky"
                  ? "https://cliente.skypecas.com.br/"
                  : "https://sistema.tempar.io/"
              }
              target="_blank"
              rel="noreferrer"
            >
              Abrir {source === "sky" ? "Sky Peças" : "Tempario"}
            </a>
          )}
        </div>
        {connected && !catalog && source === "tempario" && (
          <p className="muted">
            {!plateAutofill ? (
              <>
                Para enviar a placa automaticamente,{" "}
                <a href="https://chromewebstore.google.com/detail/ddmnjpmldgnjefjkachlpicngaphlobf" target="_blank" rel="noopener noreferrer">
                  instale a versão da loja
                </a>{" "}
                e recarregue as páginas. Se você usava o ZIP, remova a versão manual antes de instalar pela loja.
              </>
            ) : plate ? (
              <>
                Placa <strong>{plate}</strong>: será preenchida automaticamente
                no Tempario, inclusive se a aba já estiver aberta. Depois,
                clique em consultar no Tempario.
              </>
            ) : (
              "Este orçamento ainda não tem uma placa válida. Conclua a captura, informe o veículo no orçamento e abra novamente para enviar a placa."
            )}
          </p>
        )}
        {!connected && (
          <details>
            <summary>Como instalar a extensão</summary>
            <ol>
              <li>
                Se você instalou pelo ZIP, remova a versão manual no menu
                Extensões → Gerenciar extensões do Chrome.
              </li>
              <li>
                <a href="https://chromewebstore.google.com/detail/ddmnjpmldgnjefjkachlpicngaphlobf" target="_blank" rel="noopener noreferrer">
                  Abra o Horse Power na Chrome Web Store
                </a>.
              </li>
              <li>Clique em Usar no Chrome e confirme Adicionar extensão.</li>
              <li>
                Recarregue o sistema, Sky Peças e Tempario e conecte a captura
                novamente.
              </li>
            </ol>
          </details>
        )}
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        <h3>
          {catalog ? "Itens recebidos" : "Itens desta captura"} ·{" "}
          {(catalog ? items : stagedItems).length}
        </h3>
        <div className="capture-list">
          {(catalog ? items : stagedItems).map((i) => (
            <div key={i.id} className="capture-list-row">
              <span className="capture-item-main">
                <strong>{i.kind === "product" ? productLabel(i) : i.name}</strong>
                {i.kind === "product" && productDetails(i) && <small>{productDetails(i)}</small>}
                <small>
                  {i.capture_source === "sky"
                    ? "Sky Peças"
                    : i.capture_source === "tempario"
                      ? "Tempario"
                      : "Catálogo"}
                </small>
              {i.capture_source === "sky" && <label className="capture-inline-field">
                <span>Categoria</span>
                <select aria-label={`Categoria de ${i.name}`} value={i.category || ""} disabled={busy || categoryBusy} onChange={async (e) => {
                  const category = e.target.value;
                  setCategoryBusy(true);setError("");editingCapture.current=i.id;
                  try {
                    await send("/catalog/" + (i.catalog_id || i.id) + "/category",{category},"PATCH");
                    const state=await api(stateUrl);setItems(state.items);setStagedItems(state.staged_items || []);
                  } catch(e) {setError((e as Error).message);} finally {setCategoryBusy(false);editingCapture.current=null;}
                }}>
                  <option value="">Sem categoria</option>
                  {!!i.category && !(data.product_categories || []).some((c) => c.active && c.name===i.category) && <option value={i.category} disabled>{i.category} (anterior)</option>}
                  {(data.product_categories || []).filter((c) => c.active).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </label>}
              </span>
              {!catalog && i.capture_source === "sky" ? (
                <label className="capture-inline-field">
                  <span>Qtd.</span>
                  <NumericInput
                    type="number"
                    min="0"
                    max="1000"
                    step="1"
                    value={i.quantity}
                    onFocus={() => {
                      editingCapture.current = i.id;
                    }}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setStagedItems((current) =>
                        current.map((row) =>
                          row.id === i.id ? { ...row, quantity: value } : row,
                        ),
                      );
                    }}
                    onBlur={() =>
                      void updateCapturedItem(i, {
                        quantity: Number(
                          stagedItems.find((row) => row.id === i.id)?.quantity ??
                            i.quantity,
                        ),
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                </label>
              ) : !catalog && i.capture_source === "tempario" ? (
                <label className="capture-inline-field">
                  <span>Tempo (min)</span>
                  <NumericInput
                    type="number"
                    min="1"
                    max="60000"
                    step="1"
                    value={Math.round(Number(i.duration_seconds || 60) / 60)}
                    onFocus={() => {
                      editingCapture.current = i.id;
                    }}
                    onChange={(e) => {
                      const seconds = Math.max(
                        60,
                        Math.round(Number(e.target.value || 1) * 60),
                      );
                      setStagedItems((current) =>
                        current.map((row) =>
                          row.id === i.id
                            ? { ...row, duration_seconds: seconds }
                            : row,
                        ),
                      );
                    }}
                    onBlur={() =>
                      void updateCapturedItem(i, {
                        duration_seconds: Number(
                          stagedItems.find((row) => row.id === i.id)
                            ?.duration_seconds ?? i.duration_seconds,
                        ),
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                </label>
              ) : null}
              <span className="capture-item-value">
                <b>{money(i.price * (i.quantity || 1))}</b>
                {i.kind === "product" && (
                  <small>
                    Custo: {money(i.cost)} · Lucro/un.:{" "}
                    {money(i.price - i.cost)}
                  </small>
                )}
              </span>
              {!catalog && (
                <button
                  type="button"
                  className="icon-button danger"
                  aria-label={`Excluir ${i.name} da captura`}
                  onClick={() => void updateCapturedItem(i, { remove: true })}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="muted">
          {source === "sky"
            ? "O custo do Sky, o frete rateado e o preço sugerido ficam prontos para revisão antes da conclusão. A disponibilidade do fornecedor não representa o estoque da oficina."
            : "No Tempario, a quantidade permanece 1. Ao ajustar o tempo, o valor do serviço acompanha proporcionalmente a relação valor/tempo capturada."}
        </p>
      </div>
      <div className="modal-footer">
        <button
          type="button"
          className="button primary"
          disabled={busy || categoryBusy}
          onClick={() => void complete()}
        >
          {busy ? "Aguarde…" : "Concluir captura"}
        </button>
      </div>
    </Modal>
  );
}
