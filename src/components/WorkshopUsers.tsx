import { useEffect, useState } from "react";
import { api, send } from "../lib/api";
import { useApp } from "../lib/context";
import { useUnsavedSettings } from "../lib/useUnsavedSettings";
import { Modal, Field } from "./ui";
import {
  permissionDefinitions,
  permissionKeys,
  profileDefaults,
  profileLabels,
  type UserProfile,
} from "../../shared/userPermissions";
type Row = Record<string, any>;
const blank = {
  profile: "mechanic" as UserProfile,
  active: true,
  permissions: {} as Record<string, boolean>,
  order_scope: "assigned",
  discount_bps: 0,
  discount_cents: null as number | null,
};
export function WorkshopUsers() {
  const { session, refreshSession } = useApp();
  const [data, setData] = useState<Row | null>(null),
    [staff, setStaff] = useState<Row[]>([]),
    [history, setHistory] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [editor, setEditor] = useState<Row | null>(null),
    [employee, setEmployee] = useState<Row | null>(null),
    [password, setPassword] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [pendingAction, setPendingAction] = useState<{
      id: string;
      action: string;
    } | null>(null);
  useUnsavedSettings(!!editor || !!employee || !!pendingAction);
  const load = async () => {
    try {
      const [users, employees, events] = await Promise.all([
        api<Row>("/users"),
        api<Row[]>("/staff"),
        api<Row[]>("/users/history"),
      ]);
      setData(users);
      setStaff(employees);
      setHistory(events);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, [session.tenant.id]);
  const execute = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await load();
      await refreshSession?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const open = (row?: Row) => {
    setPassword("");
    setConfirmed(false);
    setError("");
    setEditor(
      row
        ? {
            ...row,
            active: row.active === 1,
            permissions:
              typeof row.permissions === "string"
                ? JSON.parse(row.permissions)
                : row.permissions,
          }
        : { ...blank, email: "", professional_id: null },
    );
  };
  if (session.access?.profile !== "master" && session.role !== "owner")
    return null;
  const sensitive =
    editor && (editor.profile === "master" || editor.role === "owner");
  const save = () =>
    execute(async () => {
      if (sensitive) {
        if (!confirmed)
          throw new Error("Confirme a alteração envolvendo Master.");
        await send("/reauthenticate", { password });
        setPassword("");
      }
      const body = {
        profile: editor!.profile,
        active: editor!.active,
        permissions: editor!.permissions,
        order_scope: editor!.order_scope,
        discount_bps: Number(editor!.discount_bps),
        discount_cents:
          editor!.discount_cents === null
            ? null
            : Number(editor!.discount_cents),
      };
      if (editor!.user_id)
        await send(
          `/users/${encodeURIComponent(editor!.user_id)}/access`,
          body,
          "PUT",
        );
      else {
        const { active, ...access } = body;
        const result = await send("/user-invites", {
          ...access,
          email: editor!.email,
          professional_id: editor!.professional_id,
        });
        setNotice(
          result.delivered
            ? "Convite enviado."
            : "Convite reservado, mas o envio de e-mail falhou. Use Reenviar após verificar o serviço de e-mail.",
        );
      }
      setEditor(null);
    });
  return (
    <>
      <section className="panel settings-card">
        <div className="panel-heading">
          <h2>Usuários e permissões</h2>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => open()}
          >
            Convidar usuário
          </button>
        </div>
        <p>
          Contas ativas e convites pendentes consomem vagas. Funcionários sem
          login não consomem vagas.
        </p>
        {data && (
          <p role="status">
            Limite: {data.capacity.limit ?? "Não definido"} · Ativos:{" "}
            {data.capacity.active} · Convites pendentes: {data.capacity.pending}{" "}
            · Vagas disponíveis:{" "}
            {data.capacity.available ?? "Sem limite definido"}
          </p>
        )}
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Perfil</th>
                <th>Situação</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((row: Row) => (
                <tr key={row.user_id}>
                  <td>
                    {row.name}
                    <small style={{ display: "block" }}>{row.email}</small>
                  </td>
                  <td>{profileLabels[row.profile as UserProfile]}</td>
                  <td>{row.active === 1 ? "Ativo" : "Inativo"}</td>
                  <td>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => open(row)}
                    >
                      Editar acesso
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Convites</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>E-mail</th>
                <th>Perfil</th>
                <th>Situação</th>
                <th>Validade</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {data?.invites.map((row: Row) => (
                <tr key={row.id}>
                  <td>{row.email}</td>
                  <td>{profileLabels[row.profile as UserProfile]}</td>
                  <td>
                    {
                      {
                        pending: "Pendente",
                        accepted: "Aceito",
                        expired: "Expirado",
                        cancelled: "Cancelado",
                      }[row.status as string]
                    }
                  </td>
                  <td>
                    {new Date(Number(row.expires_at)).toLocaleString("pt-BR")}
                  </td>
                  <td>
                    {["pending", "expired"].includes(row.status) && (
                      <>
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() =>
                            execute(async () => {
                              if (row.profile === "master") {
                                setPassword("");
                                setConfirmed(false);
                                setPendingAction({
                                  id: row.id,
                                  action: "resend",
                                });
                                return;
                              }
                              const r = await send(
                                `/user-invites/${row.id}/resend`,
                                {},
                              );
                              setNotice(
                                r.delivered
                                  ? "Convite reenviado; o link anterior foi invalidado."
                                  : "Falha de entrega. O convite pode ser reenviado.",
                              );
                            })
                          }
                        >
                          Reenviar
                        </button>
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() => {
                            if (row.profile === "master") {
                              setPassword("");
                              setConfirmed(false);
                              setPendingAction({
                                id: row.id,
                                action: "cancel",
                              });
                            } else
                              void execute(() =>
                                send(`/user-invites/${row.id}/cancel`, {}),
                              );
                          }}
                        >
                          Cancelar convite
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel settings-card">
        <div className="panel-heading">
          <h2>Funcionários</h2>
          <button
            className="button"
            onClick={() =>
              setEmployee({
                name: "",
                role: "Mecânico",
                active: true,
                productive: true,
                user_id: null,
              })
            }
          >
            Novo funcionário
          </button>
        </div>
        <p>
          Os profissionais existentes foram preservados. O vínculo com uma conta
          é opcional.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Função</th>
                <th>Situação</th>
                <th>Produtivo</th>
                <th>Acesso vinculado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.role}</td>
                  <td>{row.active === 1 ? "Ativo" : "Inativo"}</td>
                  <td>{row.productive === 1 ? "Sim" : "Não"}</td>
                  <td>
                    {data?.items.find((u: Row) => u.user_id === row.user_id)
                      ?.name || "Sem login"}
                  </td>
                  <td>
                    <button
                      className="button"
                      onClick={() =>
                        setEmployee({
                          ...row,
                          active: row.active === 1,
                          productive: row.productive === 1,
                        })
                      }
                    >
                      Editar funcionário
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel settings-card">
        <h2>Histórico administrativo</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Ação</th>
                <th>Responsável</th>
                <th>Registro</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id}>
                  <td>{row.created_at}</td>
                  <td>
                    {(
                      {
                        "users.invited": "Convite criado",
                        "users.invite_resent": "Convite reenviado",
                        "users.invite_cancelled": "Convite cancelado",
                        "users.invite_accepted": "Convite aceito",
                        "users.access_changed": "Acesso alterado",
                        "staff.created": "Funcionário cadastrado",
                        "staff.updated": "Funcionário atualizado",
                      } as Record<string, string>
                    )[row.action] || "Alteração operacional"}
                  </td>
                  <td>
                    {data?.items.find((u: Row) => u.user_id === row.user_id)
                      ?.name || "Usuário da oficina"}
                  </td>
                  <td>
                    {data?.items.find((u: Row) => u.user_id === row.entity_id)
                      ?.name ||
                      staff.find((s) => s.id === row.entity_id)?.name ||
                      data?.invites.find((i: Row) => i.id === row.entity_id)
                        ?.email ||
                      "Registro operacional"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {editor && (
        <Modal
          title={editor.user_id ? "Editar acesso" : "Convidar usuário"}
          onClose={() => {
            if (
              !busy &&
              window.confirm("Descartar alterações deste formulário?")
            ) {
              setEditor(null);
              setPassword("");
            }
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="modal-body">
              <div className="form-grid">
                {!editor.user_id && (
                  <Field label="E-mail" full>
                    <input
                      type="email"
                      required
                      value={editor.email}
                      onChange={(e) =>
                        setEditor({ ...editor, email: e.target.value })
                      }
                    />
                  </Field>
                )}
                <Field label="Perfil inicial">
                  <select
                    value={editor.profile}
                    onChange={(e) => {
                      if (
                        window.confirm(
                          "Trocar o perfil substituirá as personalizações de permissões. Continuar?",
                        )
                      )
                        setEditor({
                          ...editor,
                          profile: e.target.value,
                          permissions: {},
                          discount_bps: e.target.value === "master" ? 10000 : 0,
                          discount_cents: null,
                        });
                    }}
                  >
                    {Object.entries(profileLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Visibilidade das OS">
                  <select
                    value={editor.order_scope}
                    disabled={editor.profile === "master"}
                    onChange={(e) =>
                      setEditor({ ...editor, order_scope: e.target.value })
                    }
                  >
                    <option value="all">Todas as OS</option>
                    <option value="assigned">Somente OS atribuídas</option>
                  </select>
                </Field>
                <Field label="Limite de desconto (%)">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    disabled={editor.profile === "master"}
                    value={editor.discount_bps / 100}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        discount_bps: Math.round(Number(e.target.value) * 100),
                      })
                    }
                  />
                </Field>
                <Field label="Limite adicional em reais (opcional)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={editor.profile === "master"}
                    value={
                      editor.discount_cents === null
                        ? ""
                        : editor.discount_cents / 100
                    }
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        discount_cents:
                          e.target.value === ""
                            ? null
                            : Math.round(Number(e.target.value) * 100),
                      })
                    }
                  />
                </Field>
                {editor.user_id ? (
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={editor.active}
                      disabled={
                        editor.user_id === session.user.id &&
                        editor.role === "owner"
                      }
                      onChange={(e) =>
                        setEditor({ ...editor, active: e.target.checked })
                      }
                    />
                    Acesso ativo
                  </label>
                ) : (
                  <Field label="Funcionário existente (opcional)">
                    <select
                      value={editor.professional_id || ""}
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          professional_id: e.target.value || null,
                        })
                      }
                    >
                      <option value="">Sem vínculo</option>
                      {staff
                        .filter((s) => s.active === 1 && !s.user_id)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
                <div className="full">
                  <h3>Permissões individuais</h3>
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Restaurar as permissões originais deste perfil?",
                        )
                      )
                        setEditor({ ...editor, permissions: {} });
                    }}
                  >
                    Restaurar padrão do perfil
                  </button>
                  <div className="form-grid">
                    {permissionKeys.map((key) => (
                      <label className="checkbox-row" key={key}>
                        <input
                          type="checkbox"
                          disabled={
                            editor.profile === "master" ||
                            key === "users.manage" ||
                            session.modules?.[permissionDefinitions[key][0]] ===
                              false
                          }
                          checked={
                            editor.permissions[key] ??
                            profileDefaults(editor.profile)[key]
                          }
                          onChange={(e) =>
                            setEditor({
                              ...editor,
                              permissions: {
                                ...editor.permissions,
                                [key]: e.target.checked,
                              },
                            })
                          }
                        />
                        {permissionDefinitions[key][1]}
                      </label>
                    ))}
                  </div>
                  <p>
                    Permissões dependentes só funcionam quando suas ações
                    básicas e o módulo contratado estão habilitados.
                  </p>
                </div>
                {sensitive && (
                  <>
                    <Field label="Sua senha atual" full>
                      <input
                        type="password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </Field>
                    <label className="checkbox-row full">
                      <input
                        type="checkbox"
                        required
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      Confirmo a alteração administrativa envolvendo Master.
                    </label>
                  </>
                )}
                {error && (
                  <p className="error-box full" role="alert">
                    {error}
                  </p>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditor(null);
                  setPassword("");
                }}
              >
                Cancelar
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? "Salvando…" : "Salvar acesso"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {pendingAction && (
        <Modal
          title="Confirmar alteração de convite Master"
          onClose={() => {
            setPendingAction(null);
            setPassword("");
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void execute(async () => {
                if (!confirmed) throw new Error("Confirme a alteração.");
                await send("/reauthenticate", { password });
                setPassword("");
                const result = await send(
                  `/user-invites/${pendingAction.id}/${pendingAction.action}`,
                  {},
                );
                setNotice(
                  result.delivered === false
                    ? "O envio falhou; tente reenviar novamente."
                    : "Convite atualizado.",
                );
                setPendingAction(null);
              });
            }}
          >
            <div className="modal-body">
              <Field label="Sua senha atual">
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                Confirmo a alteração deste convite Master.
              </label>
              {error && (
                <p className="error-box" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button className="button primary" disabled={busy}>
                Confirmar alteração
              </button>
            </div>
          </form>
        </Modal>
      )}
      {employee && (
        <Modal
          title={employee.id ? "Editar funcionário" : "Novo funcionário"}
          onClose={() => setEmployee(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void execute(async () => {
                const { name, role, active, productive, user_id } = employee;
                await send(
                  "/staff" + (employee.id ? "/" + employee.id : ""),
                  { name, role, active, productive, user_id },
                  employee.id ? "PUT" : "POST",
                );
                setEmployee(null);
              });
            }}
          >
            <div className="modal-body form-grid">
              <Field label="Nome">
                <input
                  required
                  value={employee.name}
                  onChange={(e) =>
                    setEmployee({ ...employee, name: e.target.value })
                  }
                />
              </Field>
              <Field label="Função">
                <input
                  required
                  value={employee.role}
                  onChange={(e) =>
                    setEmployee({ ...employee, role: e.target.value })
                  }
                />
              </Field>
              <Field label="Conta vinculada">
                <select
                  value={employee.user_id || ""}
                  onChange={(e) =>
                    setEmployee({
                      ...employee,
                      user_id: e.target.value || null,
                    })
                  }
                >
                  <option value="">Sem login</option>
                  {data?.items.map((u: Row) => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={employee.active}
                  onChange={(e) =>
                    setEmployee({ ...employee, active: e.target.checked })
                  }
                />
                Funcionário ativo
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={employee.productive}
                  onChange={(e) =>
                    setEmployee({ ...employee, productive: e.target.checked })
                  }
                />
                Profissional produtivo
              </label>
              {error && (
                <p role="alert" className="error-box">
                  {error}
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button className="button primary" disabled={busy}>
                Salvar funcionário
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
