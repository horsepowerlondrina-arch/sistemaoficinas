export function servicePrice(minutes: number, hourlyRate: number) {
  if (
    !Number.isFinite(minutes) ||
    minutes <= 0 ||
    !Number.isSafeInteger(hourlyRate) ||
    hourlyRate <= 0
  )
    throw new Error(
      "Informe o tempo e configure o valor da hora para este porte.",
    );
  const value = Math.round((minutes * hourlyRate) / 60);
  if (!Number.isSafeInteger(value) || value > 100000000 || value <= 0)
    throw new Error("Valor do serviço fora do limite.");
  return value;
}
export function serviceMinutes(price: number, hourlyRate: number) {
  if (
    !Number.isSafeInteger(price) ||
    price <= 0 ||
    !Number.isSafeInteger(hourlyRate) ||
    hourlyRate <= 0
  )
    throw new Error(
      "Informe o preço e configure o valor da hora para este porte.",
    );
  const minutes = Math.round(((price * 60) / hourlyRate) * 10000) / 10000;
  if (minutes <= 0 || minutes > 10000)
    throw new Error(
      "O preço informado gera um tempo fora do limite. Confira o valor da hora.",
    );
  return minutes;
}
export function outsourcedPrice(cost: number, markup: number) {
  if (!Number.isSafeInteger(cost) || cost <= 0)
    throw new Error("Informe o custo do serviço terceirizado.");
  const value = Math.round((cost * (10000 + markup)) / 10000);
  if (!Number.isSafeInteger(value) || value > 100000000)
    throw new Error("Valor do serviço fora do limite.");
  return value;
}
