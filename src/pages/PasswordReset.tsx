import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import { PlatformBrand } from "../components/PlatformBrand";
import { send } from "../lib/api";

export function PasswordReset() {
  const [token, setToken] = useState(() => window.location.hash.slice(1));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [completed, setCompleted] = useState(false);
  const validToken = /^[a-f0-9]{64}$/.test(token);

  function requestNewLink() {
    window.history.replaceState(null, "", "/recuperar-senha");
    setToken("");
    setError("");
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (validToken) {
        if (password !== confirmation) {
          setError("As senhas precisam ser iguais.");
          return;
        }
        await send("/password-reset/complete", { token, password });
        window.history.replaceState(null, "", "/recuperar-senha");
        setToken("");
        setPassword("");
        setConfirmation("");
        setCompleted(true);
        setMessage("Senha alterada. Entre novamente na sua oficina.");
      } else {
        await send("/password-reset/request", { email });
        setMessage("Se esse e-mail possui acesso a uma oficina, enviaremos um link para redefinir a senha.");
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="office-auth">
    <section className="office-auth-card" aria-label="Recuperação de senha da oficina">
      <PlatformBrand />
      <span className="office-auth-kicker">Acesso à oficina</span>
      <h1>{completed ? "Senha alterada" : validToken ? "Crie uma nova senha" : "Recuperar senha"}</h1>
      <p>{validToken ? "O link funciona uma única vez e expira em 30 minutos." : "Informe o e-mail da sua conta de oficina."}</p>
      {token && !validToken && <p className="office-auth-error" role="alert">Este link é inválido. Solicite outro.</p>}
      {message && <p className="office-auth-success" role="status">{message}</p>}
      {error && <p className="office-auth-error" role="alert">{error}</p>}
      {!completed && <form className="office-auth-form" onSubmit={submit}>
        {validToken ? <>
          <label htmlFor="reset-password">Nova senha</label>
          <input id="reset-password" type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
          <label htmlFor="reset-confirmation">Confirme a nova senha</label>
          <input id="reset-confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} />
        </> : <>
          <label htmlFor="reset-email">E-mail da conta</label>
          <input id="reset-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
        </>}
        {(!token || validToken) && <button className="office-auth-submit" type="submit" disabled={busy}>
          {busy ? <><LoaderCircle size={18} className="spin" /> Aguarde...</> : validToken ? "Alterar senha" : "Enviar link"}
        </button>}
      </form>}
      {token && <button type="button" className="office-auth-link" onClick={requestNewLink}>Solicitar outro link</button>}
      <Link className="office-auth-link" to="/inicio">Voltar ao login</Link>
      <p className="office-auth-note">Por segurança, o link é enviado apenas ao e-mail cadastrado. A troca de senha encerra as sessões anteriores.</p>
    </section>
  </main>;
}
