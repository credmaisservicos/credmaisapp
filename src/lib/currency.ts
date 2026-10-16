const safe = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

/** R$ 1.234,56 */
export const formatBRL = (value: unknown) =>
  safe(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** R$ 1.235 — for compact KPI tiles and chart labels where cents add noise. */
export const formatBRLCompact = (value: unknown) =>
  safe(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
