import { PlatformBrand } from "../components/PlatformBrand";
import { useState, type FormEvent } from "react";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { send } from "../lib/api";
import { Link } from "react-router-dom";
export function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem("hp-login-email") || "";
    } catch {
      return "";
    }
  });
  const [remember, setRemember] = useState(() => {
    try {
      return !!localStorage.getItem("hp-login-email");
    } catch {
      return false;
    }
  });
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function login(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await send("/login", { email, password });
      try {
        if (remember) localStorage.setItem("hp-login-email", email);
        else localStorage.removeItem("hp-login-email");
      } catch {
        /* Storage may be disabled; authentication remains available. */
      }
      await onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="office-auth">
      <section className="office-auth-card" aria-label="Acesso à Horse Power">
        <PlatformBrand />
        <span className="office-auth-kicker">Acesso à oficina</span>
        <h1>Entre na sua oficina</h1>
        <p>Use o e-mail e a senha da sua conta para continuar.</p>
        <form className="office-auth-form" onSubmit={login}>
          <label htmlFor="office-auth-email">E-mail</label>
          <input
            id="office-auth-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
          <label htmlFor="office-auth-password">Senha</label>
          <div className="office-auth-password">
            <input
              id="office-auth-password"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
            <button
              type="button"
              aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
              disabled={busy}
            >
              {visible ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
          </div>
          <Link className="office-auth-link" to="/recuperar-senha">Esqueci minha senha</Link>
          <label className="office-auth-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              disabled={busy}
            />
            Lembrar meu e-mail
          </label>
          {error && <p className="office-auth-error" role="alert">{error}</p>}
          <button className="office-auth-submit" type="submit" disabled={busy}>
            {busy ? <><LoaderCircle size={18} className="spin" /> Entrando...</> : "Entrar na oficina"}
          </button>
        </form>
        <p className="office-auth-note">Acesso exclusivo à sua oficina.</p>
      </section>
    </main>
  );
}
