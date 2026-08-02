export const SYSTEM_FIELDS = [
  'system_cash','system_credit','system_debit','system_pix','system_ifood_online',
  'system_ifood_voucher','system_term','system_club','system_accrual'
];

export const CARD_FIELDS = [
  'sipag_credit','sipag_debit','cappta_credit','cappta_debit',
  'stone_credit','stone_debit','cielo_credit','cielo_debit',
  'laranjinha_credit','laranjinha_debit','wise_credit','wise_debit'
];

export const MACHINE_PIX_FIELDS = [
  'sipag_pix','cappta_pix','stone_pix','cielo_pix','laranjinha_pix','wise_pix'
];

export const COUNTED_FIELDS = [
  'counted_cash',...CARD_FIELDS,...MACHINE_PIX_FIELDS
];

export const EXPENSE_FIELDS = [
  'expenses','expense_motoboy','expense_freelancer','expense_free_delivery','expense_other'
];

export const FINANCE_CARD_FIELDS = [
  'finance_sipag_credit','finance_sipag_debit','finance_cappta_credit','finance_cappta_debit',
  'finance_stone_credit','finance_stone_debit','finance_cielo_credit','finance_cielo_debit',
  'finance_laranjinha_credit','finance_laranjinha_debit','finance_wise_credit','finance_wise_debit'
];

export const FINANCE_PIX_FIELDS = [
  'finance_sipag_pix','finance_cappta_pix','finance_stone_pix',
  'finance_cielo_pix','finance_laranjinha_pix','finance_wise_pix'
];

export const FINANCE_MACHINE_FIELDS = [
  ...FINANCE_CARD_FIELDS,...FINANCE_PIX_FIELDS
];

export const MACHINE_SETTLEMENT_FIELDS = {
  Stone: {credit:'finance_stone_credit',debit:'finance_stone_debit',pix:'finance_stone_pix'},
  Sipag: {credit:'finance_sipag_credit',debit:'finance_sipag_debit',pix:'finance_sipag_pix'},
  Cielo: {credit:'finance_cielo_credit',debit:'finance_cielo_debit',pix:'finance_cielo_pix'},
  Cappta: {credit:'finance_cappta_credit',debit:'finance_cappta_debit',pix:'finance_cappta_pix'},
  Laranjinha: {credit:'finance_laranjinha_credit',debit:'finance_laranjinha_debit',pix:'finance_laranjinha_pix'},
  Wise: {credit:'finance_wise_credit',debit:'finance_wise_debit',pix:'finance_wise_pix'},
};

export const FINANCE_CONFIRM_FIELDS = [
  'finance_confirm_cash',
  ...FINANCE_MACHINE_FIELDS.map(field => `finance_confirm_${field.replace('finance_','')}`),
  'finance_confirm_outflows'
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

export function sumOutflows(data = {}) {
  if (Array.isArray(data.outflows)) {
    return data.outflows.reduce((sum, item) => sum + numberFrom(item?.amount), 0);
  }
  return sumFields(data, EXPENSE_FIELDS);
}

export function sumPixRequests(data = {}, statuses = []) {
  const requests = Array.isArray(data.pixRequests) ? data.pixRequests : [];
  return requests.reduce((sum, request, index) => {
    const status = statuses[index]?.status || request?.status;
    return sum + (status === 'paid' ? numberFrom(request?.amount) : 0);
  }, 0);
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
    card: data.counted_card !== undefined ? numberFrom(data.counted_card) : sumFields(data, CARD_FIELDS),
    pix: data.counted_pix !== undefined ? numberFrom(data.counted_pix) : sumFields(data, MACHINE_PIX_FIELDS),
  };
  const expenseTotal = sumOutflows(data);
  const expectedCash = numberFrom(data.opening_float) + system.cash + numberFrom(data.cash_in)
    - numberFrom(data.withdrawals) - expenseTotal - numberFrom(data.closing_float);
  const differences = {
    cash: counted.cash - expectedCash,
    card: counted.card - system.card,
    pix: counted.pix - system.pix,
  };
  const systemTotal = Object.values(system).reduce((sum, value) => sum + value, 0);
  const countedReceipts = counted.cash + counted.card + counted.pix;
  const difference = Object.values(differences).reduce((sum, value) => sum + value, 0) - numberFrom(data.adjustments);
  const countedTotal = countedReceipts;
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
  const expected = {
    cash: operational.expectedCash,
    card: operational.systemByMethod.card,
    pix: operational.systemByMethod.pix,
  };
  const legacyFinanceCard = sumFields(review, [
    'finance_stone','finance_sipag','finance_cielo','finance_cappta','finance_laranjinha','finance_wise'
  ]);
  const actual = {
    cash: numberFrom(review.finance_cash),
    card: FINANCE_CARD_FIELDS.some(field => review[field] !== undefined)
      ? sumFields(review, FINANCE_CARD_FIELDS) : legacyFinanceCard,
    pix: FINANCE_PIX_FIELDS.some(field => review[field] !== undefined)
      ? sumFields(review, FINANCE_PIX_FIELDS) : numberFrom(review.finance_pix),
  };
  const feeRates = review.cardFeeRates || record.cardFeeRates || {};
  const machineSettlements = Object.fromEntries(Object.entries(MACHINE_SETTLEMENT_FIELDS).map(([machine,fields]) => {
    const rates = feeRates[machine] || feeRates[machine.toLowerCase()] || {};
    const credit = numberFrom(review[fields.credit]);
    const debit = numberFrom(review[fields.debit]);
    const pix = numberFrom(review[fields.pix]);
    const creditRate = numberFrom(rates.credit);
    const debitRate = numberFrom(rates.debit);
    const creditFee = credit * creditRate / 100;
    const debitFee = debit * debitRate / 100;
    const fees = creditFee + debitFee;
    const grossCard = credit + debit;
    return [machine,{
      credit,debit,pix,creditRate,debitRate,creditFee,debitFee,
      grossCard,fees,netCard:grossCard-fees,totalNet:grossCard-fees+pix,
    }];
  }));
  const cardFeeTotal = Object.values(machineSettlements).reduce((sum,item) => sum + item.fees,0);
  const netCard = actual.card - cardFeeTotal;
  const differences = Object.fromEntries(Object.keys(expected).map(key => [key, actual[key] - expected[key]]));
  const totalDifference = Object.values(differences).reduce((sum, value) => sum + value, 0)
    - numberFrom(review.finance_adjustments);
  const paidPixRequests = sumPixRequests(record, review.pixPaymentStatuses);
  return {
    expected,
    actual,
    differences,
    totalDifference,
    paidPixRequests,
    grossCard: actual.card,
    cardFeeTotal,
    netCard,
    machineSettlements,
    totalAvailable: netCard + actual.pix - paidPixRequests,
    totalOutflows: operational.totalOutflows + paidPixRequests,
    status: statusFromDifference(totalDifference),
  };
}

export function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(numberFrom(value));
}
