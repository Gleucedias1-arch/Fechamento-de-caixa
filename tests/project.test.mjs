import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const [html,app,css,rules,packageJson,driveScript,closingScript,selfieScript,firebaseJson] = await Promise.all([
  fs.readFile(new URL('../index.html',import.meta.url),'utf8'),
  fs.readFile(new URL('../app.js',import.meta.url),'utf8'),
  fs.readFile(new URL('../styles.css',import.meta.url),'utf8'),
  fs.readFile(new URL('../database.rules.json',import.meta.url),'utf8'),
  fs.readFile(new URL('../package.json',import.meta.url),'utf8'),
  fs.readFile(new URL('../google-apps-script/Code.gs',import.meta.url),'utf8'),
  fs.readFile(new URL('../google-apps-script/fechamento/Code.gs',import.meta.url),'utf8'),
  fs.readFile(new URL('../google-apps-script/selfies/Code.gs',import.meta.url),'utf8'),
  fs.readFile(new URL('../firebase.json',import.meta.url),'utf8'),
]);

test('área financeira e indicadores existem na interface',()=>{
  for (const id of [
    'financeView','financeRows','financeReviewPanel','financeReviewForm','kpiEntries',
    'kpiOutflows','kpiAvailable','kpiDiff','kpiReviewed','kpiPending','reviewSystemValues',
    'reviewCardMachines','financeCardFields','financePixRequests','outflowRows','pixRequestRows'
    ,'machineSelection','selectedMachineCards','pixConferenceTotal','selectedMachineCount',
    'kpiSangria','financeSangria','cardFeeSettings','financeGrossCard','financeCardFees',
    'financeNetCard','financeGrossPix','financePixFees','financeNetPix','financeNetAvailable','reviewSangriaAlert',
    'financeSummaryGrid','financeReopened','reviewAttachments',
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
  assert.match(html,/Pagamentos via Pix/);
});

test('todos os elementos obrigatórios acessados pelo JavaScript existem no HTML',()=>{
  const optionalRemoved=new Set([
    'attachmentList','attachmentCategory',
    'closingValidationPanel','closingValidationTitle','closingValidationCount','closingValidationItems',
    'operatorGrossSales','operatorPhysicalCash','operatorBankNet','operatorPixRequested','operatorProjectedAvailable'
  ]);
  const ids=[...app.matchAll(/\$\('#([^']+)'\)/g)].map(match=>match[1]);
  const missing=[...new Set(ids)].filter(id=>!optionalRemoved.has(id) && !html.includes(`id="${id}"`));
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
  assert.equal(JSON.parse(packageJson).version,'2.5.2');
  assert.match(html,/app\.js\?v=2\.5\.2/);
  assert.match(html,/styles\.css\?v=2\.5\.2/);
});

test('solicitação Pix mantém Nome e Chave amplos sem ultrapassar o cartão',()=>{
  assert.match(css,/\.pix-request-editor \{ display: grid; grid-template-columns: repeat\(12,minmax\(0,1fr\)\)/);
  assert.match(css,/\.pix-request-editor > label:nth-child\(2\) \{ grid-column: span 7; \}/);
  assert.match(css,/\.pix-request-editor > label:nth-child\(3\) \{ grid-column: span 7; \}/);
  assert.match(css,/\.pix-request-editor > label:nth-child\(4\) \{ grid-column: span 5; \}/);
  assert.match(css,/\.pix-request-editor > label:nth-child\(5\) \{ grid-column: 1 \/ -1; \}/);
  assert.match(css,/@media \(max-width: 600px\)[\s\S]*\.pix-request-editor > label:nth-child\(n\), \.pix-request-editor-actions \{ grid-column: auto; \}/);
});

test('múltiplas solicitações Pix ficam compactas e apenas uma permanece aberta',()=>{
  assert.match(html,/id="pixRequestCount"/);
  assert.match(app,/function pixRequestIsComplete/);
  assert.match(app,/function setPixRequestEditing/);
  assert.match(app,/Conclua o Pix atual antes de adicionar outro/);
  assert.match(app,/data-pix-action="finish"/);
  assert.match(app,/data-pix-action="edit"/);
  assert.match(css,/\.pix-request-card\.is-collapsed \.pix-request-editor \{ display: none; \}/);
  assert.match(css,/\.pix-request-card\.is-editing \.pix-request-summary \{ display: none; \}/);
  assert.match(css,/\.pix-request-summary \{[\s\S]*min-height: 64px/);
});

test('rótulos de recebimentos permanecem inteiros em cartões estreitos',()=>{
  assert.match(css,/\.machine-entry-fields label \{ min-width: 0; grid-template-columns: minmax\(72px, \.65fr\) minmax\(0, 1\.35fr\);/);
  assert.match(css,/\.machine-entry-fields label > span \{ min-width: 0;[\s\S]*white-space: nowrap;/);
  assert.match(css,/\.machine-entry-fields input \{ min-width: 0;/);
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

test('novo fechamento guia o operador por etapas e reduz ruído visual',()=>{
  assert.match(html,/id="closingProgress"/);
  assert.equal((html.match(/class="closing-progress-item/g) || []).length,5);
  assert.match(css,/grid-template-areas:\s*"site conference"\s*"movement pix"\s*"movement final"/);
  assert.match(css,/@media \(max-width: 760px\)[\s\S]*grid-template-areas:\s*"site"\s*"conference"\s*"movement"\s*"pix"\s*"final"/);
  assert.match(html,/class="optional-receipts"/);
  assert.doesNotMatch(html,/id="attachmentCamera"/);
  assert.doesNotMatch(html,/class="attachment-uploader"/);
  assert.match(app,/closingHasOperationalInput/);
  assert.match(html,/Aguardando o preenchimento dos valores/);
  assert.match(css,/#outflowRows:empty::before/);
  assert.doesNotMatch(app,/buildMachineSelection\(\);\s*addOutflowRow\(\);/);
});

test('fechamento inteligente conecta operação, financeiro e gestão',()=>{
  for (const id of [
    'openingFloatSuggestion','applyOpeningFloat','financialOverviewGrid',
    'reviewPendingPanel','reviewPendingItems','operatorCorrectionComparison'
  ]) assert.match(html,new RegExp(`id="${id}"`));
  assert.doesNotMatch(html,/id="closingValidationPanel"/);
  assert.doesNotMatch(html,/id="operatorProjectedAvailable"/);
  assert.match(app,/function buildClosingIssues/);
  assert.doesNotMatch(app,/Relatório da maquininha ausente/);
  assert.match(app,/function renderDashboardFinancialOverview/);
  assert.match(app,/function renderFinancePendingPanel/);
  assert.match(app,/function renderOperatorCorrectionComparison/);
  assert.match(app,/function loadOpeningFloatSuggestion/);
  assert.match(app,/return 'attachments'/);
  assert.match(app,/return 'pix'/);
  assert.match(css,/\.closing-validation-panel/);
  assert.match(css,/\.financial-overview-grid/);
  assert.match(css,/\.review-pending-panel/);
  assert.match(rules,/openingFloatSourceId/);
});

test('fila financeira possui todos os estados priorizados',()=>{
  for (const status of ['open','pending','divergent','sangria','approved','reopened','returned','all']) {
    assert.match(html,new RegExp(`<option value="${status}"`));
  }
  assert.match(app,/function queueCategory/);
  assert.match(app,/function queuePriority/);
  assert.match(css,/\.badge\.sangria/);
});

test('uploader do operador foi removido e o suporte legado do Drive permanece isolado',()=>{
  assert.doesNotMatch(html,/accept="image\/\*,application\/pdf"/);
  assert.match(app,/DRIVE_UPLOAD_URL/);
  assert.match(app,/https:\/\/script\.google\.com\/macros\/s\/AKfycbz5Tmf2y6j6Zaw_msslxU0IQ1jZUH1RSSTxbAr7x-aOXFqWROEGd7W4WBZxqKIJLcRx\/exec/);
  assert.doesNotMatch(app,/https:\/\/script\.google\.com\/macros\/s\/AKfycbzNlFEnYAGp3GOS0jD6f2rQ-qklOe4fO8hDUDbYD_ANi_aJcPxpJKReDsQJP2rkTwd0\/exec/);
  assert.match(app,/uploadClosingAttachment/);
  assert.match(app,/fileToDataUrl/);
  assert.match(app,/storage:'google-drive'/);
  assert.doesNotMatch(app,/firebase-storage|getStorage|uploadBytes|getDownloadURL/);
  assert.equal(JSON.parse(firebaseJson).storage,undefined);
  assert.match(closingScript,/maxFileBytes: 2 \* 1024 \* 1024/);
  assert.match(closingScript,/"application\/pdf"/);
  assert.match(closingScript,/DriveApp\.Access\.ANYONE_WITH_LINK/);
});

test('Apps Script mantém selfies e fechamento em serviços separados',()=>{
  assert.match(selfieScript,/action === "uploadClockSelfie"/);
  assert.doesNotMatch(selfieScript,/uploadClosingAttachment/);
  assert.match(selfieScript,/CacheService\.getScriptCache\(\)/);
  assert.match(selfieScript,/lock\.waitLock\(5000\)/);
  assert.doesNotMatch(selfieScript,/waitLock\(20000\)/);
  assert.match(selfieScript,/"https:\/\/drive\.google\.com\/file\/d\/" \+ fileId/);

  assert.match(closingScript,/action === "uploadClosingAttachment"/);
  assert.match(closingScript,/action === "deleteClosingAttachment"/);
  assert.doesNotMatch(closingScript,/uploadClockSelfie/);
  assert.match(closingScript,/firebaseClosingProfile_/);
  assert.match(closingScript,/assertClosingStore_/);
  assert.match(closingScript,/uploaderUid: uid/);
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
  assert.match(rules,/root\.child\('closings'\)\.child\(\$id\)\.child\('status'\)\.val\(\) !== 'approved'/);
});

test('divergências exigem motivo e usam tolerância configurável',()=>{
  assert.match(html,/name="divergence_reason"/);
  assert.match(html,/name="finance_divergence_reason"/);
  assert.match(app,/differenceSeverity/);
  assert.match(app,/settings\/divergenceTolerance/);
  assert.match(rules,/divergenceTolerance/);
});


test('rascunhos e fechamentos devolvidos podem ser recuperados no histórico',()=>{
  assert.match(app,/data-edit-closing/);
  assert.match(app,/function openClosingForEdit/);
  assert.match(app,/Devolvido para correção/);
  assert.match(app,/Rascunho recuperado/);
  assert.match(rules,/data\.child\('status'\)\.val\(\) === 'returned'/);
});

test('duplicidades e valores inválidos são bloqueados antes do envio',()=>{
  assert.match(app,/function closingDocumentId/);
  assert.match(app,/Já existe um fechamento para esta loja, data e turno/);
  assert.match(app,/validateClosingAmounts/);
  assert.match(rules,/newData\.val\(\) >= 0 && newData\.val\(\) <= 10000000/);
});

test('operadores consultam somente a própria loja e financeiro corrige apenas valores autorizados',()=>{
  assert.match(app,/orderByChild\('store'\),equalTo\(store\)/);
  assert.match(rules,/query\.orderByChild === 'store'/);
  assert.match(rules,/query\.equalTo === root\.child\('users'\)/);
  const parsed=JSON.parse(rules);
  assert.doesNotMatch(parsed.rules.closings.$id['.write'],/role'\)\.val\(\) === 'finance'/);
  assert.match(parsed.rules.closings.$id.financeReview['.write'],/role'\)\.val\(\) === 'finance'/);
  assert.match(parsed.rules.closings.$id.system_cash['.write'],/role'\)\.val\(\) === 'finance'/);
  assert.equal(parsed.rules.closings.$id.store['.write'],undefined);
  assert.equal(parsed.rules.closings.$id.createdBy['.write'],undefined);
});

test('financeiro corrige valores mantendo original, motivo e auditoria',()=>{
  assert.match(html,/id="toggleOperatorCorrection"/);
  assert.match(html,/id="operatorCorrectionPanel"/);
  assert.match(app,/function operatorCorrectionEntries/);
  assert.match(app,/operatorOriginalValues/);
  assert.match(app,/lastOperatorCorrection/);
  assert.match(app,/operator_values_corrected/);
  assert.match(app,/O dashboard usará a versão do financeiro/);
  assert.match(app,/await loadDashboard\(\);[\s\S]*await loadFinance\(\)/);
  assert.match(app,/changeDetails/);
  assert.match(rules,/operatorOriginalValues/);
  assert.match(rules,/lastOperatorCorrection/);
});

test('cálculo enriquecido não substitui o status do fluxo',()=>{
  assert.match(app,/status:calculationStatus/);
  assert.match(app,/return \{\.\.\.record,\.\.\.calc,calculationStatus,financeCalc:finance\}/);
});

test('somente remetente, financeiro ou administrador pode excluir comprovantes do Drive',()=>{
  assert.match(closingScript,/metadata\.uploaderUid/);
  assert.match(closingScript,/profile\.role === "admin" \|\| profile\.role === "finance"/);
  assert.match(closingScript,/Sem permissão para excluir/);
  assert.match(closingScript,/file\.setTrashed\(true\)/);
});


test('envio mantém compatibilidade com as regras atuais e oferece destino da sangria',()=>{
  assert.match(app,/delete persistedData\.openingFloatSourceId/);
  assert.match(html,/Onde está a sangria\?/);
  assert.match(html,/Está em loja/);
  assert.match(html,/Entregue ao gerente/);
  assert.match(html,/Entregue ao supervisor/);
  assert.match(html,/Entregue ao dono/);
  assert.match(html,/<select name="sangria_responsible">/);
});


test('finalização mantém apenas resultado, justificativa e ações essenciais',()=>{
  assert.doesNotMatch(html,/class="attachment-uploader"/);
  assert.doesNotMatch(html,/VERIFICAÇÃO INTELIGENTE/);
  assert.doesNotMatch(html,/RESUMO FINANCEIRO PREVISTO/);
  assert.match(html,/id="diffTotal"/);
  assert.match(html,/name="divergence_reason"/);
  assert.match(html,/name="notes"/);
  assert.match(html,/id="saveDraft"/);
  assert.match(html,/Enviar ao financeiro/);
});
