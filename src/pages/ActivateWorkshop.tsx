import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PlatformBrand } from "../components/PlatformBrand";

type ActivationPreview = {
  workshop_name: string;
  masked_email: string;
  account_exists: boolean;
  expires_at: string;
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/admin-api/workshop-activation/${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || "Não foi possível validar o convite.");
  return value as T;
}

export function ActivateWorkshop() {
  const navigate = useNavigate();
  const [token] = useState(() => window.location.hash.slice(1));
  const [preview, setPreview] = useState<ActivationPreview | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activated, setActivated] = useState(false);
  const [accountCreated, setAccountCreated] = useState(false);

  useEffect(() => {
    history.replaceState(null, "", window.location.pathname);
    if (!token) {
      setError("O link de ativação está incompleto. Solicite um novo convite à administração.");
      setLoading(false);
      return;
    }
    void post<ActivationPreview>("validate", { token })
      .then(setPreview)
      .catch((cause) => setError((cause as Error).message))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!preview || !token) return;
    if (!preview.account_exists && password !== confirmation) {
      setError("As senhas precisam ser iguais.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await post<{ account_created: boolean; tenant_id: string }>("complete", {
        token,
        ...(preview.account_exists ? {} : { password }),
      });
      setAccountCreated(result.account_created);
      setActivated(true);
      if (result.account_created) window.setTimeout(() => window.location.assign("/dashboard"), 800);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="activation-page">
      <section className="activation-card" aria-label="Ativação da oficina">
        <PlatformBrand />
        <h1>{activated ? "Oficina ativada" : "Ativar acesso da oficina"}</h1>
        {loading ? <p role="status">Validando o convite…</p> : null}
        {activated ? (
          <>
            <p>{accountCreated
              ? `O acesso de ${preview?.workshop_name} está pronto. O teste grátis de 14 dias começou agora.`
              : `O e-mail foi confirmado para ${preview?.workshop_name}. Sua senha e vínculos existentes foram preservados.`}</p>
            <a className="button primary" href={accountCreated ? "/dashboard" : "/"}>
              {accountCreated ? "Acessar oficina" : "Entrar com minha senha atual"}
            </a>
          </>
        ) : preview ? (
          <>
            <p>Confirme o acesso enviado para <strong>{preview.masked_email}</strong>.</p>
            <div className="activation-workshop-summary">
              <span>Oficina</span><strong>{preview.workshop_name}</strong>
            </div>
            <form onSubmit={submit}>
              {!preview.account_exists ? (
                <>
                  <label>
                    Crie uma senha
                    <input type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={password} onChange={(event) => setPassword(event.target.value)} />
                  </label>
                  <label>
                    Confirme a senha
                    <input type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
                  </label>
                  <p>Use pelo menos 12 caracteres. O convite expira em {new Date(preview.expires_at).toLocaleString("pt-BR")}.</p>
                </>
              ) : (
                <p>Este e-mail já possui uma conta. A senha e os outros vínculos serão mantidos; depois da confirmação, entre com sua senha atual.</p>
              )}
              {error && <p role="alert">{error}</p>}
              <button className="button primary" disabled={busy}>
                {busy ? "Ativando…" : "Confirmar e ativar oficina"}
              </button>
            </form>
          </>
        ) : !loading ? (
          <>
            {error && <p role="alert">{error}</p>}
            <button className="button primary" type="button" onClick={() => navigate("/")}>Voltar ao login</button>
          </>
        ) : null}
      </section>
    </main>
  );
}
