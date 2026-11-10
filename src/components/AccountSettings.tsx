import { useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { useApp } from "../lib/context";
import { send } from "../lib/api";

export function AccountSettings() {
  const { session } = useApp();
  const [passwordBusy,setPasswordBusy] = useState(false);
  const [passwordMessage,setPasswordMessage] = useState("");
  const [passwordError,setPasswordError] = useState("");
  async function requestPasswordChange(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(passwordBusy)return;
    setPasswordBusy(true);setPasswordError("");setPasswordMessage("");
    try {
      await send("/password-reset/request",{email:session.user.email});
      setPasswordMessage("Se este e-mail tem acesso à oficina, enviaremos um link válido por 30 minutos. Após alterar a senha, entre novamente.");
    } catch(e) {setPasswordError((e as Error).message);}
    finally {setPasswordBusy(false);}
  }
  return <>
    <section className="panel settings-card">
      <ShieldCheck size={23}/><h2>Administrador da conta</h2>
      <p><strong>{session.user.name}</strong> · Administrador</p>
      <p>{session.user.email}</p>
      <p>Usuários, permissões de módulos e situação de acesso da oficina são administrados pelo painel central. Solicite alterações ao responsável pela plataforma.</p>
    </section>
    <section className="panel settings-card">
      <h2>Alterar senha</h2>
      <p>Enviaremos um link de redefinição para o e-mail do administrador acima. O link expira em 30 minutos e funciona uma única vez.</p>
      <form onSubmit={requestPasswordChange}>
        <button className="button" type="submit" disabled={passwordBusy}>{passwordBusy?"Enviando…":"Enviar link para alterar senha"}</button>
      </form>
      {passwordMessage&&<p role="status">{passwordMessage}</p>}
      {passwordError&&<p role="alert" className="error-box">{passwordError}</p>}
    </section>
  </>;
}
