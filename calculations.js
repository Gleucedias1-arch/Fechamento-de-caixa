export const SYSTEM_FIELDS = [
  'system_cash','system_credit','system_debit','system_pix','system_ifood_online',
  'system_ifood_voucher','system_term','system_club','system_accrual'
];

export const CARD_FIELDS = [
  'sipag_credit','sipag_debit','cappta_credit','cappta_debit',
  'stone_credit','stone_debit','cielo_credit','cielo_debit',
  'laranjinha_credit','laranjinha_debit','wise_credit','wise_debit'
];

export const COUNTED_FIELDS = [
  'counted_cash',...CARD_FIELDS,'counted_pix','counted_ifood','counted_other'
];

export const EXPENSE_FIELDS = [
  'expenses','expense_motoboy','expense_freelancer','expense_free_delivery','expense_other'
];

export const FINANCE_OPERATOR_FIELDS = [
  'finance_stone','finance_sipag','finance_cielo','finance_cappta',
  'finance_laranjinha','finance_wise'
];

export function numberFrom(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').trim().replace(/\s/g, '');
  if (!raw) return 0;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sumFields(data, fields) {
  return fields.reduce((sum, key) => sum + numberFrom(data?.[key]), 0);
}

export function statusFromDifference(value) {
  return Math.abs(numberFrom(value)) < 0.01 ? 'balanced' : numberFrom(value) > 0 ? 'surplus' : 'shortage';
}

export function calculateClosing(data = {}) {
  const system = {
    cash: numberFrom(data.system_cash),
    card: numberFrom(data.system_credit) + numberFrom(data.system_debit),
    pix: numberFrom(data.system_pix),
    ifood: numberFrom(data.system_ifood_online) + numberFrom(data.system_ifood_voucher),
    other: numberFrom(data.system_term) + numberFrom(data.system_club) + numberFrom(data.system_accrual),
  };
  const counted = {
    cash: numberFrom(data.counted_cash),
    card: sumFields(data, CARD_FIELDS),
    pix: numberFrom(data.counted_pix),
    ifood: numberFrom(data.counted_ifood),
    other: numberFrom(data.counted_other),
  };
  const expenseTotal = sumFields(data, EXPENSE_FIELDS);
  const expectedCash = numberFrom(data.opening_float) + system.cash + numberFrom(data.cash_in)
    - numberFrom(data.withdrawals) - expenseTotal - numberFrom(data.closing_float);
  const differences = {
    cash: counted.cash - expectedCash,
    card: counted.card - system.card,
    pix: counted.pix - system.pix,
    ifood: counted.ifood - system.ifood,
    other: counted.other - system.other,
  };
  const systemTotal = Object.values(system).reduce((sum, value) => sum + value, 0);
  const countedReceipts = Object.values(counted).reduce((sum, value) => sum + value, 0);
  const difference = Object.values(differences).reduce((sum, value) => sum + value, 0) - numberFrom(data.adjustments);
  const countedTotal = systemTotal + difference;
  const totalOutflows = numberFrom(data.withdrawals) + expenseTotal;
  const totalAvailable = numberFrom(data.closing_float) + counted.card + counted.pix;
  return {
    systemTotal,
    countedReceipts,
    countedTotal,
    difference,
    expenseTotal,
    totalOutflows,
    totalAvailable,
    expectedCash,
    systemByMethod: system,
    countedByMethod: counted,
    differences,
    status: statusFromDifference(difference),
  };
}

export function calculateFinanceReview(record = {}, review = {}) {
  const operational = calculateClosing(record);
  const cardFees = numberFrom(review.finance_card_fees);
  const expected = {
    cash: operational.expectedCash,
    card: operational.systemByMethod.card - cardFees,
    pix: operational.systemByMethod.pix,
    ifood: operational.systemByMethod.ifood,
    other: operational.systemByMethod.other,
  };
  const actual = {
    cash: numberFrom(review.finance_cash),
    card: sumFields(review, FINANCE_OPERATOR_FIELDS),
    pix: numberFrom(review.finance_pix),
    ifood: numberFrom(review.finance_ifood),
    other: numberFrom(review.finance_other),
  };
  const differences = Object.fromEntries(Object.keys(expected).map(key => [key, actual[key] - expected[key]]));
  const totalDifference = Object.values(differences).reduce((sum, value) => sum + value, 0)
    - numberFrom(review.finance_adjustments);
  const fiscalExpected = operational.systemByMethod.card + operational.systemByMethod.pix
    + operational.systemByMethod.ifood + numberFrom(record.system_term);
  const fiscalDifference = numberFrom(review.finance_coupon_issued) - fiscalExpected;
  const motoboyExpected = numberFrom(record.expense_motoboy);
  const motoboyActual = numberFrom(review.finance_motoboy_system) + numberFrom(review.finance_free_delivery);
  const motoboyDifference = motoboyActual - motoboyExpected;
  return {
    expected,
    actual,
    differences,
    cardFees,
    totalDifference,
    fiscalExpected,
    fiscalDifference,
    motoboyExpected,
    motoboyActual,
    motoboyDifference,
    totalAvailable: actual.cash + actual.card + actual.pix,
    totalOutflows: operational.totalOutflows,
    status: statusFromDifference(totalDifference),
  };
}

export function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(numberFrom(value));
}
