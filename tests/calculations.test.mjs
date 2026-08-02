import test from 'node:test';
import assert from 'node:assert/strict';
import { numberFrom, calculateClosing, calculateFinanceReview } from '../calculations.js';

test('converte valores brasileiros',()=>{
  assert.equal(numberFrom('1.234,56'),1234.56);
  assert.equal(numberFrom('100,50'),100.5);
  assert.equal(numberFrom(''),0);
});

test('caixa conciliado por forma de pagamento',()=>{
  const result=calculateClosing({system_cash:100,system_pix:50,counted_cash:100,counted_pix:50});
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

test('financeiro concilia dinheiro, débito e crédito por máquina e Pix',()=>{
  const record={
    system_cash:100,system_credit:200,system_debit:100,system_pix:50,
    opening_float:20,withdrawals:10,outflows:[{amount:15}]
  };
  const review={
    finance_cash:95,finance_stone_credit:200,finance_stone_debit:60,
    finance_sipag_debit:40,finance_pix:50
  };
  const result=calculateFinanceReview(record,review);
  assert.equal(result.totalDifference,0);
  assert.equal(result.actual.card,300);
  assert.equal(result.totalAvailable,445);
  assert.equal(result.status,'balanced');
});

test('saídas detalhadas reduzem somente o dinheiro esperado',()=>{
  const result=calculateClosing({
    system_cash:300,system_pix:200,counted_cash:220,counted_pix:200,
    outflows:[{description:'Motoboy',amount:50},{description:'Compra',amount:30}]
  });
  assert.equal(result.expenseTotal,80);
  assert.equal(result.expectedCash,220);
  assert.equal(result.differences.cash,0);
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
  assert.equal(result.totalAvailable,30);
});
