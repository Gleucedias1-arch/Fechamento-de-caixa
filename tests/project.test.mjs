import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const [html,app,css,rules,storageRules,packageJson] = await Promise.all([
  fs.readFile(new URL('../index.html',import.meta.url),'utf8'),
  fs.readFile(new URL('../app.js',import.meta.url),'utf8'),
  fs.readFile(new URL('../styles.css',import.meta.url),'utf8'),
  fs.readFile(new URL('../database.rules.json',import.meta.url),'utf8'),
  fs.readFile(new URL('../storage.rules',import.meta.url),'utf8'),
  fs.readFile(new URL('../package.json',import.meta.url),'utf8'),
]);

test('área financeira e indicadores existem na interface',()=>{
  for (const id of [
    'financeView','financeRows','financeReviewPanel','financeReviewForm','kpiEntries',
    'kpiOutflows','kpiAvailable','kpiDiff','kpiReviewed','kpiPending','reviewSystemValues',
    'reviewCardMachines','financeCardFields','financePixRequests','outflowRows','pixRequestRows'
    ,'machineSelection','selectedMachineCards','pixConferenceTotal','selectedMachineCount',
    'kpiSangria','financeSangria','cardFeeSettings','financeGrossCard','financeCardFees',
    'financeNetCard','financeGrossPix','financePixFees','financeNetPix','financeNetAvailable','reviewSangriaAlert',
    'financeSummaryGrid','financeReopened','attachmentFiles','attachmentList','reviewAttachments',
    'auditTimeline','reopenClosing','divergenceTolerance','closingDivergenceFields','financeDivergenceFields'
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
  assert.ok(parsed.rules.settings.cardFeeRates);
  assert.ok(parsed.rules.settings.cardFeeRates.$machine.pix);
  assert.match(rules,/role'\)\.val\(\) === 'finance'/);
  assert.match(rules,/approved/);
  assert.match(rules,/returned/);
  assert.match(rules,/reopened/);
  assert.match(rules,/auditLogs/);
});

test('versão e cache estão atualizados',()=>{
  assert.equal(JSON.parse(packageJson).version,'2.1.2');
  assert.match(html,/app\.js\?v=2\.1\.2/);
  assert.match(html,/styles\.css\?v=2\.1\.2/);
});

test('solicitação Pix mantém Nome e Chave amplos e Valor compacto',()=>{
  assert.match(css,/\.pix-request-row \{[\s\S]*minmax\(190px, 1\.15fr\)[\s\S]*minmax\(220px, 1\.35fr\)[\s\S]*minmax\(96px, \.55fr\)/);
  assert.match(css,/@media \(max-width: 1100px\)[\s\S]*\.pix-request-row > label:nth-child\(4\) \{ grid-column: span 3; \}[\s\S]*\.pix-request-row > label:nth-child\(5\) \{ grid-column: span 8; \}/);
  assert.match(css,/@media \(max-width: 600px\)[\s\S]*\.pix-request-row > label:nth-child\(n\),[\s\S]*grid-column: auto;/);
});

test('botão de excluir movimentação permanece visível em todas as larguras',()=>{
  assert.match(css,/\.entry-row \{[^}]*grid-template-columns: minmax\(96px, \.85fr\) minmax\(0, 1\.65fr\) minmax\(96px, \.8fr\) 40px;/);
  assert.match(css,/\.entry-row > label \{ min-width: 0; \}/);
  assert.match(css,/@media \(max-width: 600px\)[\s\S]*\.entry-row,[\s\S]*\.pix-request-row \{ grid-template-columns: 1fr; \}/);
  assert.match(css,/@media \(max-width: 600px\)[\s\S]*\.entry-remove \{ width: 100%; min-height: 44px; \}/);
});

test('fechamento não exibe nem salva ajustes autorizados',()=>{
  assert.doesNotMatch(html,/Ajustes autorizados/);
  assert.doesNotMatch(html,/name="adjustments"/);
  assert.doesNotMatch(app,/'cash_in','closing_float','adjustments'/);
});

test('identidade visual usa base clara e destaques profissionais',()=>{
  assert.match(css,/Refresh visual leve e profissional/);
  assert.match(css,/\.sidebar \{ background: #fff; color: var\(--ink\);/);
  assert.match(css,/\.sheet-titlebar,[\s\S]*background: #fff; color: var\(--ink\);/);
  assert.match(css,/\.sheet-section \.section-number[\s\S]*background: var\(--blue-soft\); color: var\(--blue\);/);
  assert.match(css,/\.btn-primary \{ background: var\(--blue\); color: #fff;/);
});

test('celular não usa tabelas largas nem força zoom nos campos',()=>{
  assert.match(html,/class="mobile-card-table divergence-table"/);
  assert.match(html,/class="mobile-card-table finance-queue-table"/);
  assert.match(app,/data-label="Divergência"/);
  assert.match(app,/data-label="Comprovantes"/);
  assert.match(css,/@media \(max-width: 600px\)[\s\S]*\.closing-card-grid[\s\S]*grid-template-columns: 1fr/);
  assert.match(css,/input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)[\s\S]*font-size: 16px !important/);
  assert.match(css,/\.mobile-card-table tbody tr[\s\S]*display: grid/);
});

test('dashboard separa disponível bancário e sangria física',()=>{
  assert.match(html,/Cartão líquido \+ Pix líquido conferidos/);
  assert.match(html,/id="kpiSangriaCard"/);
  assert.match(app,/approvedRows\.reduce/);
  assert.match(app,/function sangriaAvailable/);
  assert.match(css,/\.sangria-kpi\.sangria-active/);
});

test('financeiro configura taxas de cartão e Pix e visualiza a conciliação líquida',()=>{
  assert.match(html,/Taxas por maquininha/);
  assert.match(html,/id="toggleRateSettings"/);
  assert.match(app,/settings\/cardFeeRates/);
  assert.match(app,/data-machine-fee/);
  assert.match(app,/data-rate-type="pix"/);
  assert.match(html,/Cartão bruto/);
  assert.match(html,/Cartão líquido/);
  assert.match(html,/Pix bruto/);
  assert.match(html,/Taxas Pix/);
  assert.match(html,/Pix líquido/);
  assert.match(html,/Somente cartão líquido \+ Pix líquido/);
  assert.match(css,/\.finance-workbench/);
});

test('fechamento usa hierarquia compacta inspirada na planilha',()=>{
  assert.match(html,/class="sheet-titlebar"/);
  assert.match(html,/class="form-grid money-grid sheet-value-grid"/);
  assert.match(css,/#closingForm \{ width: min\(1180px, 100%\); margin: 0 auto; \}/);
  assert.match(html,/class="closing-card-grid"/);
  assert.match(css,/\.closing-card-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(html,/class="closing-column"/);
  assert.match(css,/\.closing-column \{ display: flex; flex-direction: column;/);
  assert.match(css,/\.sheet-value-grid \{ grid-template-columns: 1fr;/);
  assert.match(css,/\.selected-machine-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css,/\.machine-entry-fields \{ display: grid; grid-template-columns: 1fr;/);
  assert.match(css,/\.movement-values \{ grid-template-columns: 1fr; \}/);
  assert.match(html,/Nenhuma máquina selecionada/);
  assert.match(html,/Marque apenas as máquinas usadas neste fechamento/);
  assert.match(css,/@media \(max-width: 440px\)[\s\S]*\.selected-machine-grid, \.machine-summary-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
});

test('identificação e finalização são compactas e bem agrupadas',()=>{
  assert.match(css,/\.identification-card \.form-grid \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(html,/class="card closing-final-card"/);
  assert.match(html,/class="closing-final-main"/);
  assert.match(html,/class="closing-final-footer"/);
  assert.match(css,/\.closing-final-main \{ display: grid; grid-template-columns: 1fr;/);
  assert.match(html,/pix-request-section[\s\S]*closing-final-card[\s\S]*<\/div>\s*<\/div>\s*<\/form>/);
});

test('fila financeira possui todos os estados priorizados',()=>{
  for (const status of ['open','pending','divergent','sangria','approved','reopened','returned','all']) {
    assert.match(html,new RegExp(`<option value="${status}"`));
  }
  assert.match(app,/function queueCategory/);
  assert.match(app,/function queuePriority/);
  assert.match(css,/\.badge\.sangria/);
});

test('comprovantes aceitam fotos e PDF com regras de armazenamento',()=>{
  assert.match(html,/accept="image\/\*,application\/pdf"/);
  assert.match(app,/uploadPendingAttachments/);
  assert.match(app,/getDownloadURL/);
  assert.match(storageRules,/request\.resource\.size <= 2 \* 1024 \* 1024/);
  assert.match(storageRules,/application\/pdf/);
});

test('sangria registra entrega e recebimento completos',()=>{
  assert.match(html,/name="sangria_responsible"/);
  assert.match(html,/name="sangria_delivered_at"/);
  assert.match(app,/sangriaReceivedByName/);
  assert.match(app,/sangriaReceivedAt/);
});

test('aprovação bloqueia o fechamento e reabertura exige administrador e motivo',()=>{
  assert.match(app,/setFinanceReviewLocked/);
  assert.match(app,/profile\?\.role !== 'admin'/);
  assert.match(app,/Informe o motivo da reabertura/);
  assert.match(app,/appendAudit\(id,'reopened'/);
  assert.match(rules,/data\.child\('status'\)\.val\(\) !== 'approved'/);
});

test('divergências exigem motivo e usam tolerância configurável',()=>{
  assert.match(html,/name="divergence_reason"/);
  assert.match(html,/name="finance_divergence_reason"/);
  assert.match(app,/differenceSeverity/);
  assert.match(app,/settings\/divergenceTolerance/);
  assert.match(rules,/divergenceTolerance/);
});
