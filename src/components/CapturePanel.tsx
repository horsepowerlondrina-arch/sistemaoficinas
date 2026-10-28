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
  source: "sky";
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
          "Atualize a extensão de teste INT-015 e recarregue a página.",
        );
      const target = await send(
        catalog
          ? `/catalog-capture/${targetId}/start`
          : `/orders/${targetId}/capture-session`,
        {
          freight_total: freight,
          batch_id: batchId,
        },
      );
      await extensionMessage("HP_CONNECT", {
        target: { ...target, orderId: targetId },
      });
      setNumber(target.number);
      if (source === "sky" && Number.isInteger(target.freight_total))
        setFreight(target.freight_total);
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
      if (item.capture_source !== "sky") continue;
      await send(
        `/orders/${targetId}/capture-items/${item.capture_receipt || item.id}`,
        { quantity: Math.max(0, Math.round(Number(item.quantity || 0))) },
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
        "Adicionar produto do Sky Peças"
      }
      description={
        catalog
          ? "Envie itens ao catálogo sem precisar abrir um orçamento. Depois, confirme as entradas físicas no estoque."
          : "Os itens capturados ficam em espera. Ajuste a quantidade e só envie ao atendimento ao clicar em Concluir captura."
      }
      onClose={() => void discard()}
    >
      <div className="modal-body capture-panel">
        <p>
          {connected
            ? `Conectado ${catalog ? "ao catálogo" : `ao atendimento #${number}`}. Vá ao fornecedor e clique em S.O. Teste • Enviar no item desejado.`
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
                "https://cliente.skypecas.com.br/"
              }
              target="_blank"
              rel="noreferrer"
            >
              Abrir Sky Peças
            </a>
          )}
        </div>
        {!connected && window.location.hostname === "sistema-oficinas-homologacao.vercel.app" && (
          <details>
            <summary>Instalar extensão de teste INT-015</summary>
            <ol>
              <li>Baixe e extraia o pacote de teste em uma pasta permanente.</li>
              <li>Abra <code>chrome://extensions</code> e ative o modo desenvolvedor.</li>
              <li>Clique em “Carregar sem compactação” e selecione a pasta extraída.</li>
              <li>No Sky Peças, use o botão “S.O. Teste • Enviar” para enviar à homologação.</li>
            </ol>
            <p className="muted">
              Esta extensão tem nome, armazenamento e conexão separados. Ela funciona somente com a homologação e pode permanecer instalada junto à extensão Horse Power da Chrome Web Store. Não remova a versão comercial.
            </p>
            <a className="button" href="/downloads/sistema-oficinas-test-extension.zip" download>
              Baixar extensão de teste INT-015 (.zip)
            </a>
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
                    : i.capture_source
                      ? "Captura anterior"
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
          {"O custo do Sky Peças, o frete rateado e o preço sugerido ficam prontos para revisão antes da conclusão. A disponibilidade do fornecedor não representa o estoque da oficina."}
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
