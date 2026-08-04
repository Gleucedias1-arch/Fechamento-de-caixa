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

export const OPERATION_SETTLEMENT_FIELDS = {
  Stone: {credit:'stone_credit',debit:'stone_debit',pix:'stone_pix'},
  Sipag: {credit:'sipag_credit',debit:'sipag_debit',pix:'sipag_pix'},
  Cielo: {credit:'cielo_credit',debit:'cielo_debit',pix:'cielo_pix'},
  Cappta: {credit:'cappta_credit',debit:'cappta_debit',pix:'cappta_pix'},
  Laranjinha: {credit:'laranjinha_credit',debit:'laranjinha_debit',pix:'laranjinha_pix'},
  Wise: {credit:'wise_credit',debit:'wise_debit',pix:'wise_pix'},
};

export function machineDefinitions(data = {}) {
  const saved = data.machineDefinitions;
  if (saved && typeof saved === 'object') {
    return Object.entries(saved).map(([id,machine]) => ({
      id,
      name:String(machine?.name || id),
      credit:String(machine?.credit || ''),
      debit:String(machine?.debit || ''),
      pix:String(machine?.pix || ''),
    })).filter(machine => machine.credit && machine.debit && machine.pix);
  }
  return Object.entries(OPERATION_SETTLEMENT_FIELDS).map(([name,fields]) => ({
    id:name.toLowerCase(),name,...fields
  }));
}

export const FINANCE_CONFIRM_FIELDS = [
  ...FINANCE_MACHINE_FIELDS.map(field => `finance_confirm_${field.replace('finance_','')}`),
  'finance_confirm_outflows'
];

function parsedNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const raw = String(value ?? '').trim().replace(/\s/g, '');
  if (!raw) return 0;
  let normalized = raw;
  if (raw.includes(',')) normalized = raw.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) normalized = raw.replace(/\./g, '');
  return Number(normalized);
}

export function numberFrom(value) {
  const parsed = parsedNumber(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isValidAmount(value, max = 10000000) {
  const parsed = parsedNumber(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= max;
}

export function validateClosingAmounts(data = {}) {
  const dynamicMachineFields = machineDefinitions(data).flatMap(machine => [machine.credit,machine.debit,machine.pix]);
  const fields = [
    ...SYSTEM_FIELDS,...COUNTED_FIELDS,...EXPENSE_FIELDS,
    ...dynamicMachineFields,'opening_float','withdrawals','cash_in','closing_float'
  ];
  const directAmountsValid = fields.every(key => data[key] === undefined || isValidAmount(data[key]));
  const outflowsValid = (data.outflows || []).every(item => isValidAmount(item?.amount) && numberFrom(item?.amount) > 0);
  const pixRequestsValid = (data.pixRequests || []).every(item => isValidAmount(item?.amount) && numberFrom(item?.amount) > 0);
  return directAmountsValid && outflowsValid && pixRequestsValid;
}

export function sumFields(data, fields) {
  return fields.reduce((sum, key) => sum + numberFrom(data?.[key]), 0);
}

export function statusFromDifference(value) {
  return Math.abs(numberFrom(value)) < 0.01 ? 'balanced' : numberFrom(value) > 0 ? 'surplus' : 'shortage';
}

export function differenceSeverity(value, tolerance = 2) {
  const difference = Math.abs(numberFrom(value));
  if (difference < 0.01) return 'balanced';
  return difference <= Math.max(0,numberFrom(tolerance)) ? 'warning' : 'critical';
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
  const machines = machineDefinitions(data);
  const system = {
    cash: numberFrom(data.system_cash),
    card: numberFrom(data.system_credit) + numberFrom(data.system_debit),
    pix: numberFrom(data.system_pix),
    ifood: numberFrom(data.system_ifood_online) + numberFrom(data.system_ifood_voucher),
    other: numberFrom(data.system_term) + numberFrom(data.system_club) + numberFrom(data.system_accrual),
  };
  const counted = {
    cash: numberFrom(data.counted_cash),
    card: data.counted_card !== undefined ? numberFrom(data.counted_card) : sumFields(data, machines.flatMap(machine => [machine.credit,machine.debit])),
    pix: data.counted_pix !== undefined ? numberFrom(data.counted_pix) : sumFields(data, machines.map(machine => machine.pix)),
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
  const difference = Object.values(differences).reduce((sum, value) => sum + value, 0);
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

export function calculateOperationalFinancialSummary(data = {}, feeRates = {}) {
  const closing = calculateClosing(data);
  const machineSettlements = Object.fromEntries(machineDefinitions(data).map(machine => {
    const rates = feeRates[machine.id] || feeRates[machine.name] || feeRates[machine.name.toLowerCase()] || {};
    const credit = numberFrom(data[machine.credit]);
    const debit = numberFrom(data[machine.debit]);
    const pix = numberFrom(data[machine.pix]);
    const cardFees = credit * numberFrom(rates.credit) / 100
      + debit * numberFrom(rates.debit) / 100;
    const pixFees = pix * numberFrom(rates.pix) / 100;
    return [machine.id,{
      name:machine.name,
      grossCard:credit + debit,grossPix:pix,cardFees,pixFees,
      netCard:credit + debit - cardFees,netPix:pix - pixFees
    }];
  }));
  const grossCard = Object.values(machineSettlements).reduce((sum,item) => sum + item.grossCard,0);
  const grossPix = Object.values(machineSettlements).reduce((sum,item) => sum + item.grossPix,0);
  const cardFees = Object.values(machineSettlements).reduce((sum,item) => sum + item.cardFees,0);
  const pixFees = Object.values(machineSettlements).reduce((sum,item) => sum + item.pixFees,0);
  const pixRequested = (data.pixRequests || []).reduce((sum,item) => sum + numberFrom(item?.amount),0);
  const physicalCash = numberFrom(data.counted_cash) + numberFrom(data.closing_float);
  const netCard = grossCard - cardFees;
  const netPix = grossPix - pixFees;
  const bankNet = netCard + netPix;
  return {
    grossSales:closing.systemTotal,
    physicalCash,grossCard,grossPix,cardFees,pixFees,
    feeTotal:cardFees + pixFees,netCard,netPix,bankNet,pixRequested,
    projectedAvailable:physicalCash + bankNet - pixRequested,
    machineSettlements,
  };
}

export function calculateFinanceReview(record = {}, review = {}) {
  const operational = calculateClosing(record);
  const machines = machineDefinitions(record);
  const expected = {
    cash: operational.expectedCash,
    card: operational.systemByMethod.card,
    pix: operational.systemByMethod.pix,
  };
  const legacyFinanceCard = sumFields(review, [
    'finance_stone','finance_sipag','finance_cielo','finance_cappta','finance_laranjinha','finance_wise'
  ]);
  const actual = {
    // O financeiro não reconta dinheiro: preserva a conferência feita pela loja.
    cash: operational.countedByMethod.cash,
    card: machines.some(machine => review[`finance_${machine.credit}`] !== undefined || review[`finance_${machine.debit}`] !== undefined)
      ? sumFields(review, machines.flatMap(machine => [`finance_${machine.credit}`,`finance_${machine.debit}`])) : legacyFinanceCard,
    pix: machines.some(machine => review[`finance_${machine.pix}`] !== undefined)
      ? sumFields(review, machines.map(machine => `finance_${machine.pix}`)) : numberFrom(review.finance_pix),
  };
  const feeRates = review.cardFeeRates || record.cardFeeRates || {};
  const machineSettlements = Object.fromEntries(machines.map(machine => {
    const rates = feeRates[machine.id] || feeRates[machine.name] || feeRates[machine.name.toLowerCase()] || {};
    const credit = numberFrom(review[`finance_${machine.credit}`]);
    const debit = numberFrom(review[`finance_${machine.debit}`]);
    const pix = numberFrom(review[`finance_${machine.pix}`]);
    const creditRate = numberFrom(rates.credit);
    const debitRate = numberFrom(rates.debit);
    const pixRate = numberFrom(rates.pix);
    const creditFee = credit * creditRate / 100;
    const debitFee = debit * debitRate / 100;
    const pixFee = pix * pixRate / 100;
    const cardFees = creditFee + debitFee;
    const fees = cardFees + pixFee;
    const grossCard = credit + debit;
    const netPix = pix - pixFee;
    return [machine.id,{
      name:machine.name,
      credit,debit,pix,creditRate,debitRate,pixRate,creditFee,debitFee,pixFee,
      grossCard,cardFees,fees,netCard:grossCard-cardFees,netPix,
      totalNet:grossCard-cardFees+netPix,
    }];
  }));
  const cardFeeTotal = Object.values(machineSettlements).reduce((sum,item) => sum + item.cardFees,0);
  const pixFeeTotal = Object.values(machineSettlements).reduce((sum,item) => sum + item.pixFee,0);
  const netCard = actual.card - cardFeeTotal;
  const netPix = actual.pix - pixFeeTotal;
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
    grossPix: actual.pix,
    pixFeeTotal,
    netCard,
    netPix,
    feeTotal: cardFeeTotal + pixFeeTotal,
    machineSettlements,
    totalAvailable: netCard + netPix,
    totalOutflows: operational.totalOutflows + paidPixRequests,
    status: statusFromDifference(totalDifference),
  };
}

export function summarizeFinance(records = []) {
  return records.reduce((summary, record) => {
    const review = record.financeCalc || (record.financeReview
      ? calculateFinanceReview(record,record.financeReview) : null);
    const receivedSangria = Boolean(record.financeReview?.finance_sangria_received);
    const pendingSangria = record.sangria_delivered && !receivedSangria
      ? numberFrom(record.withdrawals) : 0;
    summary.grossCard += numberFrom(review?.grossCard);
    summary.cardFees += numberFrom(review?.cardFeeTotal);
    summary.netCard += numberFrom(review?.netCard);
    summary.grossPix += numberFrom(review?.grossPix);
    summary.pixFees += numberFrom(review?.pixFeeTotal);
    summary.netPix += numberFrom(review?.netPix);
    summary.paidPix += numberFrom(review?.paidPixRequests);
    summary.pendingSangria += pendingSangria;
    summary.totalAvailable += numberFrom(review?.totalAvailable);
    summary.totalDifference += numberFrom(review?.totalDifference ?? record.difference);
    return summary;
  },{
    grossCard:0,cardFees:0,netCard:0,grossPix:0,pixFees:0,netPix:0,
    paidPix:0,pendingSangria:0,totalAvailable:0,totalDifference:0,
  });
}

export function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(numberFrom(value));
}
