import { PlatformBrand } from "../components/PlatformBrand";
import { useState, type FormEvent } from "react";
import {
  Mail,
  LockKeyhole,
  Eye,
  EyeOff,
  ArrowRight,
  LoaderCircle,
  CircleDot,
  ChartNoAxesCombined,
  ShieldCheck,
  Users,
} from "lucide-react";
import { send } from "../lib/api";
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
    <main className="hp-login">
      <div className="hp-login-scenery" aria-hidden="true" />
      <div className="hp-login-center">
        <section className="hp-login-card" aria-label="Acesso ao Sistema Oficinas">
          <div className="platform-login-heading"><PlatformBrand /></div>
          <h1>Sua oficina organizada, todos os dias</h1>
          <form onSubmit={login}>
            <label className="hp-login-field">
              <span className="sr-only">E-mail</span>
              <Mail size={21} aria-hidden="true" />
              <input
                type="email"
                placeholder="E-mail"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="hp-login-field">
              <span className="sr-only">Senha</span>
              <LockKeyhole size={21} aria-hidden="true" />
              <input
                type={visible ? "text" : "password"}
                aria-label="Senha"
                placeholder="Senha"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
              <button
                type="button"
                className="hp-login-reveal"
                aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
                aria-pressed={visible}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </label>
            <div className="hp-login-options">
              <label>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Lembrar meu e-mail
              </label>
              <span>
                <ShieldCheck size={13} />
                Acesso seguro
              </span>
            </div>
            {error && (
              <div className="hp-login-error" role="alert">
                {error}
              </div>
            )}
            <button className="hp-login-submit" type="submit" disabled={busy}>
              {busy ? (
                <>
                  <LoaderCircle size={20} className="spin" />
                  Entrando...
                </>
              ) : (
                <>
                  Entrar
                  <ArrowRight size={22} />
                </>
              )}
            </button>
          </form>
          <p className="hp-login-location">Entre para acessar sua oficina.</p>
        </section>
        <footer className="hp-login-benefits">
          {[
            [CircleDot, "Organização"],
            [ChartNoAxesCombined, "Produtividade"],
            [ShieldCheck, "Controle"],
            [Users, "Resultados"],
          ].map(([Icon, label]) => {
            const Symbol = Icon as typeof CircleDot;
            return (
              <div key={String(label)}>
                <Symbol size={23} strokeWidth={1.4} />
                <span>{String(label)}</span>
              </div>
            );
          })}
        </footer>
      </div>

    </main>
  );
}
