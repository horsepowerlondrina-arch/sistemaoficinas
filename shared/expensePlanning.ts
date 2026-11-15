export function expenseAppliesToMonth(
  t: {
    active?: number;
    start_month?: string | null;
    remaining_months?: number | null;
    [key: string]: unknown;
  },
  month: string,
) {
  if (!t.active) return false;
  const start = t.start_month || month;
  const diff =
    (Number(month.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
    Number(month.slice(5)) -
    Number(start.slice(5));
  return diff >= 0 && (t.remaining_months == null || diff < t.remaining_months);
}
