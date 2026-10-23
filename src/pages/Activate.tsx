import { PlatformBrand } from "../components/PlatformBrand";
import { useState, useEffect } from "react";
import { send } from "../lib/api";
export function Activate() {
  const [token] = useState(() => window.location.hash.slice(1));
  useEffect(() => {
    history.replaceState(null, "", window.location.pathname);
  }, []);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <main className="activation-page">
      <section className="activation-card">
        <PlatformBrand />
        <h1>{done ? "Acesso ativado" : "Defina sua senha"}</h1>
        {done ? (
          <>
            <p>Seu acesso de administrador está pronto.</p>
            <a className="button primary" href="/dashboard">
              Entrar no sistema
            </a>
          </>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              if (password !== confirmation) {
                setError("As senhas precisam ser iguais.");
                return;
              }
              setBusy(true);
              try {
                await send("/setup", { token, password });
                setDone(true);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>Defina a senha da conta vinculada ao seu convite.</p>
            <label>
              Nova senha
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={200}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label>
              Confirme a senha
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={200}
                required
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
            <p>Use pelo menos 12 caracteres.</p>
            {error && <p role="alert">{error}</p>}
            <button className="button primary" disabled={busy || !token}>
              {busy ? "Salvando..." : "Ativar meu acesso"}
            </button>
            {!token && (
              <p role="alert">
                Abra o link de ativação recebido para definir sua senha.
              </p>
            )}
          </form>
        )}
      </section>
    </main>
  );
}
