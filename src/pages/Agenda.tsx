import "./agenda.css";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ClipboardCheck, Plus, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, send } from "../lib/api";
import { useApp } from "../lib/context";
import { today, type Entity } from "../lib/types";
import { workshopIdentity, DAYS } from "../../shared/workshopIdentity";
import { VehiclePlate, VehiclePlateInput } from "../components/VehiclePlate";
import { Empty, Modal, PageHeading } from "../components/ui";

type Appointment = Entity & {
  starts_at: string; ends_at: string; plate: string; customer_name: string;
  phone: string; planned_services: string; status: "scheduled" | "arrived" | "cancelled";
  professional_id: string | null; checklist_id: string | null; brand?: string; model?: string;
};

const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const startOfWeek = (day: string) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
};
const shiftDate = (day: string, offset: number) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const labelDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" });

export function Agenda() {
  const { data, session, notify } = useApp();
  const navigate = useNavigate();
  const hours = workshopIdentity(session.tenant).business_hours;
  const workingFor = (value: string) => hours.find(h =>
    h.day === new Date(`${value}T12:00:00Z`).getUTCDay() && !h.closed && h.open && h.close);
  const currentDay = today();
  const [weekDay, setWeekDay] = useState(() =>
    Array.from({ length: 7 }, (_, offset) => shiftDate(currentDay, offset)).find(workingFor) || currentDay);

  const [selected, setSelected] = useState(today());
  const [rows, setRows] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [plate, setPlate] = useState("");
  const checkedPlate = /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(plate) ? plate : "";
  const [professional, setProfessional] = useState("");
  const [end, setEnd] = useState("");
  const [formError, setFormError] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [time, setTime] = useState("");
  const [services, setServices] = useState("");
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDate(startOfWeek(weekDay), i)), [weekDay]);
  const openDays = week.filter(workingFor);
  const day = openDays.includes(selected) ? selected : (openDays.find(value => value >= weekDay) || openDays[0] || "");
  const working = workingFor(day);
  const mechanics = data.professionals.filter(p => p.active && p.productive !== 0 && p.productive !== false);
  const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const timeLabel = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  const opening = working ? toMinutes(working.open) : 0;
  const closing = working ? toMinutes(working.close) : 0;
  const boundaries = new Set([opening, closing]);
  for (let slot = opening + 30; slot < closing; slot += 30) boundaries.add(slot);
  for (const value of [working?.break_start, working?.break_end, ...rows.flatMap(row =>
    row.starts_at.startsWith(day) && row.status !== "cancelled" ? [row.starts_at.slice(11), row.ends_at.slice(11)] : [])]) {
    if (value && toMinutes(value) > opening && toMinutes(value) < closing) boundaries.add(toMinutes(value));
  }
  const times = [...boundaries].sort((a, b) => a - b);
  const slots = times.slice(0, -1);
  const visibleRows = rows.filter(row => row.starts_at.startsWith(day) && row.status !== "cancelled");
  const gridRows = [...mechanics, ...data.professionals.filter(p =>
    !mechanics.some(m => m.id === p.id) && visibleRows.some(row => row.professional_id === p.id))];
  if (visibleRows.some(row => !gridRows.some(p => p.id === row.professional_id)))
    gridRows.push({ id: "", name: "Sem mecânico atribuído" });
  const knownVehicle = data.vehicles.find(v => normalize(String(v.plate || "")) === checkedPlate);
  const knownCustomer = data.customers.find(c => c.id === knownVehicle?.customer_id);

  const load = async () => {
    if (!day) { setRows([]); setLoading(false); return; }
    setLoading(true);
    setError("");
    try { setRows(await api<Appointment[]>(`/agenda?date=${encodeURIComponent(day)}`)); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [day]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!checkedPlate) { setFormError("Informe uma placa válida para pesquisar o cadastro."); return; }
    if (!day || !working) { setFormError("Selecione um dia de atendimento em Configurações ou na Agenda."); return; }
    setBusy(true); setFormError("");
    try {
      await send("/agenda", { starts_at: `${day}T${time}`, ends_at: `${day}T${end}`, professional_id: professional,
        plate: checkedPlate, customer_name: knownCustomer?.name || customerName,
        phone: knownCustomer?.phone || phone, planned_services: services });
      setCreating(false); setPlate(""); setCustomerName(""); setPhone("");
      setTime(""); setEnd(""); setServices("");
      await load(); notify("Veículo agendado.");
    } catch (e) { setFormError((e as Error).message); }
    finally { setBusy(false); }
  };
  const cancel = async (row: Appointment) => {
    if (!window.confirm(`Cancelar o agendamento de ${row.plate}?`)) return;
    setBusy(true); setError("");
    try { await send(`/agenda/${row.id}/cancel`, {}); await load(); notify("Agendamento cancelado."); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return <>
    <PageHeading eyebrow="GESTÃO" title="Agenda" description="Organize a chegada dos veículos conforme os horários de atendimento da oficina."
      actions={<button className="button primary" onClick={() => { setFormError(""); setCreating(true); }}><Plus size={17}/> Novo agendamento</button>} />
    <section className="panel agenda-panel">
      <div className="agenda-day-toolbar">
        <button className="button" onClick={() => setWeekDay(shiftDate(weekDay, -7))}>Semana anterior</button>
        <strong>{labelDate(day || weekDay)}</strong>
        <button className="button" onClick={() => setWeekDay(shiftDate(weekDay, 7))}>Próxima semana</button>
      </div>
      <div className="agenda-week" aria-label="Dias da semana">
        {openDays.map(value => <button key={value} className={`button ${value === day ? "primary" : ""}`}
          onClick={() => setSelected(value)}>{DAYS[new Date(`${value}T12:00:00Z`).getUTCDay()].slice(0, 3)}<br/>{value.slice(8)}</button>)}
      </div>
      <p className="muted">{working && !working.closed ? `Atendimento: ${working.open}–${working.close}${working.break_start ? ` · intervalo ${working.break_start}–${working.break_end}` : ""}` : "Sem atendimento cadastrado neste dia."}</p>
      {error && <div className="error-box" role="alert">{error}</div>}
      {loading ? <p>Carregando agenda...</p> : !day ? <Empty title="Sem dias de atendimento nesta semana" description="Confira o expediente nas configurações da oficina."/> : !gridRows.length ? <Empty title="Nenhum mecânico ativo" description="Cadastre um profissional em Gestão para receber agendamentos."/> :
        <div className="agenda-grid-scroll">
          <table className="agenda-grid">
            <thead><tr><th scope="col">Mecânico</th>{slots.map(slot => <th key={slot} scope="col">{timeLabel(slot)}</th>)}</tr></thead>
            <tbody>{gridRows.map(mechanic => <tr key={mechanic.id}>
              <th scope="row">{mechanic.name}</th>
              {slots.map((slot, index) => {
                const limit = times[index + 1];
                const assigned = visibleRows.filter(row => (gridRows.some(p => p.id === row.professional_id) ? row.professional_id : "") === mechanic.id);
                const occupied = assigned.some(row => toMinutes(row.starts_at.slice(11)) < limit && toMinutes(row.ends_at.slice(11)) > slot);
                const paused = Boolean(working?.break_start && working.break_end &&
                  toMinutes(working.break_start) < limit && toMinutes(working.break_end) > slot);
                const startsHere = assigned.filter(row => Math.max(toMinutes(row.starts_at.slice(11)), opening) >= slot &&
                  Math.max(toMinutes(row.starts_at.slice(11)), opening) < limit);
                const canBook = !occupied && !paused && day >= currentDay && mechanics.some(p => p.id === mechanic.id);
                return <td key={slot} className={paused ? "agenda-break" : occupied ? "agenda-occupied" : canBook ? "agenda-free agenda-bookable" : "agenda-free"}>
                  {startsHere.map(row => <div key={row.id} className="agenda-booking">
                    <VehiclePlate value={row.plate} compact/>
                    <strong>{row.starts_at.slice(11)}–{row.ends_at.slice(11)}</strong>
                    <span>{row.customer_name}</span><span>{row.planned_services}</span>
                    {row.status === "scheduled" && day === today() && <button className="button" onClick={() => navigate(`/checklists/novo?agenda=${encodeURIComponent(row.id)}`)}><ClipboardCheck size={16}/> Checklist</button>}
                    {row.status === "scheduled" && <button className="button" disabled={busy} onClick={() => void cancel(row)}><X size={16}/> Cancelar</button>}
                    {row.status === "arrived" && row.checklist_id && <button className="button" onClick={() => navigate(`/checklists/${row.checklist_id}`)}>Abrir checklist</button>}
                  </div>)}
                  {canBook && <button type="button" className="agenda-slot" aria-label={`Agendar ${mechanic.name} às ${timeLabel(slot)}`} onClick={() => {
                    setProfessional(mechanic.id); setTime(timeLabel(slot)); setEnd(timeLabel(limit)); setFormError(""); setCreating(true);
                  }}>+</button>}
                </td>;
              })}
            </tr>)}</tbody>
          </table>
          <p className="agenda-legend"><span className="agenda-free">Livre</span><span className="agenda-occupied">Ocupado</span><span className="agenda-break">Intervalo</span></p>
        </div>}
    </section>
    {creating && <Modal title="Novo agendamento" onClose={() => setCreating(false)}>
      <form onSubmit={save} className="modal-body agenda-form">
        <label>Placa<VehiclePlateInput value={plate} onChange={event => { setPlate(normalize(event.target.value)); }} maxLength={7} placeholder="ABC1D23" required/></label>
        {formError && <div className="error-box" role="alert">{formError}</div>}
        {checkedPlate && (knownVehicle ? <div className="agenda-found"><p>Veículo encontrado: {knownVehicle.brand} {knownVehicle.model} · {knownCustomer?.name}</p>{!knownCustomer?.phone && <label>Telefone para contato<input type="tel" value={phone} onChange={event => setPhone(event.target.value)} required/></label>}</div> : <div className="agenda-manual"><p>Veículo não encontrado. Informe os dados para este agendamento; o cadastro definitivo será feito no checklist.</p><label>Nome do cliente<input value={customerName} onChange={event => setCustomerName(event.target.value)} required minLength={2}/></label><label>Telefone<input type="tel" value={phone} onChange={event => setPhone(event.target.value)} required/></label></div>)}
        <div className="agenda-form-row">
          <label>Data<select value={day} onChange={event => setSelected(event.target.value)} required>
            <option value="">Selecione um dia de atendimento</option>
            {openDays.filter(value => value >= today()).map(value => <option key={value} value={value}>{labelDate(value)}</option>)}
          </select></label>
          <label>Mecânico<select value={professional} onChange={event => setProfessional(event.target.value)} required>
            <option value="">Selecione um mecânico</option>
            {mechanics.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
          <label>Horário inicial<input type="time" value={time} min={working?.open} max={working?.close} onChange={event => setTime(event.target.value)} required/></label>
          <label>Horário final<input type="time" value={end} min={working?.open} max={working?.close} onChange={event => setEnd(event.target.value)} required/></label>
        </div>
        <label>Serviços previstos<textarea value={services} onChange={event => setServices(event.target.value)} placeholder="Descreva o relato do cliente e os serviços prováveis" required minLength={2} maxLength={2000}/></label>
        <p className="muted">A reserva pode atravessar o intervalo. Escolha o início e o fim em horários de atendimento.</p>
        <div className="modal-actions"><button className="button" type="button" onClick={() => setCreating(false)}>Voltar</button><button className="button primary" type="submit" disabled={busy}>{busy ? "Salvando..." : "Salvar agendamento"}</button></div>
      </form>
    </Modal>}
  </>;
}
