export const SYSTEM_FIELDS = ['system_cash','system_credit','system_debit','system_pix','system_ifood_online','system_ifood_voucher','system_term','system_club'];
export const COUNTED_FIELDS = ['counted_cash','sipag_credit','sipag_debit','cappta_credit','cappta_debit','stone_credit','stone_debit','counted_pix','counted_ifood','counted_other'];

export function numberFrom(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').trim().replace(/\s/g, '');
  if (!raw) return 0;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sumFields(data, fields) { return fields.reduce((sum, key) => sum + numberFrom(data[key]), 0); }

export function calculateClosing(data) {
  const systemTotal = sumFields(data, SYSTEM_FIELDS);
  const countedReceipts = sumFields(data, COUNTED_FIELDS);
  const expectedCashAdjustment = numberFrom(data.opening_float) + numberFrom(data.cash_in) - numberFrom(data.withdrawals) - numberFrom(data.expenses) - numberFrom(data.closing_float);
  const countedTotal = countedReceipts - expectedCashAdjustment - numberFrom(data.adjustments);
  const difference = countedTotal - systemTotal;
  return { systemTotal, countedReceipts, countedTotal, difference, status: Math.abs(difference) < 0.01 ? 'balanced' : difference > 0 ? 'surplus' : 'shortage' };
}

export function formatBRL(value) { return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(numberFrom(value)); }
