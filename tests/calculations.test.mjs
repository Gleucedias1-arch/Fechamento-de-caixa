import test from 'node:test';
import assert from 'node:assert/strict';
import { numberFrom, validateClosingAmounts, calculateClosing, calculateFinanceReview, differenceSeverity, summarizeFinance, calculateOperationalFinancialSummary } from '../calculations.js';

test('converte valores brasileiros',()=>{
  assert.equal(numberFrom('1.234,56'),1234.56);
  assert.equal(numberFrom('1.234'),1234);
  assert.equal(numberFrom('100,50'),100.5);
  assert.equal(numberFrom(''),0);
});

test('caixa conciliado por forma de pagamento',()=>{
  const result=calculateClosing({system_cash:100,system_pix:50,counted_cash:100,stone_pix:50});
  assert.equal(result.systemTotal,150);
  assert.equal(result.countedTotal,150);
  assert.equal(result.difference,0);
  assert.equal(result.status,'balanced');
  assert.deepEqual(result.differences,{cash:0,card:0,pix:0});
});

test('movimentações e despesas ajustam o dinheiro esperado',()=>{
  const result=calculateClosing({
    system_cash:100,counted_cash:60,opening_float:20,withdrawals:40,
    expense_motoboy:10,expenses:10
  });
  assert.equal(result.expenseTotal,20);
  assert.equal(result.expectedCash,60);
  assert.equal(result.countedTotal,60);
  assert.equal(result.status,'balanced');
});

test('detecta falta e sobra',()=>{
  assert.equal(calculateClosing({system_cash:100,counted_cash:90}).status,'shortage');
  assert.equal(calculateClosing({system_cash:100,counted_cash:110}).status,'surplus');
});

test('concilia cartões de todas as operadoras',()=>{
  const result=calculateClosing({
    system_credit:100,system_debit:80,
    stone_credit:50,stone_debit:30,sipag_credit:50,sipag_debit:50
  });
  assert.equal(result.systemByMethod.card,180);
  assert.equal(result.countedByMethod.card,180);
  assert.equal(result.differences.card,0);
});

test('iFood e outros canais não entram na divergência da conferência',()=>{
  const result=calculateClosing({system_ifood_online:120,system_ifood_voucher:30,system_term:50});
  assert.equal(result.systemTotal,200);
  assert.deepEqual(Object.keys(result.differences),['cash','card','pix']);
  assert.equal(result.difference,0);
});

test('ajuste autorizado antigo não altera mais a divergência',()=>{
  const result=calculateClosing({system_cash:100,counted_cash:100,adjustments:35});
  assert.equal(result.difference,0);
  assert.equal(result.status,'balanced');
});

test('financeiro concilia dinheiro, débito e crédito por máquina e Pix',()=>{
  const record={
    system_cash:100,system_credit:200,system_debit:100,system_pix:50,
    opening_float:20,withdrawals:10,outflows:[{amount:15}]
  };
  const review={
    finance_cash:95,finance_stone_credit:200,finance_stone_debit:60,
    finance_sipag_debit:40,finance_stone_pix:50
  };
  const result=calculateFinanceReview(record,review);
  assert.equal(result.totalDifference,0);
  assert.equal(result.actual.card,300);
  assert.equal(result.totalAvailable,350);
  assert.equal(result.status,'balanced');
});

test('financeiro encontra cartão e Pix líquidos pelas taxas de cada maquininha',()=>{
  const record={system_credit:300,system_debit:200,system_pix:100};
  const review={
    finance_stone_credit:200,finance_stone_debit:100,finance_stone_pix:60,
    finance_sipag_credit:100,finance_sipag_debit:100,finance_sipag_pix:40,
    cardFeeRates:{Stone:{credit:3,debit:1.5,pix:1},Sipag:{credit:4,debit:2,pix:0.5}}
  };
  const result=calculateFinanceReview(record,review);
  assert.equal(result.grossCard,500);
  assert.equal(result.cardFeeTotal,13.5);
  assert.equal(result.netCard,486.5);
  assert.equal(result.pixFeeTotal,0.8);
  assert.equal(result.netPix,99.2);
  assert.equal(result.totalAvailable,585.7);
  assert.equal(result.machineSettlements.Stone.netCard,292.5);
  assert.equal(result.machineSettlements.Stone.netPix,59.4);
});

test('saídas detalhadas reduzem somente o dinheiro esperado',()=>{
  const result=calculateClosing({
    system_cash:300,system_pix:200,counted_cash:220,stone_pix:120,sipag_pix:80,
    outflows:[{description:'Motoboy',amount:50},{description:'Compra',amount:30}]
  });
  assert.equal(result.expenseTotal,80);
  assert.equal(result.expectedCash,220);
  assert.equal(result.differences.cash,0);
});

test('soma Pix separadamente por máquina',()=>{
  const result=calculateClosing({
    system_credit:100,system_debit:50,system_pix:90,
    stone_credit:100,stone_debit:20,stone_pix:40,
    sipag_debit:30,sipag_pix:50
  });
  assert.equal(result.countedByMethod.card,150);
  assert.equal(result.countedByMethod.pix,90);
  assert.equal(result.difference,0);
});

test('Pix de motoboy ou freelancer só vira saída após confirmação do financeiro',()=>{
  const record={
    system_cash:100,counted_cash:100,
    pixRequests:[{type:'Motoboy',amount:70,status:'pending'},{type:'Freelancer',amount:90,status:'pending'}]
  };
  const review={finance_cash:100,pixPaymentStatuses:[{status:'paid'},{status:'rejected'}]};
  const result=calculateFinanceReview(record,review);
  assert.equal(result.paidPixRequests,70);
  assert.equal(result.totalOutflows,70);
  assert.equal(result.totalAvailable,0);
});

test('classifica divergência por tolerância configurada',()=>{
  assert.equal(differenceSeverity(0,1),'balanced');
  assert.equal(differenceSeverity(0.75,1),'warning');
  assert.equal(differenceSeverity(-1,1),'warning');
  assert.equal(differenceSeverity(1.01,1),'critical');
});

test('consolida bruto, taxas, líquidos, Pix pago, sangria e divergência',()=>{
  const rows=[{
    withdrawals:50,sangria_delivered:true,financeReview:{finance_sangria_received:false},
    financeCalc:{grossCard:300,cardFeeTotal:9,netCard:291,grossPix:100,pixFeeTotal:1,netPix:99,paidPixRequests:20,totalAvailable:370,totalDifference:-2}
  },{
    withdrawals:30,sangria_delivered:true,financeReview:{finance_sangria_received:true},
    financeCalc:{grossCard:200,cardFeeTotal:4,netCard:196,grossPix:50,pixFeeTotal:.5,netPix:49.5,paidPixRequests:0,totalAvailable:245.5,totalDifference:2}
  }];
  assert.deepEqual(summarizeFinance(rows),{
    grossCard:500,cardFees:13,netCard:487,grossPix:150,pixFees:1.5,netPix:148.5,
    paidPix:20,pendingSangria:50,totalAvailable:615.5,totalDifference:0
  });
});


test('valida valores financeiros e bloqueia negativos, textos e limites excessivos',()=>{
  assert.equal(validateClosingAmounts({system_cash:100,counted_cash:'90,50'}),true);
  assert.equal(validateClosingAmounts({system_cash:-1}),false);
  assert.equal(validateClosingAmounts({system_pix:'valor inválido'}),false);
  assert.equal(validateClosingAmounts({withdrawals:10000001}),false);
  assert.equal(validateClosingAmounts({outflows:[{amount:0}]}),false);
  assert.equal(validateClosingAmounts({pixRequests:[{amount:25}]}),true);
});


test('resumo operacional mostra destino do dinheiro e disponibilidade prevista',()=>{
  const result=calculateOperationalFinancialSummary({
    system_cash:200,system_credit:500,system_debit:100,system_pix:200,
    counted_cash:150,closing_float:50,
    stone_credit:500,stone_debit:100,stone_pix:200,
    pixRequests:[{amount:80}]
  },{Stone:{credit:2,debit:1,pix:.5}});
  assert.equal(result.grossSales,1000);
  assert.equal(result.physicalCash,200);
  assert.equal(result.cardFees,11);
  assert.equal(result.pixFees,1);
  assert.equal(result.bankNet,788);
  assert.equal(result.pixRequested,80);
  assert.equal(result.projectedAvailable,908);
});
