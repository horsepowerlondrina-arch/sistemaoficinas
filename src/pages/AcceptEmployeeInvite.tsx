import { useEffect, useState } from "react";
import { send } from "../lib/api";
import { PlatformBrand } from "../components/PlatformBrand";
export function AcceptEmployeeInvite() {
  const [token] = useState(() => window.location.hash.slice(1));
  const [info, setInfo] = useState<any>(null),
    [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
    void send("/employee-invites/info", { token })
      .then(setInfo)
      .catch((e) => setError(e.message));
  }, [token]);
  return (
    <main className="office-auth">
      <section
        className="office-auth-card"
        aria-label="Ativação de colaborador"
      >
        <PlatformBrand />
        <h1>Acesso à oficina</h1>
        {error && (
          <p role="alert" className="office-auth-error">
            {error}
          </p>
        )}
        {done ? (
          <>
            <p>Convite aceito. A conta está vinculada à oficina.</p>
            <a
              className="button primary"
              href="/inicio"
              onClick={async (e) => {
                e.preventDefault();
                await send("/logout", {}).catch(() => {});
                window.location.assign("/inicio");
              }}
            >
              Entrar no sistema
            </a>
          </>
        ) : (
          info && (
            <form
              className="office-auth-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                setBusy(true);
                setError("");
                try {
                  await send("/employee-invites/accept", {
                    token,
                    name,
                    password,
                  });
                  setPassword("");
                  setDone(true);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p>Oficina: {info.workshop_name}</p>
              <label className="field">
                <span>E-mail convidado</span>
                <input
                  type="email"
                  value={info.email}
                  readOnly
                  autoComplete="username"
                />
              </label>
              {!info.account_exists && (
                <label className="field">
                  <span>Seu nome</span>
                  <input
                    required
                    minLength={2}
                    maxLength={150}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              )}
              <label className="field">
                <span>
                  {info.account_exists
                    ? "Sua senha atual"
                    : "Crie sua senha (mínimo de 12 caracteres)"}
                </span>
                <input
                  type="password"
                  required
                  minLength={info.account_exists ? 1 : 12}
                  maxLength={200}
                  autoComplete={
                    info.account_exists ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button className="office-auth-submit" disabled={busy}>
                {busy ? "Confirmando…" : "Aceitar convite"}
              </button>
            </form>
          )
        )}
      </section>
    </main>
  );
}
