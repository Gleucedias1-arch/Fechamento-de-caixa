import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const [html,app,rules,packageJson] = await Promise.all([
  fs.readFile(new URL('../index.html',import.meta.url),'utf8'),
  fs.readFile(new URL('../app.js',import.meta.url),'utf8'),
  fs.readFile(new URL('../database.rules.json',import.meta.url),'utf8'),
  fs.readFile(new URL('../package.json',import.meta.url),'utf8'),
]);

test('área financeira e indicadores existem na interface',()=>{
  for (const id of [
    'financeView','financeRows','financeReviewPanel','financeReviewForm','kpiEntries',
    'kpiOutflows','kpiAvailable','kpiDiff','kpiReviewed','kpiPending'
  ]) assert.match(html,new RegExp(`id="${id}"`));
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
  assert.equal(JSON.parse(packageJson).version,'1.1.0');
  assert.match(html,/app\.js\?v=1\.1\.0/);
  assert.match(html,/styles\.css\?v=1\.1\.0/);
});
