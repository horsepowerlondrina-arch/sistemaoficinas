async function send(type) {
  const r = await chrome.runtime.sendMessage({ type });
  if (!r?.ok) throw new Error(r?.error || "Falha na extensão.");
  return r;
}
async function load() {
  const s = await send("HP_STATUS");
  const vehicle = await send("HP_VEHICLE");
  document.getElementById("plate").textContent = vehicle.connected
    ? vehicle.plate
      ? "Placa da OS: " + vehicle.plate
      : "Destino sem placa. Associe um veículo ao orçamento se desejar enviar a placa."
    : "";
  document.getElementById("status").textContent =
    (s.connected
      ? "Conectado: " + (s.label || `OS #${s.number}`)
      : "Abra o catálogo, OS e conecte a extensão.") +
    " · " +
    s.pending +
    " envio(s) pendente(s)";
}
for (const [id, type] of [
  ["open", "HP_OPEN"],
  ["retry", "HP_RETRY"],
  ["clear", "HP_CLEAR_PENDING"],
])
  document.getElementById(id).onclick = async () => {
    try {
      if (
        id === "clear" &&
        !confirm("Descartar os itens pendentes e em espera e desconectar deste destino?")
      )
        return;
      document.getElementById("error").textContent = "";
      await send(type);
      await load();
    } catch (e) {
      document.getElementById("error").textContent = e.message;
    }
  };
load().catch((e) => (document.getElementById("error").textContent = e.message));
