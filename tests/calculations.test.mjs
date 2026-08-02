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
  assert.deepEqual(result.differences,{cash:0,card:0,pix:0,ifood:0,other:0});
});

test('movimentações e despesas ajustam o dinheiro esperado',()=>{
  const result=calculateClosing({
    system_cash:100,counted_cash:60,opening_float:20,withdrawals:40,
    expense_motoboy:10,expenses:10
  });
  assert.equal(result.expenseTotal,20);
  assert.equal(result.expectedCash,60);
  assert.equal(result.countedTotal,100);
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

test('auditoria iFood usa vendas iFood e não o débito',()=>{
  const record={system_debit:500,system_ifood_online:120,system_ifood_voucher:30};
  const result=calculateFinanceReview(record,{finance_ifood:150});
  assert.equal(result.expected.ifood,150);
  assert.equal(result.differences.ifood,0);
});

test('financeiro concilia caixa, cartões líquidos, Pix, iFood, cupom e motoboy',()=>{
  const record={
    system_cash:100,system_credit:200,system_pix:50,system_ifood_online:80,system_term:20,
    opening_float:20,withdrawals:10,expenses:15,expense_motoboy:30
  };
  const review={
    finance_cash:65,finance_card_fees:10,finance_stone:190,finance_pix:50,
    finance_ifood:80,finance_other:20,finance_coupon_issued:350,
    finance_motoboy_system:25,finance_free_delivery:5
  };
  const result=calculateFinanceReview(record,review);
  assert.equal(result.totalDifference,0);
  assert.equal(result.fiscalDifference,0);
  assert.equal(result.motoboyDifference,0);
  assert.equal(result.totalAvailable,305);
  assert.equal(result.status,'balanced');
});
