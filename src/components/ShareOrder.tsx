import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { useApp } from "../lib/context";
import { send } from "../lib/api";
import { money, type Order } from "../lib/types";
import { Modal, Field } from "./ui";
export function ShareOrder({ order, shopName, customerPhone, onOpenWhatsApp }: { order: Pick<Order,"id"|"number"|"status"|"total"|"plate"|"customer_name"|"customer_id">; shopName?:string; customerPhone?:string; onOpenWhatsApp?: () => void }) {
  const { data, session } = useApp();
  const customer = data.customers.find((c) => c.id === order.customer_id);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [url, setUrl] = useState(""),
    [expiresAt, setExpiresAt] = useState(""),
    [publicReady, setPublicReady] = useState(false);
  const [phone, setPhone] = useState(
      (customerPhone || customer?.phone || "").split("/")[0].trim(),
    ),
    [template, setTemplate] = useState(
      order.status === "quote"
        ? "quote"
        : order.status === "completed"
          ? "completed"
          : order.status === "ready"
            ? "ready"
            : "update",
    ),
    [message, setMessage] = useState("");
  const text = (link: string, type: string) =>
    `Olá${order.customer_name && order.customer_name !== "Cliente não informado" ? ", " + order.customer_name.split(" ")[0] : ""}! Aqui é da ${shopName || session.tenant.name}.\n\n${type === "quote" ? `Sua OS #${order.number} está em orçamento. Total: ${money(order.total)}.` : type === "completed" ? `Sua OS #${order.number}${order.plate ? `, referente ao veículo ${order.plate},` : ""} foi finalizada. Agradecemos pela confiança!` : type === "ready" ? `O serviço do seu veículo ${order.plate} foi concluído. Entre em contato para combinar a retirada.` : `Confira a atualização do atendimento #${order.number} do seu veículo ${order.plate}.`}\n\n${type === "completed" ? "Confira os detalhes da OS e os pagamentos registrados" : "Veja os serviços, peças e valores"}: ${link}\n\nQualquer dúvida, estamos à disposição!`;
  async function prepare() {
    setOpen(true);
    setBusy(true);
    setError("");
    try {
      const s = await send(`/orders/${order.id}/share`, {});
      const base = s.public_origin || window.location.origin;
      const shareUrl = new URL(s.path, base);
      shareUrl.searchParams.set("preview", "2");
      const link = shareUrl.toString();
      setUrl(link);
      setExpiresAt(s.expires_at || "");
      setPublicReady(
        !!s.public_origin &&
          !["localhost", "127.0.0.1", "::1"].includes(new URL(base).hostname),
      );
      setMessage(text(link, template));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = "55" + digits;
  const valid = /^55\d{10,11}$/.test(digits);
  return (
    <>
      <button className="button" onClick={() => void prepare()} disabled={busy}>
        <MessageCircle size={17} />
        WhatsApp
      </button>
      {open && (
        <Modal
          title="Compartilhar com o cliente"
          description="Revise a mensagem antes de abrir o WhatsApp. O envio é feito por você."
          onClose={() => setOpen(false)}
        >
          <div className="modal-body form-grid">
            {busy ? (
              <p>Preparando link…</p>
            ) : (
              <>
                <Field label="Mensagem">
                  <select
                    value={template}
                    onChange={(e) => {
                      setTemplate(e.target.value);
                      setMessage(text(url, e.target.value));
                    }}
                  >
                    <option value="quote">Orçamento pronto</option>
                    <option value="ready">Serviço concluído</option>
                    <option value="completed">OS finalizada</option>
                    <option value="update">Atualização da OS</option>
                  </select>
                </Field>
                <Field label="WhatsApp do cliente">
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(43) 99999-9999"
                  />
                  <small>Confira o número antes de enviar.</small>
                </Field>
                <Field label="Mensagem para o cliente" full>
                  <textarea
                    rows={9}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </Field>
                <p className="muted">
                  Este link abre um documento imutável e expira em 30 dias
                  {expiresAt ? ` (em ${new Date(expiresAt).toLocaleDateString("pt-BR")})` : ""}.
                  Compartilhar novamente cria um token novo; links revogados não são reativados.
                  Você também pode desativar os links da OS manualmente.
                </p>
                {!publicReady && (
                  <div className="error-box">
                    Prévia local: o cliente só poderá abrir este link depois que
                    o sistema tiver um endereço público configurado. O envio com
                    link está disponível após essa configuração.
                  </div>
                )}
                <a
                  className="button"
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Visualizar página do cliente
                </a>
                <button
                  className="button"
                  onClick={async () => {
                    await send(`/orders/${order.id}/revoke-share`, {});
                    setUrl("");
                    setExpiresAt("");
                    setPublicReady(false);
                    setMessage("");
                    setError(
                      "Link desativado. Feche e clique em WhatsApp para gerar outro.",
                    );
                  }}
                  disabled={!url}
                >
                  Desativar link
                </button>
              </>
            )}
            {error && <div role="alert">{error}</div>}
          </div>
          <div className="modal-footer">
            {publicReady && valid && url ? (
              <a
                className="button primary"
                href={`https://wa.me/${digits}?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => { if (onOpenWhatsApp) window.setTimeout(onOpenWhatsApp, 0); }}
              >
                Abrir WhatsApp
              </a>
            ) : (
              <button className="button" disabled>
                {!valid
                  ? "Informe um telefone válido"
                  : "Aguardando endereço público"}
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
