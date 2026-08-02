import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const [html,app,css,rules,packageJson] = await Promise.all([
  fs.readFile(new URL('../index.html',import.meta.url),'utf8'),
  fs.readFile(new URL('../app.js',import.meta.url),'utf8'),
  fs.readFile(new URL('../styles.css',import.meta.url),'utf8'),
  fs.readFile(new URL('../database.rules.json',import.meta.url),'utf8'),
  fs.readFile(new URL('../package.json',import.meta.url),'utf8'),
]);

test('área financeira e indicadores existem na interface',()=>{
  for (const id of [
    'financeView','financeRows','financeReviewPanel','financeReviewForm','kpiEntries',
    'kpiOutflows','kpiAvailable','kpiDiff','kpiReviewed','kpiPending','reviewSystemValues',
    'reviewCardMachines','financeCardFields','financePixRequests','outflowRows','pixRequestRows'
    ,'machineSelection','selectedMachineCards','pixConferenceTotal','selectedMachineCount'
  ]) assert.match(html,new RegExp(`id="${id}"`));
});

test('conferência se limita a dinheiro, cartão e Pix, com cartão por máquina',()=>{
  assert.match(html,/Confira somente Dinheiro, Cartão e Pix/);
  assert.match(app,/Stone: \['stone_credit','stone_debit','stone_pix'\]/);
  assert.match(html,/Escolha as máquinas utilizadas/);
  assert.match(html,/Crédito, Débito e Pix/);
  assert.match(app,/stone_pix/);
  assert.match(app,/selectedMachines/);
  assert.doesNotMatch(html,/Diferença cartão/i);
  assert.doesNotMatch(html,/name="counted_ifood"/);
  assert.doesNotMatch(html,/name="counted_other"/);
});

test('financeiro confirma campos e pagamentos Pix',()=>{
  assert.match(html,/name="finance_confirm_outflows"/);
  assert.match(app,/pixPaymentStatuses/);
  assert.match(html,/Confirmo que conferi todas as saídas declaradas/);
  assert.match(html,/Pagamento via Pix/);
});

test('todos os elementos acessados pelo JavaScript existem no HTML',()=>{
  const ids=[...app.matchAll(/\$\('#([^']+)'\)/g)].map(match=>match[1]);
  const missing=[...new Set(ids)].filter(id=>!html.includes(`id="${id}"`));
  assert.deepEqual(missing,[]);
});

test('perfil financeiro e aprovação estão protegidos nas regras',()=>{
  const parsed=JSON.parse(rules);
  assert.ok(parsed.rules.closings.$id.financeReview);
  assert.match(rules,/role'\)\.val\(\) === 'finance'/);
  assert.match(rules,/approved/);
  assert.match(rules,/returned/);
});

test('versão e cache estão atualizados',()=>{
  assert.equal(JSON.parse(packageJson).version,'1.6.0');
  assert.match(html,/app\.js\?v=1\.6\.0/);
  assert.match(html,/styles\.css\?v=1\.6\.0/);
});

test('fechamento usa hierarquia compacta inspirada na planilha',()=>{
  assert.match(html,/class="sheet-titlebar"/);
  assert.match(html,/class="form-grid money-grid sheet-value-grid"/);
  assert.match(css,/#closingForm \{ width: min\(1180px, 100%\); margin: 0 auto; \}/);
  assert.match(html,/class="closing-card-grid"/);
  assert.match(css,/\.closing-card-grid, \.closing-summary-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css,/\.sheet-value-grid \{ grid-template-columns: 1fr;/);
  assert.match(css,/\.selected-machine-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css,/\.machine-entry-fields \{ display: grid; grid-template-columns: 1fr;/);
  assert.match(css,/\.movement-values \{ grid-template-columns: 1fr; \}/);
  assert.match(html,/Nenhuma máquina selecionada/);
  assert.match(html,/Marque apenas as máquinas usadas neste fechamento/);
  assert.match(css,/@media \(max-width: 440px\)[\s\S]*\.selected-machine-grid, \.machine-summary-grid, \.machine-finance-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
});
