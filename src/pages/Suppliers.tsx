import { useState, type FormEvent } from "react";
import { Plus, Pencil, Package } from "lucide-react";
import { useApp } from "../lib/context";
import { api, send } from "../lib/api";
import { money, type Entity } from "../lib/types";
import { productLabel } from "../../shared/productIdentity";
import { SupplierFields, blankSupplier, type SupplierDraft } from "../components/SupplierFields";
import { PageHeading, SearchBox, Modal, Submit, Empty } from "../components/ui";

export function Suppliers() {
  const { data, refresh, notify } = useApp();
  const [search,setSearch]=useState(""),[filter,setFilter]=useState("active");
  const [editing,setEditing]=useState<Entity|null|undefined>();
  const [draft,setDraft]=useState<SupplierDraft>(blankSupplier);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const [details,setDetails]=useState<{supplier:Entity;products:Entity[]}|null>(null);
  const rows=(data.suppliers || []).filter(s =>
    (filter==="all" || (filter==="active" ? s.active : !s.active)) &&
    [s.name,s.trade_name,s.document,s.phone,s.email,s.seller].join(" ").toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR")));
  function edit(s: Entity|null) {
    setError("");setEditing(s);setDraft({...blankSupplier(),...s,document:s?.document || ""});
  }
  async function save(e:FormEvent) {
    e.preventDefault();if(busy)return;setBusy(true);setError("");
    try {
      await send(editing ? "/suppliers/"+editing.id : "/suppliers",draft,editing ? "PUT" : "POST");
      await refresh();setEditing(undefined);notify("Fornecedor salvo.");
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  async function show(s:Entity) {
    setError("");
    try {setDetails(await api("/suppliers/"+s.id));}
    catch(e) {setError((e as Error).message);}
  }
  return <>
    <PageHeading title="Fornecedores" description="Dados de contato e vínculos com os produtos comprados."
      actions={<button className="button primary" onClick={()=>edit(null)}><Plus size={17}/>Cadastrar fornecedor</button>} />
    <div className="panel">
      <div className="table-toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Pesquisar fornecedor, CNPJ ou contato..." />
        <select aria-label="Situação dos fornecedores" value={filter} onChange={e=>setFilter(e.target.value)}>
          <option value="active">Ativos</option><option value="inactive">Inativos</option><option value="all">Todos</option>
        </select>
      </div>
      {error && editing===undefined && <p className="error-box" role="alert">{error}</p>}
      {rows.length ? <div className="table-scroll"><table><thead><tr><th>Fornecedor</th><th>CPF/CNPJ</th><th>Contato</th><th>Produtos</th><th>Situação</th><th>Ações</th></tr></thead><tbody>
        {rows.map(s=><tr key={s.id}><td><strong>{s.trade_name || s.name}</strong>{s.trade_name && <div className="muted">{s.name}</div>}</td>
          <td>{s.document || "Não informado"}</td><td>{s.phone || s.email || "Não informado"}{s.seller && <div className="muted">{s.seller}</div>}</td>
          <td>{s.product_count}</td><td>{s.active ? "Ativo" : "Inativo"}</td><td><div className="capture-actions">
            <button className="button" onClick={()=>edit(s)}><Pencil size={15}/>Editar</button>
            <button className="button" onClick={()=>void show(s)}><Package size={15}/>Produtos</button>
          </div></td></tr>)}
      </tbody></table></div> : <Empty title="Nenhum fornecedor encontrado" />}
    </div>
    {editing!==undefined && <Modal title={editing ? "Editar fornecedor" : "Cadastrar fornecedor"} description="Confira os dados. Inativar mantém os vínculos e as notas anteriores." onClose={()=>!busy&&setEditing(undefined)} wide>
      <form onSubmit={save}><div className="modal-body"><SupplierFields value={draft} onChange={setDraft} disabled={busy} />
        {error&&<p className="error-box" role="alert">{error}</p>}</div>
        <div className="modal-footer"><button type="button" className="button" disabled={busy} onClick={()=>setEditing(undefined)}>Cancelar</button><Submit busy={busy}>Salvar fornecedor</Submit></div>
      </form>
    </Modal>}
    {details && <Modal title={"Produtos de "+(details.supplier.trade_name || details.supplier.name)} description="Códigos do fornecedor e último custo registrado por unidade de estoque, incluindo frete e encargos da nota." onClose={()=>setDetails(null)} wide>
      <div className="modal-body">{details.products.length ? <div className="table-scroll"><table><thead><tr><th>Produto</th><th>Código do fornecedor</th><th>Último custo</th><th>Última compra</th></tr></thead><tbody>
        {details.products.map(p=><tr key={p.id}><td>{productLabel(p)}</td><td>{p.supplier_code} · {p.unit}</td><td>{p.last_cost===null ? "Não informado" : money(p.last_cost)}</td><td>{p.last_purchase_on ? p.last_purchase_on.split("-").reverse().join("/") : "Não informado"}</td></tr>)}
      </tbody></table></div> : <Empty title="Nenhum produto vinculado ainda" />}</div>
    </Modal>}
  </>;
}
