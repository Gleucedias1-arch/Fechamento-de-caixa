import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getDatabase, ref, get, set, push, update, query, orderByChild, equalTo, startAt, endAt } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
import { firebaseConfig, ADMIN_EMAIL } from './firebase-config.js';
import {
  SYSTEM_FIELDS, COUNTED_FIELDS, EXPENSE_FIELDS, CARD_FIELDS, MACHINE_PIX_FIELDS,
  FINANCE_MACHINE_FIELDS, FINANCE_CONFIRM_FIELDS,
  numberFrom, validateClosingAmounts, calculateClosing, calculateFinanceReview, calculateOperationalFinancialSummary,
  summarizeFinance, differenceSeverity, formatBRL
} from './calculations.js';

const STORES = ['House 190 Teixeira','House 190 Eunápolis','House Food Park Teixeira'];
const OPERATOR_GROUPS = {
  Stone: ['stone_credit','stone_debit','stone_pix'], Sipag: ['sipag_credit','sipag_debit','sipag_pix'],
  Cielo: ['cielo_credit','cielo_debit','cielo_pix'], Cappta: ['cappta_credit','cappta_debit','cappta_pix'],
  Laranjinha: ['laranjinha_credit','laranjinha_debit','laranjinha_pix'], Wise: ['wise_credit','wise_debit','wise_pix'],
};
const MACHINE_FIELDS = [...CARD_FIELDS,...MACHINE_PIX_FIELDS];
const FINANCE_FIELDS = [
  'finance_cash',...FINANCE_MACHINE_FIELDS,'finance_adjustments'
];
const OPERATION_FIELDS = [
  ...SYSTEM_FIELDS,...COUNTED_FIELDS,...EXPENSE_FIELDS,'opening_float','withdrawals',
  'cash_in','closing_float'
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const DRIVE_UPLOAD_URL = 'https://script.google.com/macros/s/AKfycbz5Tmf2y6j6Zaw_msslxU0IQ1jZUH1RSSTxbAr7x-aOXFqWROEGd7W4WBZxqKIJLcRx/exec';
const CLOSING_ATTACHMENT_TYPES = new Set([
  'image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'
]);
let profile = null;
let currentClosings = [];
let financeClosings = [];
let historyClosings = [];
let currentReviewRecord = null;
let cardFeeRates = Object.fromEntries(Object.keys(OPERATOR_GROUPS).map(machine => [machine,{credit:0,debit:0,pix:0}]));
let divergenceTolerance = 1;
let pendingAttachments = [];
let savedAttachments = [];
let closingAmountsTouched = false;
let suggestedOpeningFloat = null;
let openingFloatSuggestionRequest = 0;

const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const isoToday = () => new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
const isFinance = () => ['admin','finance'].includes(profile?.role);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const formatDate = value => value?.includes('-') ? value.split('-').reverse().join('/') : '—';
const nearZero = value => Math.abs(numberFrom(value)) < 0.01;
const formatDateTime = value => value ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(numberFrom(value) || value)) : '—';

function differenceClass(value) {
  return {balanced:'positive',warning:'warning-text',critical:'negative'}[differenceSeverity(value,divergenceTolerance)];
}

function differenceLabel(value) {
  const severity = differenceSeverity(value,divergenceTolerance);
  if (severity === 'balanced') return ['ok','Correto'];
  if (severity === 'warning') return ['warn','Pequena diferença'];
  return ['bad','Diferença crítica'];
}

async function appendAudit(closingId, action, details = '') {
  if (!closingId || !auth.currentUser) return;
  const auditRef = push(ref(db,`auditLogs/${closingId}`));
  await set(auditRef,{
    action,details:String(details || ''),timestamp:Date.now(),
    actorId:auth.currentUser.uid,actorName:profile?.name || auth.currentUser.email,
    actorRole:profile?.role || 'unknown'
  });
}

function toast(message, error=false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show${error ? ' error-toast' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.className = 'toast', 3200);
}

function allowedStores() {
  return isFinance() ? STORES : (profile?.stores || (profile?.store ? [profile.store] : []));
}

function fillStores() {
  ['#dashStore','select[name="store"]','#historyStore','#financeStore','#userForm select[name="store"]'].forEach(selector => {
    const el = $(selector);
    if (!el) return;
    const withAll = selector.includes('history') || selector.includes('dash') || selector.includes('finance');
    el.innerHTML = (withAll ? '<option value="all">Todas as lojas</option>' : '')
      + allowedStores().map(store => `<option>${escapeHtml(store)}</option>`).join('');
  });
}

async function ensureProfile(user) {
  const snap = await get(ref(db, `users/${user.uid}`));
  if (snap.exists()) return snap.val();
  if (user.email?.toLowerCase() !== ADMIN_EMAIL) throw new Error('Usuário sem perfil autorizado. Procure o administrador.');
  const first = {name:'Gleuce Dias',email:user.email,role:'admin',stores:STORES,active:true,createdAt:Date.now()};
  await set(ref(db, `users/${user.uid}`), first);
  return first;
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    profile = null;
    $('#loginView').classList.remove('hidden');
    $('#appView').classList.add('hidden');
    return;
  }
  try {
    profile = await ensureProfile(user);
    if (profile.active === false) throw new Error('Acesso desativado.');
    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    $('#userName').textContent = profile.name || user.email;
    $('#userRole').textContent = {admin:'Administrador',finance:'Financeiro',manager:'Gerente',operator:'Operador'}[profile.role] || profile.role;
    $('#userInitial').textContent = (profile.name || user.email)[0].toUpperCase();
    $$('.admin-only').forEach(el => el.classList.toggle('hidden', profile.role !== 'admin'));
    $$('.finance-only').forEach(el => el.classList.toggle('hidden', !isFinance()));
    fillStores();
    initDates();
    await loadCardFeeRates(false);
    await loadDashboard();
    if (profile.role === 'admin') loadUsers();
  } catch (error) {
    toast(error.message, true);
    await signOut(auth);
  }
});

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('#loginError').textContent = '';
  try {
    await signInWithEmailAndPassword(auth, $('#loginEmail').value.trim(), $('#loginPassword').value);
  } catch {
    $('#loginError').textContent = 'E-mail ou senha inválidos.';
  }
});
$('#logoutBtn').onclick = () => signOut(auth);
$('#menuBtn').onclick = () => $('.sidebar').classList.toggle('open');
$$('.nav-item[data-view]').forEach(button => button.onclick = () => showView(button.dataset.view));

function showView(name) {
  if (name === 'finance' && !isFinance()) name = 'dashboard';
  if (name === 'users' && profile?.role !== 'admin') name = 'dashboard';
  $$('.view').forEach(view => view.classList.remove('active-view'));
  $(`#${name}View`).classList.add('active-view');
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === name));
  $('#pageTitle').textContent = {dashboard:'Dashboard',closing:'Novo fechamento',finance:'Conferência financeira',history:'Histórico',users:'Usuários'}[name];
  $('.sidebar').classList.remove('open');
  if (name === 'history') loadHistory();
  if (name === 'finance') loadFinance();
  if (name === 'closing') loadOpeningFloatSuggestion();
}

function initDates() {
  const today = isoToday();
  $('#todayLabel').textContent = new Intl.DateTimeFormat('pt-BR',{dateStyle:'full'}).format(new Date(`${today}T12:00:00`));
  $('#dashDate').value = today;
  $('[name="date"]').value = today;
  $('#financeDate').value = today;
  $('#historyTo').value = today;
  const first = new Date(`${today}T12:00:00`);
  first.setDate(1);
  $('#historyFrom').value = first.toISOString().slice(0,10);
}

function closingFormData() {
  const raw = Object.fromEntries(new FormData($('#closingForm')));
  OPERATION_FIELDS.forEach(key => raw[key] = numberFrom(raw[key]));
  raw.selectedMachines = $$('.machine-select:checked').map(input => input.value);
  raw.sangria_delivered = $('[name="sangria_delivered"]').checked;
  if ($('#closingForm').dataset.openingFloatSourceId) {
    raw.openingFloatSourceId = $('#closingForm').dataset.openingFloatSourceId;
  }
  raw.outflows = $$('.outflow-row').map(row => ({
    category:$('[data-outflow-field="category"]',row).value,
    description:$('[data-outflow-field="description"]',row).value.trim(),
    amount:numberFrom($('[data-outflow-field="amount"]',row).value)
  })).filter(item => item.description || item.amount);
  raw.pixRequests = $$('.pix-request-row').map(row => ({
    type:$('[data-pix-field="type"]',row).value,
    name:$('[data-pix-field="name"]',row).value.trim(),
    pixKey:$('[data-pix-field="key"]',row).value.trim(),
    amount:numberFrom($('[data-pix-field="amount"]',row).value),
    notes:$('[data-pix-field="notes"]',row).value.trim(),
    status:'pending'
  })).filter(item => item.name || item.pixKey || item.amount);
  return raw;
}

function financeFormData() {
  const raw = Object.fromEntries(new FormData($('#financeReviewForm')));
  FINANCE_FIELDS.forEach(key => { if (Object.hasOwn(raw,key)) raw[key] = numberFrom(raw[key]); });
  raw.finance_sangria_received = $('[name="finance_sangria_received"]').checked;
  FINANCE_CONFIRM_FIELDS.forEach(key => raw[key] = Boolean($(`[name="${key}"]`)?.checked));
  raw.pixPaymentStatuses = $$('.pix-payment-status').map((select,index) => ({index,status:select.value}));
  return raw;
}

function entryRemoveButton() {
  return '<button class="entry-remove" type="button" aria-label="Remover item">×</button>';
}

function selectedMachineNames() {
  return $$('.machine-select:checked').map(input => input.value);
}

function activeMachineEntries(record = {}) {
  const selected = Array.isArray(record.selectedMachines)
    ? record.selectedMachines.filter(name => OPERATOR_GROUPS[name]) : [];
  const names = selected.length ? selected : Object.entries(OPERATOR_GROUPS)
    .filter(([,fields]) => fields.some(field => !nearZero(record[field]) || !nearZero(record[`finance_${field}`])))
    .map(([name]) => name);
  return names.map(name => [name,OPERATOR_GROUPS[name]]);
}

function normalizedFeeRates(source = {}) {
  return Object.fromEntries(Object.keys(OPERATOR_GROUPS).map(machine => {
    const saved = source[machine] || source[machine.toLowerCase()] || {};
    return [machine,{credit:numberFrom(saved.credit),debit:numberFrom(saved.debit),pix:numberFrom(saved.pix)}];
  }));
}

function effectiveFeeRates(record = {}) {
  return normalizedFeeRates(record.financeReview?.cardFeeRates || cardFeeRates);
}

function renderCardFeeSettings() {
  const container = $('#cardFeeSettings');
  if (!container) return;
  container.innerHTML = Object.keys(OPERATOR_GROUPS).map(machine => {
    const rates = cardFeeRates[machine];
    return `<article class="rate-machine-card"><div><span>Maquininha</span><strong>${escapeHtml(machine)}</strong></div><label>Crédito (%)<input data-rate-machine="${escapeHtml(machine)}" data-rate-type="credit" inputmode="decimal" value="${rates.credit}" /></label><label>Débito (%)<input data-rate-machine="${escapeHtml(machine)}" data-rate-type="debit" inputmode="decimal" value="${rates.debit}" /></label><label>Pix (%)<input data-rate-machine="${escapeHtml(machine)}" data-rate-type="pix" inputmode="decimal" value="${rates.pix}" /></label></article>`;
  }).join('');
}

async function loadCardFeeRates(showMessage = false) {
  if (!isFinance()) {
    try {
      const toleranceSnap = await get(ref(db,'settings/divergenceTolerance'));
      divergenceTolerance = toleranceSnap.exists() ? Math.max(0,numberFrom(toleranceSnap.val())) : 1;
    } catch { divergenceTolerance = 1; }
    return;
  }
  try {
    const [rateSnap,toleranceSnap] = await Promise.all([
      get(ref(db,'settings/cardFeeRates')),
      get(ref(db,'settings/divergenceTolerance'))
    ]);
    cardFeeRates = normalizedFeeRates(rateSnap.exists() ? rateSnap.val() : {});
    divergenceTolerance = toleranceSnap.exists() ? Math.max(0,numberFrom(toleranceSnap.val())) : 1;
    if ($('#divergenceTolerance')) $('#divergenceTolerance').value = divergenceTolerance;
    renderCardFeeSettings();
  } catch {
    cardFeeRates = normalizedFeeRates(cardFeeRates);
    renderCardFeeSettings();
    if (showMessage) toast('Não foi possível carregar as taxas das maquininhas.',true);
  }
}

async function saveCardFeeRates() {
  const next = normalizedFeeRates(cardFeeRates);
  $$('[data-rate-machine]').forEach(input => {
    next[input.dataset.rateMachine][input.dataset.rateType] = numberFrom(input.value);
  });
  const invalid = Object.values(next).some(rates =>
    rates.credit < 0 || rates.credit > 100 || rates.debit < 0 || rates.debit > 100 || rates.pix < 0 || rates.pix > 100
  );
  if (invalid) throw new Error('As taxas devem ficar entre 0% e 100%.');
  const nextTolerance = Math.max(0,numberFrom($('#divergenceTolerance').value));
  await update(ref(db,'settings'),{cardFeeRates:next,divergenceTolerance:nextTolerance});
  cardFeeRates = next;
  divergenceTolerance = nextTolerance;
  renderCardFeeSettings();
  toast('Taxas e tolerância salvas. Os próximos cálculos usarão essa configuração.');
  await loadDashboard();
}

function machineInputCard(machine, fields) {
  const [credit,debit,pix] = fields;
  return `<article class="machine-entry-card" data-machine-card="${escapeHtml(machine)}"><div class="machine-sheet-title"><span>Máquina selecionada</span><h5>${escapeHtml(machine)}</h5></div><div class="machine-sheet-subtitle">RECEBIMENTOS</div><div class="machine-entry-fields"><label><span>Crédito</span><input name="${credit}" inputmode="decimal" value="0" /></label><label><span>Débito</span><input name="${debit}" inputmode="decimal" value="0" /></label><label><span>Pix</span><input name="${pix}" inputmode="decimal" value="0" /></label></div><div class="machine-card-total"><span>TOTAL</span><strong data-machine-total="${escapeHtml(machine)}">R$ 0,00</strong></div></article>`;
}

function renderSelectedMachineCards() {
  const previousValues = Object.fromEntries($$('input',$('#selectedMachineCards')).map(input => [input.name,input.value]));
  const selected = selectedMachineNames();
  $('#selectedMachineCards').innerHTML = selected.map(name => machineInputCard(name,OPERATOR_GROUPS[name])).join('');
  Object.entries(previousValues).forEach(([name,value]) => {
    const input = $(`#selectedMachineCards [name="${name}"]`);
    if (input) input.value = value;
  });
  $('#selectedMachineCount').textContent = `${selected.length} ${selected.length === 1 ? 'selecionada' : 'selecionadas'}`;
  $('#noMachineMessage').classList.toggle('hidden', selected.length > 0);
  updateClosingCalculation();
}

function buildMachineSelection() {
  $('#machineSelection').innerHTML = Object.keys(OPERATOR_GROUPS).map(machine => `<label class="machine-choice"><input class="machine-select" type="checkbox" value="${escapeHtml(machine)}" /><span>${escapeHtml(machine)}</span></label>`).join('');
  $('#machineSelection').addEventListener('change', renderSelectedMachineCards);
  renderSelectedMachineCards();
}

function addOutflowRow(item={}) {
  const row = document.createElement('div');
  row.className = 'entry-row outflow-row';
  row.innerHTML = `<label>Tipo<select data-outflow-field="category"><option>Motoboy</option><option>Freelancer</option><option>Fornecedor</option><option>Compra</option><option>Outros</option></select></label><label class="entry-description">Descrição<input data-outflow-field="description" value="${escapeHtml(item.description || '')}" placeholder="Nome ou motivo da saída" /></label><label>Valor<input data-outflow-field="amount" inputmode="decimal" value="${numberFrom(item.amount)}" /></label>${entryRemoveButton()}`;
  $('[data-outflow-field="category"]',row).value = item.category || 'Outros';
  $('#outflowRows').append(row);
}

function pixRequestIsComplete(row) {
  return Boolean(
    $('[data-pix-field="name"]',row).value.trim()
    && $('[data-pix-field="key"]',row).value.trim()
    && numberFrom($('[data-pix-field="amount"]',row).value) > 0
  );
}

function refreshPixRequestSummary(row) {
  const type = $('[data-pix-field="type"]',row).value;
  const name = $('[data-pix-field="name"]',row).value.trim() || 'Favorecido não informado';
  const key = $('[data-pix-field="key"]',row).value.trim() || 'Chave não informada';
  const amount = numberFrom($('[data-pix-field="amount"]',row).value);
  const notes = $('[data-pix-field="notes"]',row).value.trim() || 'Sem observação';
  $('[data-pix-summary="type"]',row).textContent = type;
  $('[data-pix-summary="name"]',row).textContent = name;
  $('[data-pix-summary="key"]',row).textContent = key;
  $('[data-pix-summary="amount"]',row).textContent = formatBRL(amount);
  $('[data-pix-summary="notes"]',row).textContent = notes;
}

function setPixRequestEditing(row, editing) {
  row.classList.toggle('is-editing',editing);
  row.classList.toggle('is-collapsed',!editing);
  const editButton = $('[data-pix-action="edit"]',row);
  if (editButton) editButton.setAttribute('aria-expanded',String(editing));
  refreshPixRequestSummary(row);
}

function refreshPixRequestList() {
  const rows = $$('.pix-request-row');
  rows.forEach((row,index) => {
    const number = $('[data-pix-summary="number"]',row);
    if (number) number.textContent = String(index + 1).padStart(2,'0');
    refreshPixRequestSummary(row);
  });
  const count = $('#pixRequestCount');
  if (count) count.textContent = `${rows.length} ${rows.length === 1 ? 'solicitação' : 'solicitações'}`;
}

function addPixRequestRow(item={}, editing = null) {
  const row = document.createElement('div');
  row.className = 'entry-row pix-request-row pix-request-card';
  row.innerHTML = `<div class="pix-request-summary"><span class="pix-request-number" data-pix-summary="number">01</span><div class="pix-request-identity"><span class="badge draft" data-pix-summary="type">Motoboy</span><strong data-pix-summary="name">Favorecido não informado</strong><small>Chave: <span data-pix-summary="key">não informada</span></small></div><div class="pix-request-value"><strong data-pix-summary="amount">R$ 0,00</strong><small data-pix-summary="notes">Sem observação</small></div><button class="pix-request-edit" data-pix-action="edit" type="button" aria-expanded="false">Editar</button>${entryRemoveButton()}</div><div class="pix-request-editor"><label>Pagamento para<select data-pix-field="type"><option>Motoboy</option><option>Freelancer</option></select></label><label>Nome<input data-pix-field="name" value="${escapeHtml(item.name || '')}" placeholder="Nome do favorecido" /></label><label>Chave Pix<input data-pix-field="key" value="${escapeHtml(item.pixKey || '')}" placeholder="CPF, telefone, e-mail..." /></label><label>Valor<input data-pix-field="amount" inputmode="decimal" value="${numberFrom(item.amount)}" /></label><label class="entry-description">Observação<input data-pix-field="notes" value="${escapeHtml(item.notes || '')}" placeholder="Motivo ou turno" /></label><div class="pix-request-editor-actions"><button class="btn btn-primary btn-small" data-pix-action="finish" type="button">Concluir Pix</button>${entryRemoveButton()}</div></div>`;
  $('[data-pix-field="type"]',row).value = item.type || 'Motoboy';
  $('#pixRequestRows').append(row);
  const shouldEdit = editing ?? !pixRequestIsComplete(row);
  setPixRequestEditing(row,shouldEdit);
  refreshPixRequestList();
  if (shouldEdit) $('[data-pix-field="name"]',row).focus();
}

function driveRequestId() {
  const fallback = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g,'') || fallback;
  return `attachment-${Date.now()}-${random}`.slice(0,100);
}

function fileToDataUrl(file) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Não foi possível ler o comprovante.'));
    reader.readAsDataURL(file);
  });
}

async function postDrive(payload) {
  const response = await fetch(DRIVE_UPLOAD_URL,{
    method:'POST',
    headers:{'Content-Type':'text/plain;charset=UTF-8'},
    body:JSON.stringify(payload),
    redirect:'follow'
  });
  let result = null;
  try {
    result = JSON.parse(await response.text());
  } catch (error) {
    throw new Error('O serviço do Google Drive retornou uma resposta inválida.');
  }
  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || 'Não foi possível acessar o Google Drive.');
  }
  return result;
}

async function deleteDriveAttachments(items) {
  const files = items.filter(item => item.driveFileId);
  if (!files.length || !auth.currentUser) return;
  const idToken = await auth.currentUser.getIdToken();
  await Promise.allSettled(files.map(item => postDrive({
    action:'deleteClosingAttachment',
    idToken,
    fileId:item.driveFileId
  })));
}

function renderAttachmentList() {
  const list = $('#attachmentList');
  if (!list) return;
  const saved = savedAttachments.map(item => `<div class="attachment-item saved"><div><span>${escapeHtml(item.category || 'Comprovante')}</span><b>${escapeHtml(item.name)}</b><small>${Math.round(numberFrom(item.size)/1024)} KB · ${item.storage === 'google-drive' ? 'Google Drive' : 'arquivo salvo'}</small></div><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Abrir</a></div>`);
  const pending = pendingAttachments.map(item => `<div class="attachment-item"><div><span>${escapeHtml(item.category)}</span><b>${escapeHtml(item.file.name)}</b><small>${Math.round(item.file.size/1024)} KB · aguardando envio</small></div><button type="button" data-remove-attachment="${escapeHtml(item.id)}">×</button></div>`);
  list.innerHTML = [...saved,...pending].join('') || '<p class="empty-inline">Nenhum comprovante selecionado.</p>';
}

function handleAttachmentSelection(event) {
  const files = [...event.target.files];
  const available = Math.max(0,5 - savedAttachments.length - pendingAttachments.length);
  const accepted = files.slice(0,available);
  if (files.length > available) toast('O limite é de 5 comprovantes por fechamento.',true);
  accepted.forEach(file => {
    if (file.size > 2*1024*1024) {
      toast(`${file.name} ultrapassa o limite de 2 MB.`,true);
      return;
    }
    if (!CLOSING_ATTACHMENT_TYPES.has(file.type.toLowerCase())) {
      toast(`${file.name} não é uma foto ou PDF válido.`,true);
      return;
    }
    pendingAttachments.push({id:`file-${Date.now()}-${Math.random().toString(36).slice(2)}`,file,category:$('#attachmentCategory').value});
  });
  event.target.value = '';
  renderAttachmentList();
  updateClosingCalculation();
}
['#attachmentFiles','#attachmentCamera'].forEach(selector => {
  $(selector)?.addEventListener('change',handleAttachmentSelection);
});

$('#attachmentList')?.addEventListener('click', event => {
  const button = event.target.closest('[data-remove-attachment]');
  if (!button) return;
  pendingAttachments = pendingAttachments.filter(item => item.id !== button.dataset.removeAttachment);
  renderAttachmentList();
});

async function uploadPendingAttachments(closingId,closingData) {
  const uploaded = [];
  try {
    const idToken = await auth.currentUser.getIdToken();
    for (const item of pendingAttachments) {
      const result = await postDrive({
        action:'uploadClosingAttachment',
        idToken,
        requestId:driveRequestId(),
        closingId,
        day:closingData.date,
        store:closingData.store,
        category:item.category,
        originalName:item.file.name,
        mimeType:item.file.type.toLowerCase(),
        fileDataUrl:await fileToDataUrl(item.file)
      });
      uploaded.push({
        name:item.file.name,category:item.category,type:item.file.type,size:item.file.size,
        url:result.fileUrl,driveFileId:result.fileId,driveFileName:result.fileName,
        storage:'google-drive',sharedWithLink:Boolean(result.sharedWithLink),
        uploadedAt:Date.now(),uploadedBy:auth.currentUser.uid,
        uploadedByName:profile?.name || auth.currentUser.email
      });
    }
    return uploaded;
  } catch (error) {
    await deleteDriveAttachments(uploaded);
    throw new Error(error?.message || 'Não foi possível enviar um dos comprovantes. Tente novamente.');
  }
}

$('#addOutflow').onclick = () => { addOutflowRow(); updateClosingCalculation(); };
$('#addPixRequest').onclick = () => {
  const openRow = $('.pix-request-row.is-editing');
  if (openRow && !pixRequestIsComplete(openRow)) {
    toast('Conclua o Pix atual antes de adicionar outro.',true);
    $('[data-pix-field="name"]',openRow).focus();
    return;
  }
  if (openRow) setPixRequestEditing(openRow,false);
  addPixRequestRow({},true);
  updateClosingCalculation();
};
['#outflowRows','#pixRequestRows'].forEach(selector => $(selector).addEventListener('click', event => {
  const button = event.target.closest('.entry-remove');
  if (button) {
    button.closest('.entry-row').remove();
    refreshPixRequestList();
    updateClosingCalculation();
  }
}));

$('#pixRequestRows').addEventListener('click', event => {
  const action = event.target.closest('[data-pix-action]');
  if (!action) return;
  const row = action.closest('.pix-request-row');
  if (action.dataset.pixAction === 'edit') {
    const otherOpen = $('.pix-request-row.is-editing');
    if (otherOpen && otherOpen !== row && !pixRequestIsComplete(otherOpen)) {
      toast('Conclua o Pix aberto antes de editar outro.',true);
      return;
    }
    if (otherOpen && otherOpen !== row) setPixRequestEditing(otherOpen,false);
    setPixRequestEditing(row,true);
    $('[data-pix-field="name"]',row).focus();
  }
  if (action.dataset.pixAction === 'finish') {
    if (!pixRequestIsComplete(row)) {
      toast('Preencha nome, chave Pix e valor para concluir.',true);
      return;
    }
    setPixRequestEditing(row,false);
    updateClosingCalculation();
  }
});

$('#pixRequestRows').addEventListener('input', event => {
  const row = event.target.closest('.pix-request-row');
  if (row) refreshPixRequestSummary(row);
});

$('[name="sangria_delivered"]').addEventListener('change', event => {
  $('#sangriaDetails').classList.toggle('hidden',!event.target.checked);
  if (event.target.checked && !$('[name="sangria_delivered_at"]').value) {
    const now = new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
    $('[name="sangria_delivered_at"]').value = now;
  }
});

function closingAttachmentCategories() {
  return [...savedAttachments,...pendingAttachments].map(item => String(item.category || ''));
}

function hasClosingAttachment(category) {
  return closingAttachmentCategories().includes(category);
}

function buildClosingIssues(data, result = calculateClosing(data)) {
  const issues = [];
  const add = (severity,title,message,target) => issues.push({severity,title,message,target});
  const systemMachineTotal = numberFrom(data.system_credit) + numberFrom(data.system_debit) + numberFrom(data.system_pix);
  const availableCashBeforeRemoval = numberFrom(data.opening_float) + numberFrom(data.system_cash) + numberFrom(data.cash_in);
  if (!String(data.operator || '').trim()) {
    add('error','Operador não informado','Informe quem realizou este fechamento.','operator');
  }
  if (systemMachineTotal > 0 && !data.selectedMachines.length) {
    add('error','Máquina não selecionada','Escolha ao menos uma máquina usada para Crédito, Débito ou Pix.','machine');
  }
  data.selectedMachines.forEach(machine => {
    const fields = OPERATOR_GROUPS[machine] || [];
    if (systemMachineTotal > 0 && fields.every(field => nearZero(data[field]))) {
      add('warning',`${machine} sem valores`,`A máquina ${machine} foi selecionada, mas Crédito, Débito e Pix estão zerados.`,'machine');
    }
  });
  if (numberFrom(data.withdrawals) > 0 && (!data.sangria_delivered || !String(data.sangria_responsible || '').trim() || !data.sangria_delivered_at)) {
    add('error','Entrega da sangria incompleta','Confirme o destino e o horário de registro da sangria.','sangria');
  }
  if (numberFrom(data.withdrawals) > availableCashBeforeRemoval) {
    add('warning','Sangria acima do dinheiro disponível','Revise o saldo inicial, as entradas e o valor retirado.','movement');
  }
  if (!nearZero(result.differences.card)) {
    add('warning','Cartões não conciliados',`Diferença de ${formatBRL(result.differences.card)} entre o site e as máquinas.`,'machine');
  }
  if (!nearZero(result.differences.pix)) {
    add('warning','Pix não conciliado',`Diferença de ${formatBRL(result.differences.pix)} entre o site e as máquinas.`,'machine');
  }
  if (!nearZero(result.difference) && (!String(data.divergence_reason || '').trim() || !String(data.notes || '').trim())) {
    add('error','Divergência sem justificativa','Selecione o motivo e descreva a diferença antes de enviar.','difference');
  }
  if (suggestedOpeningFloat && !nearZero(numberFrom(data.opening_float) - suggestedOpeningFloat.value)) {
    add('warning','Saldo inicial diferente do fechamento anterior',
      `O último troco aprovado foi ${formatBRL(suggestedOpeningFloat.value)}.`,'opening');
  }
  return issues;
}

function focusClosingIssue(target) {
  const selectors = {
    operator:'[name="operator"]',machine:'.store-conference-card',attachment:'#attachmentCategory',
    sangria:'.sangria-control',movement:'.movement-card',difference:'.closing-notes',
    opening:'[name="opening_float"]'
  };
  const element = $(selectors[target]);
  element?.scrollIntoView({behavior:'smooth',block:'center'});
  if (element?.matches('input,select,textarea,button')) setTimeout(() => element.focus(),350);
}

function renderClosingIssues(data, result, hasStarted) {
  if (!$('#closingValidationPanel')) return;
  const items = hasStarted ? buildClosingIssues(data,result) : [];
  const errors = items.filter(item => item.severity === 'error').length;
  const warnings = items.filter(item => item.severity === 'warning').length;
  $('#closingValidationPanel').classList.toggle('has-errors',errors > 0);
  $('#closingValidationPanel').classList.toggle('is-ready',hasStarted && !items.length);
  $('#closingValidationTitle').textContent = !hasStarted ? 'Aguardando preenchimento'
    : errors ? `${errors} ${errors === 1 ? 'erro precisa' : 'erros precisam'} de correção`
    : warnings ? `${warnings} ${warnings === 1 ? 'aviso encontrado' : 'avisos encontrados'}`
    : 'Fechamento pronto para envio';
  $('#closingValidationCount').textContent = !hasStarted ? '0' : items.length ? String(items.length) : 'OK';
  $('#closingValidationItems').innerHTML = !hasStarted
    ? '<p>Preencha o fechamento para iniciar as verificações.</p>'
    : items.length ? items.map(item => `<button type="button" class="validation-item ${item.severity}" data-closing-issue-target="${item.target}"><span>${item.severity === 'error' ? '!' : 'i'}</span><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.message)}</small></div><em>Corrigir →</em></button>`).join('')
    : '<div class="validation-success"><span>✓</span><div><b>Nenhuma pendência encontrada</b><small>Os dados obrigatórios e os comprovantes foram verificados.</small></div></div>';
}

function renderOperatorFinancialSummary(data) {
  if (!$('#operatorGrossSales')) return null;
  const summary = calculateOperationalFinancialSummary(data,effectiveFeeRates(data));
  $('#operatorGrossSales').textContent = formatBRL(summary.grossSales);
  $('#operatorPhysicalCash').textContent = formatBRL(summary.physicalCash);
  $('#operatorBankNet').textContent = formatBRL(summary.bankNet);
  $('#operatorPixRequested').textContent = formatBRL(summary.pixRequested);
  $('#operatorProjectedAvailable').textContent = formatBRL(summary.projectedAvailable);
  $('#operatorProjectedAvailable').className = summary.projectedAvailable < 0 ? 'negative' : '';
  return summary;
}

function closingHasOperationalInput(data) {
  return closingAmountsTouched
    || Boolean($('#closingForm').dataset.id)
    || OPERATION_FIELDS.some(field => !nearZero(data[field]))
    || data.selectedMachines.length > 0
    || data.outflows.length > 0
    || data.pixRequests.length > 0
    || pendingAttachments.length > 0
    || savedAttachments.length > 0;
}

function updateClosingProgress(data) {
  const completed = [
    SYSTEM_FIELDS.some(field => !nearZero(data[field])) || $('.site-information-card')?.dataset.touched === 'true',
    COUNTED_FIELDS.some(field => !nearZero(data[field])) || data.selectedMachines.length > 0 || $('.store-conference-card')?.dataset.touched === 'true',
    EXPENSE_FIELDS.some(field => !nearZero(data[field])) || data.outflows.length > 0 || $('.movement-card')?.dataset.touched === 'true',
    data.pixRequests.length > 0 || pendingAttachments.length > 0 || savedAttachments.length > 0 || $('.pix-request-section')?.dataset.touched === 'true',
    Boolean($('#closingForm').dataset.id)
  ];
  $('.closing-progress-item').forEach((item,index) => item.classList.toggle('is-complete',Boolean(completed[index])));
}

function setActiveClosingStep(section) {
  if (!section) return;
  $('.closing-progress-item').forEach(item => {
    item.classList.toggle('is-active',section.matches(item.dataset.stepTarget));
  });
}

function updateClosingCalculation() {
  const data = closingFormData();
  const result = calculateClosing(data);
  $('#systemTotal').textContent = formatBRL(result.systemTotal);
  $('#countedTotal').textContent = formatBRL(result.countedReceipts);
  $('#cardConferenceTotal').textContent = formatBRL(result.countedByMethod.card);
  $('#pixConferenceTotal').textContent = formatBRL(result.countedByMethod.pix);
  $('#outflowTotal').textContent = formatBRL(result.expenseTotal);
  $('#pixRequestTotal').textContent = formatBRL(data.pixRequests.reduce((sum,item) => sum + item.amount,0));
  refreshPixRequestList();
  activeMachineEntries(data).forEach(([machine,fields]) => {
    const total = fields.reduce((sum,field) => sum + numberFrom(data[field]),0);
    const output = $(`[data-machine-total="${machine}"]`);
    if (output) output.textContent = formatBRL(total);
  });
  $('#diffTotal').textContent = formatBRL(result.difference);
  const rec = $('.reconciliation');
  const icon = $('#diffBadge');
  const hasStarted = closingHasOperationalInput(data);
  updateClosingProgress(data);
  renderOperatorFinancialSummary(data);
  renderClosingIssues(data,result,hasStarted);
  rec.classList.toggle('is-idle',!hasStarted);
  if (!hasStarted) {
    rec.style.borderLeftColor = 'var(--line)';
    icon.className = 'result-icon idle';
    icon.textContent = '…';
    $('#diffExplanation').textContent = 'Aguardando o preenchimento dos valores.';
    $('#closingDivergenceFields').classList.add('hidden');
    return;
  }
  const severity = differenceSeverity(result.difference,divergenceTolerance);
  rec.style.borderLeftColor = severity === 'balanced' ? 'var(--green)' : severity === 'warning' ? 'var(--orange)' : 'var(--red)';
  icon.className = `result-icon ${severity === 'balanced' ? 'ok' : severity === 'warning' ? 'warn' : 'bad'}`;
  icon.textContent = severity === 'balanced' ? '✓' : '!';
  $('#diffExplanation').textContent = severity === 'balanced' ? 'Os valores estão conciliados.'
    : severity === 'warning' ? `Pequena diferença dentro da tolerância de ${formatBRL(divergenceTolerance)}.`
    : result.status === 'surplus' ? 'Foi encontrada sobra acima da tolerância.' : 'Foi encontrada falta acima da tolerância.';
  $('#closingDivergenceFields').classList.toggle('hidden',nearZero(result.difference));
}

$('#closingValidationItems')?.addEventListener('click', event => {
  const item = event.target.closest('[data-closing-issue-target]');
  if (item) focusClosingIssue(item.dataset.closingIssueTarget);
});

$('#closingProgress').addEventListener('click', event => {
  const item = event.target.closest('.closing-progress-item');
  if (!item) return;
  const section = $(item.dataset.stepTarget);
  setActiveClosingStep(section);
  section?.scrollIntoView({behavior:'smooth',block:'start'});
});

$('#closingForm').addEventListener('focusin', event => {
  const section = event.target.closest('.sheet-section,.closing-final-card');
  setActiveClosingStep(section);
});

$('#closingForm').addEventListener('input', event => {
  const section = event.target.closest('.sheet-section,.closing-final-card');
  if (section) section.dataset.touched = 'true';
  if (event.target.matches('[inputmode="decimal"],[data-outflow-field],[data-pix-field]')) {
    closingAmountsTouched = true;
  }
  updateClosingCalculation();
});

function closingDocumentId(data) {
  const slug = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
  return `closing-${data.date}-${slug(data.store)}-${slug(data.shift || 'turno')}`;
}

async function persistClosing(finalStatus) {
  const data = closingFormData();
  if (!validateClosingAmounts(data)) {
    throw new Error('Revise os valores: use somente números entre R$ 0,00 e R$ 10.000.000,00.');
  }
  const calc = calculateClosing(data);
  const user = auth.currentUser;
  if (!allowedStores().includes(data.store)) throw new Error('Loja não autorizada.');
  const editingId = $('#closingForm').dataset.id || '';
  const sameSlot = (await fetchClosings(data.date,data.date)).find(item =>
    item.id !== editingId && item.store === data.store && item.date === data.date
      && (item.shift || 'Noite') === (data.shift || 'Noite')
  );
  if (sameSlot) {
    throw new Error('Já existe um fechamento para esta loja, data e turno. Abra o registro existente no Histórico.');
  }
  const id = editingId || closingDocumentId(data);
  const now = Date.now();
  const existingSnap = await get(ref(db,`closings/${id}`));
  const existingRecord = existingSnap.exists() ? existingSnap.val() : {};
  if (!editingId && existingSnap.exists()) {
    throw new Error('Este fechamento já existe. Abra o registro existente no Histórico.');
  }
  const uploaded = await uploadPendingAttachments(id,data);
  const attachments = [...savedAttachments,...uploaded];
  const persistedData = {...data};
  // A referência do troco é apenas auxiliar na interface. Não deve bloquear
  // o envio em bancos que ainda usam as regras anteriores.
  delete persistedData.openingFloatSourceId;
  const record = {
    ...persistedData,...calc,id,attachments,status:finalStatus,locked:false,
    financeStatus: finalStatus === 'submitted' ? 'pending' : 'not_submitted',
    createdBy:existingRecord.createdBy || user.uid,createdByName:existingRecord.createdByName || profile.name,
    createdAt:existingRecord.createdAt || now,updatedAt:now,
    submittedAt:finalStatus === 'submitted' ? now : null,
    searchDateStore:`${data.date}_${data.store}`
  };
  try {
    await set(ref(db,`closings/${id}`),record);
  } catch (error) {
    await deleteDriveAttachments(uploaded);
    throw error;
  }
  savedAttachments = attachments;
  pendingAttachments = [];
  renderAttachmentList();
  $('#closingForm').dataset.id = id;
  $('#formStatus').textContent = finalStatus === 'submitted' ? 'Aguardando financeiro' : 'Rascunho';
  $('#formStatus').className = `badge ${finalStatus === 'submitted' ? 'warn' : 'draft'}`;
  await appendAudit(id,finalStatus === 'submitted' ? 'submitted' : 'draft_saved',
    finalStatus === 'submitted' ? `Fechamento enviado com ${attachments.length} comprovante(s).` : 'Rascunho salvo.').catch(()=>{});
  if (data.openingFloatSourceId && data.openingFloatSourceId !== existingRecord.openingFloatSourceId) {
    await appendAudit(id,'opening_float_connected',
      `Saldo inicial de ${formatBRL(data.opening_float)} conectado ao fechamento anterior.`).catch(()=>{});
  }
  toast(finalStatus === 'submitted' ? 'Caixa enviado ao financeiro.' : 'Rascunho salvo.');
  if (finalStatus === 'submitted') {
    setTimeout(() => { resetClosing(); showView('dashboard'); loadDashboard(); }, 700);
  }
}

$('#saveDraft').onclick = async () => {
  try { await persistClosing('draft'); } catch (error) { toast(error.message,true); }
};
$('#closingForm').addEventListener('submit', async event => {
  event.preventDefault();
  const formData = closingFormData();
  const result = calculateClosing(formData);
  const blockingIssues = buildClosingIssues(formData,result).filter(item => item.severity === 'error');
  if (blockingIssues.length) {
    renderClosingIssues(formData,result,true);
    toast(`Corrija ${blockingIssues.length} ${blockingIssues.length === 1 ? 'erro' : 'erros'} antes de enviar.`,true);
    focusClosingIssue(blockingIssues[0].target);
    return;
  }
  const invalidOutflow = formData.outflows.some(item => !item.description || item.amount <= 0);
  const invalidPix = formData.pixRequests.some(item => !item.name || !item.pixKey || item.amount <= 0);
  const needsMachine = numberFrom(formData.system_credit) + numberFrom(formData.system_debit) + numberFrom(formData.system_pix) > 0;
  if (needsMachine && !formData.selectedMachines.length) {
    toast('Escolha pelo menos uma máquina para conferir Crédito, Débito e Pix.',true);
    return;
  }
  if (invalidOutflow) {
    toast('Preencha a descrição e um valor maior que zero em todas as saídas.',true);
    return;
  }
  if (invalidPix) {
    toast('Preencha nome, chave Pix e valor em todas as solicitações.',true);
    return;
  }
  if (numberFrom(formData.withdrawals) > 0 && (!formData.sangria_delivered || !String(formData.sangria_responsible || '').trim() || !formData.sangria_delivered_at)) {
    toast('Selecione onde está a sangria e informe a data/horário.',true);
    return;
  }
  if (!nearZero(result.difference) && (!String(formData.divergence_reason || '').trim() || !$('[name="notes"]').value.trim())) {
    toast('Selecione o motivo e descreva a divergência antes de enviar.',true);
    return;
  }
  try { await persistClosing('submitted'); } catch (error) { toast(error.message,true); }
});

function resetClosing() {
  const form = $('#closingForm');
  form.reset();
  delete form.dataset.id;
  delete form.dataset.openingFloatSourceId;
  suggestedOpeningFloat = null;
  $('#openingFloatSuggestion').classList.add('hidden');
  initDates();
  $$('input[inputmode="decimal"]',form).forEach(input => input.value='0');
  $('#outflowRows').innerHTML = '';
  $('#pixRequestRows').innerHTML = '';
  pendingAttachments = [];
  savedAttachments = [];
  renderAttachmentList();
  $('#sangriaDetails').classList.add('hidden');
  $('#closingDivergenceFields').classList.add('hidden');
  $$('.machine-select').forEach(input => { input.checked = false; });
  $('.optional-receipts').open = false;
  renderSelectedMachineCards();
  closingAmountsTouched = false;
  $('.sheet-section,.closing-final-card').forEach(section => delete section.dataset.touched);
  $('#formStatus').textContent='Rascunho';
  $('#formStatus').className='badge draft';
  updateClosingCalculation();
}

async function fetchClosings(from, to) {
  if (isFinance()) {
    const snap = await get(query(ref(db,'closings'),orderByChild('date'),startAt(from),endAt(to)));
    return snap.exists() ? Object.values(snap.val()).filter(item => allowedStores().includes(item.store)) : [];
  }
  const snapshots = await Promise.all(allowedStores().map(store =>
    get(query(ref(db,'closings'),orderByChild('store'),equalTo(store)))
  ));
  const records = snapshots.flatMap(snap => snap.exists() ? Object.values(snap.val()) : []);
  return [...new Map(records.map(item => [item.id,item])).values()]
    .filter(item => item.date >= from && item.date <= to && allowedStores().includes(item.store));
}

function shiftIsoDate(date,days) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0,10);
}

async function loadOpeningFloatSuggestion() {
  const requestId = ++openingFloatSuggestionRequest;
  const form = $('#closingForm');
  const date = form.elements.date.value;
  const store = form.elements.store.value;
  suggestedOpeningFloat = null;
  $('#openingFloatSuggestion').classList.add('hidden');
  if (!date || !store || !profile) return;
  try {
    const until = shiftIsoDate(date,-1);
    const from = shiftIsoDate(date,-45);
    const previous = (await fetchClosings(from,until))
      .filter(item => item.store === store && financeState(item) === 'approved' && numberFrom(item.closing_float) > 0)
      .sort((a,b) => b.date.localeCompare(a.date) || numberFrom(b.reviewedAt)-numberFrom(a.reviewedAt))[0];
    if (requestId !== openingFloatSuggestionRequest || !previous) return;
    suggestedOpeningFloat = {id:previous.id,value:numberFrom(previous.closing_float),date:previous.date,shift:previous.shift || 'Turno'};
    $('#openingFloatSuggestionValue').textContent = formatBRL(suggestedOpeningFloat.value);
    $('#openingFloatSuggestionMeta').textContent = `${formatDate(suggestedOpeningFloat.date)} · ${suggestedOpeningFloat.shift} · aprovado pelo financeiro`;
    $('#openingFloatSuggestion').classList.remove('hidden');
    updateClosingCalculation();
  } catch {
    if (requestId === openingFloatSuggestionRequest) $('#openingFloatSuggestion').classList.add('hidden');
  }
}

$('#applyOpeningFloat').onclick = () => {
  if (!suggestedOpeningFloat) return;
  $('[name="opening_float"]').value = suggestedOpeningFloat.value;
  $('#closingForm').dataset.openingFloatSourceId = suggestedOpeningFloat.id;
  closingAmountsTouched = true;
  $('.movement-card').dataset.touched = 'true';
  updateClosingCalculation();
  toast('Troco anterior aplicado como saldo inicial.');
};
$('[name="date"]').addEventListener('change',loadOpeningFloatSuggestion);
$('[name="store"]').addEventListener('change',loadOpeningFloatSuggestion);

function enrichedClosing(record) {
  const {status:calculationStatus,...calc} = calculateClosing(record);
  const finance = record.financeReview
    ? calculateFinanceReview(record,{...record.financeReview,cardFeeRates:effectiveFeeRates(record)}) : null;
  return {...record,...calc,calculationStatus,financeCalc:finance};
}

function sangriaAvailable(record) {
  const delivered = Boolean(record.sangria_delivered);
  const received = Boolean(record.financeReview?.finance_sangria_received);
  return delivered && !received ? numberFrom(record.withdrawals) : 0;
}

function financeState(record) {
  if (record.financeStatus === 'approved' || record.status === 'approved') return 'approved';
  if (record.financeStatus === 'reopened' || record.status === 'reopened') return 'reopened';
  if (record.financeStatus === 'returned' || record.status === 'returned') return 'returned';
  if (record.status === 'draft') return 'draft';
  return 'pending';
}

function missingMachineReport(record) {
  const machines = activeMachineEntries(record);
  return machines.length > 0 && !(record.attachments || []).some(item => item.category === 'Relatório de maquininha');
}

function pendingPixRequestCount(record) {
  const statuses = record.financeReview?.pixPaymentStatuses || [];
  return (record.pixRequests || []).filter((request,index) =>
    (statuses[index]?.status || request.status || 'pending') === 'pending'
  ).length;
}

function queueCategory(record) {
  const state = financeState(record);
  if (['approved','reopened','returned','draft'].includes(state)) return state;
  if (sangriaAvailable(record) > 0) return 'sangria';
  if (missingMachineReport(record)) return 'attachments';
  if (pendingPixRequestCount(record) > 0) return 'pix';
  const difference = record.financeCalc?.totalDifference ?? record.difference;
  if (!nearZero(difference)) return 'divergent';
  return 'pending';
}

function queueBadge(record) {
  const map = {
    approved:['ok','Conferido'],reopened:['warn','Reaberto'],returned:['bad','Devolvido'],
    draft:['draft','Rascunho'],pending:['warn','Aguardando'],divergent:['bad','Com divergência'],
    sangria:['sangria','Aguardando sangria'],attachments:['bad','Comprovante pendente'],pix:['warn','Pix pendente']
  };
  const item = map[queueCategory(record)] || map.pending;
  return `<span class="badge ${item[0]}">${item[1]}</span>`;
}

function queuePriority(record) {
  const category = queueCategory(record);
  const severity = differenceSeverity(record.financeCalc?.totalDifference ?? record.difference,divergenceTolerance);
  const weights = {sangria:0,attachments:1,pix:2,divergent:severity === 'critical' ? 3 : 4,reopened:5,pending:6,returned:7,approved:8,draft:9};
  return weights[category] ?? 8;
}

function stateBadge(record) {
  const state = financeState(record);
  const map = {
    approved:['ok','Conferido'], reopened:['warn','Reaberto'], returned:['bad','Devolvido'], draft:['draft','Rascunho'], pending:['warn','Aguardando financeiro']
  };
  return `<span class="badge ${map[state][0]}">${map[state][1]}</span>`;
}

async function loadDashboard() {
  try {
    const date = $('#dashDate').value || isoToday();
    currentClosings = (await fetchClosings(date,date)).map(enrichedClosing);
    const store = $('#dashStore').value || 'all';
    const rows = currentClosings.filter(item => (store === 'all' || item.store === store) && item.status !== 'draft');
    const total = key => rows.reduce((sum,item) => sum + numberFrom(item[key]),0);
    const entries = total('systemTotal');
    const outflows = total('totalOutflows');
    const approvedRows = rows.filter(item => financeState(item) === 'approved' && item.financeCalc);
    const available = approvedRows.reduce((sum,item) => sum + numberFrom(item.financeCalc.totalAvailable),0);
    const sangria = rows.reduce((sum,item) => sum + sangriaAvailable(item),0);
    const sangriaCount = rows.filter(item => sangriaAvailable(item) > 0).length;
    const diff = rows.reduce((sum,item) => sum + numberFrom(item.financeCalc?.totalDifference ?? item.difference),0);
    const reviewed = rows.filter(item => financeState(item) === 'approved').length;
    const pending = rows.filter(item => financeState(item) === 'pending').length;
    $('#kpiEntries').textContent = formatBRL(entries);
    $('#kpiOutflows').textContent = formatBRL(outflows);
    $('#kpiAvailable').textContent = formatBRL(available);
    $('#kpiSangria').textContent = formatBRL(sangria);
    $('#kpiSangriaText').textContent = sangriaCount
      ? `${sangriaCount} ${sangriaCount === 1 ? 'caixa aguardando recebimento' : 'caixas aguardando recebimento'}`
      : 'Nenhuma sangria disponível';
    $('#kpiSangriaCard').classList.toggle('sangria-active',sangria > 0);
    $('#kpiDiff').textContent = formatBRL(diff);
    $('#kpiDiff').style.color = nearZero(diff) ? 'var(--green)' : diff > 0 ? 'var(--orange)' : 'var(--red)';
    $('#kpiDiffText').textContent = nearZero(diff) ? 'Sem divergência' : diff > 0 ? 'Sobra acumulada' : 'Falta acumulada';
    $('#kpiReviewed').textContent = reviewed;
    $('#kpiPending').textContent = pending;
    renderStoreStatus(rows);
    renderChannels(rows);
    renderDashboardFinancialOverview(rows);
    renderDivergences(rows);
  } catch (error) {
    toast('Não foi possível carregar o dashboard.',true);
  }
}

function renderStoreStatus(rows) {
  $('#storeStatus').innerHTML = allowedStores().map(store => {
    const found = rows.filter(item => item.store === store);
    const approved = found.filter(item => financeState(item) === 'approved').length;
    const returned = found.filter(item => financeState(item) === 'returned').length;
    const pending = found.filter(item => financeState(item) === 'pending').length;
    const diff = found.reduce((sum,item) => sum + numberFrom(item.financeCalc?.totalDifference ?? item.difference),0);
    const status = !found.length ? ['draft','Pendente'] : returned ? ['bad','Devolvido'] : pending ? ['warn','Aguardando'] : nearZero(diff) ? ['ok','Conferido'] : ['bad','Divergência'];
    return `<div class="store-row"><div><b>${escapeHtml(store)}</b><small>${found.length ? `${approved} conferido(s) · ${pending} aguardando` : 'Nenhum fechamento'}</small></div><strong>${found.length ? formatBRL(diff) : '—'}</strong><span class="badge ${status[0]}">${status[1]}</span></div>`;
  }).join('');
}

function renderChannels(rows) {
  const channels = [['Dinheiro','cash'],['Cartões','card'],['Pix','pix'],['iFood','ifood'],['Outros','other']];
  const values = channels.map(([label,key]) => [label,rows.reduce((sum,item) => sum + numberFrom(item.systemByMethod?.[key]),0)]);
  const max = Math.max(...values.map(item => item[1]),1);
  $('#channelBars').innerHTML = values.map(([label,value]) => `<div><div class="bar-head"><span>${label}</span><b>${formatBRL(value)}</b></div><div class="bar-track"><div class="bar-fill" style="width:${value/max*100}%"></div></div></div>`).join('');
}

function renderDashboardFinancialOverview(rows) {
  const totals = rows.reduce((summary,item) => {
    const operational = calculateOperationalFinancialSummary(item,effectiveFeeRates(item));
    const review = item.financeCalc;
    const statuses = item.financeReview?.pixPaymentStatuses || [];
    const commitments = (item.pixRequests || []).reduce((sum,request,index) =>
      sum + ((statuses[index]?.status || request.status || 'pending') === 'rejected' ? 0 : numberFrom(request.amount)),0);
    summary.gross += operational.grossSales;
    summary.cash += operational.physicalCash;
    summary.fees += numberFrom(review?.feeTotal ?? operational.feeTotal);
    summary.commitments += commitments;
    summary.available += operational.physicalCash
      + numberFrom(review?.netCard ?? operational.netCard)
      + numberFrom(review?.netPix ?? operational.netPix)
      - commitments;
    return summary;
  },{gross:0,cash:0,fees:0,commitments:0,available:0});
  $('#overviewGross').textContent = formatBRL(totals.gross);
  $('#overviewCash').textContent = formatBRL(totals.cash);
  $('#overviewFees').textContent = `− ${formatBRL(totals.fees)}`;
  $('#overviewPixCommitments').textContent = `− ${formatBRL(totals.commitments)}`;
  $('#overviewAvailable').textContent = formatBRL(totals.available);
  $('#overviewAvailable').className = totals.available < 0 ? 'negative' : '';
  const approved = rows.filter(item => financeState(item) === 'approved').length;
  $('#financialOverviewStatus').textContent = !rows.length ? 'Aguardando dados'
    : approved === rows.length ? 'Valores conferidos'
    : `${rows.length-approved} aguardando conferência`;
  $('#financialOverviewStatus').className = `badge ${rows.length && approved === rows.length ? 'ok' : 'draft'}`;
}

function renderDivergences(rows) {
  const divergent = rows.filter(item => {
    const source = item.financeCalc?.differences || item.differences;
    return Object.values(source || {}).some(value => !nearZero(value));
  }).sort((a,b) => Math.abs(numberFrom(b.financeCalc?.totalDifference ?? b.difference)) - Math.abs(numberFrom(a.financeCalc?.totalDifference ?? a.difference)));
  $('#divergenceRows').innerHTML = divergent.length ? divergent.map(item => {
    const diff = item.financeCalc?.differences || item.differences || {};
    const total = item.financeCalc?.totalDifference ?? item.difference;
    const label = differenceLabel(total);
    return `<tr><td data-label="Loja">${escapeHtml(item.store)}</td><td data-label="Operador">${escapeHtml(item.operator)}</td><td data-label="Dinheiro" class="${differenceClass(diff.cash)}">${formatBRL(diff.cash)}</td><td data-label="Cartão" class="${differenceClass(diff.card)}">${formatBRL(diff.card)}</td><td data-label="Pix" class="${differenceClass(diff.pix)}">${formatBRL(diff.pix)}</td><td data-label="Total" class="${differenceClass(total)}">${formatBRL(total)}</td><td data-label="Status"><span class="badge ${label[0]}">${label[1]}</span></td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">Nenhuma divergência encontrada.</td></tr>';
}
$('#refreshDash').onclick = loadDashboard;
$('#dashDate').onchange = loadDashboard;
$('#dashStore').onchange = loadDashboard;

async function loadFinance() {
  if (!isFinance()) return;
  try {
    await loadCardFeeRates(false);
    const date = $('#financeDate').value || isoToday();
    financeClosings = (await fetchClosings(date,date)).map(enrichedClosing);
    const store = $('#financeStore').value || 'all';
    const status = $('#financeStatus').value || 'open';
    const scoped = financeClosings.filter(item => store === 'all' || item.store === store);
    const openCategories = ['pending','divergent','sangria','attachments','pix','reopened'];
    const rows = scoped.filter(item => status === 'all' || (status === 'open' && openCategories.includes(queueCategory(item))) || queueCategory(item) === status);
    $('#financePending').textContent = scoped.filter(item => financeState(item) === 'pending').length;
    $('#financeApproved').textContent = scoped.filter(item => financeState(item) === 'approved').length;
    $('#financeReopened').textContent = scoped.filter(item => financeState(item) === 'reopened').length;
    $('#financePixPending').textContent = scoped.reduce((sum,item) => {
      const statuses = item.financeReview?.pixPaymentStatuses || [];
      return sum + (item.pixRequests || []).filter((request,index) => (statuses[index]?.status || request.status || 'pending') === 'pending').length;
    },0);
    $('#financeDivergent').textContent = scoped.filter(item => !nearZero(item.financeCalc?.totalDifference ?? item.difference)).length;
    const sangria = scoped.reduce((sum,item) => sum + sangriaAvailable(item),0);
    $('#financeSangria').textContent = formatBRL(sangria);
    $('#financeSangriaCard').classList.toggle('sangria-active',sangria > 0);
    const totalDiff = scoped.reduce((sum,item) => sum + numberFrom(item.financeCalc?.totalDifference ?? item.difference),0);
    $('#financeTotalDiff').textContent = formatBRL(totalDiff);
    $('#financeTotalDiff').style.color = nearZero(totalDiff) ? 'var(--green)' : totalDiff > 0 ? 'var(--orange)' : 'var(--red)';
    renderFinanceSummary(scoped);
    $('#financeRows').innerHTML = rows.length ? rows.sort((a,b) => queuePriority(a)-queuePriority(b) || numberFrom(a.submittedAt)-numberFrom(b.submittedAt)).map(item => {
      const diff = item.financeCalc?.totalDifference ?? item.difference;
      const diffLabel = differenceLabel(diff);
      const category = queueCategory(item);
      const priority = category === 'sangria' ? ['sangria','Sangria']
        : category === 'attachments' ? ['bad','Documento']
        : category === 'pix' ? ['warn','Pix']
        : differenceSeverity(diff,divergenceTolerance) === 'critical' ? ['bad','Alta']
        : differenceSeverity(diff,divergenceTolerance) === 'warning' ? ['warn','Média'] : ['draft','Normal'];
      return `<tr><td data-label="Prioridade"><span class="badge ${priority[0]}">${priority[1]}</span></td><td data-label="Data">${formatDate(item.date)}</td><td data-label="Loja">${escapeHtml(item.store)}</td><td data-label="Operador">${escapeHtml(item.operator)}</td><td data-label="Sangria">${sangriaAvailable(item) ? `<span class="sangria-table-value">${formatBRL(sangriaAvailable(item))}</span>` : '—'}</td><td data-label="Divergência" class="${differenceClass(diff)}">${formatBRL(diff)}<small class="cell-note">${diffLabel[1]}</small></td><td data-label="Comprovantes">${(item.attachments || []).length}</td><td data-label="Status">${queueBadge(item)}</td><td data-label="Ação"><button class="table-action" data-review-id="${escapeHtml(item.id)}">${financeState(item)==='approved'?'Ver':'Conferir'}</button></td></tr>`;
    }).join('') : '<tr><td colspan="9" class="empty">Nenhum fechamento neste filtro.</td></tr>';
    $('#financeReviewPanel').classList.add('hidden');
    $('#financeQueueCard').classList.remove('hidden');
  } catch {
    toast('Não foi possível carregar a fila financeira.',true);
  }
}

function renderFinanceSummary(rows) {
  const summary = summarizeFinance(rows.filter(item => item.financeCalc));
  const values = [
    ['Cartão bruto',summary.grossCard],['Taxas cartão',summary.cardFees,true],['Cartão líquido',summary.netCard],
    ['Pix bruto',summary.grossPix],['Taxas Pix',summary.pixFees,true],['Pix líquido',summary.netPix],
    ['Pagamentos Pix',summary.paidPix,true],['Sangrias pendentes',summary.pendingSangria],
    ['Total disponível',summary.totalAvailable],['Divergências',summary.totalDifference]
  ];
  $('#financeSummaryGrid').innerHTML = values.map(([label,value,negative=false]) => `<div class="${label==='Total disponível'?'summary-highlight':''}"><span>${escapeHtml(label)}</span><strong class="${negative?'fee-value':label==='Divergências'?differenceClass(value):''}">${negative?'− ':''}${formatBRL(value)}</strong></div>`).join('');
}
$('#loadFinance').onclick = loadFinance;
$('#financeDate').onchange = loadFinance;
$('#financeStore').onchange = loadFinance;
$('#financeStatus').onchange = loadFinance;
$('#financeRows').addEventListener('click', event => {
  const button = event.target.closest('[data-review-id]');
  if (button) openFinanceReview(button.dataset.reviewId);
});

function methodRows(record) {
  const labels = {cash:'Dinheiro',card:'Cartão',pix:'Pix'};
  return Object.keys(labels).map(key => {
    const expected = key === 'cash' ? record.expectedCash : record.systemByMethod[key];
    const informed = record.countedByMethod[key];
    const diff = record.differences[key];
    const status = differenceLabel(diff);
    return `<tr><td>${labels[key]}</td><td>${formatBRL(expected)}</td><td>${formatBRL(informed)}</td><td class="${differenceClass(diff)}">${formatBRL(diff)} <span class="badge ${status[0]}">${status[1]}</span></td></tr>`;
  }).join('');
}

function metric(label, value, asMoney=true) {
  return `<div><span>${escapeHtml(label)}</span><b>${asMoney ? formatBRL(value) : escapeHtml(value)}</b></div>`;
}

function renderSystemValues(record) {
  const items = [
    ['Dinheiro',record.system_cash],['Crédito',record.system_credit],['Débito',record.system_debit],
    ['Pix',record.system_pix],['iFood Online',record.system_ifood_online],['iFood Voucher',record.system_ifood_voucher],
    ['Notas a prazo',record.system_term],['Resgate Clube',record.system_club],['Acréscimos',record.system_accrual]
  ];
  return items.map(([label,value]) => `<div><span>${escapeHtml(label)}</span><strong>${formatBRL(value)}</strong></div>`).join('');
}

function operatorCorrectionEntries(record) {
  const base = [
    ['system_cash','Site · Dinheiro'],['system_credit','Site · Crédito'],['system_debit','Site · Débito'],
    ['system_pix','Site · Pix'],['system_ifood_online','Site · iFood Online'],['system_ifood_voucher','Site · iFood Voucher'],
    ['system_term','Site · Notas a prazo'],['system_club','Site · Resgate Clube'],['system_accrual','Site · Acréscimos'],
    ['counted_cash','Loja · Dinheiro contado'],['opening_float','Movimento · Saldo inicial'],
    ['cash_in','Movimento · Suprimentos'],['withdrawals','Movimento · Sangrias'],['closing_float','Movimento · Troco final']
  ];
  const machines = activeMachineEntries(record).flatMap(([machine,[credit,debit,pix]]) => [
    [credit,`${machine} · Crédito`],[debit,`${machine} · Débito`],[pix,`${machine} · Pix`]
  ]);
  return [...base,...machines];
}

function renderOperatorCorrection(record) {
  $('#operatorCorrectionFields').innerHTML = operatorCorrectionEntries(record).map(([field,label]) =>
    `<label><span>${escapeHtml(label)}</span><input data-operator-correction-field="${escapeHtml(field)}" inputmode="decimal" value="${numberFrom(record[field])}" /></label>`
  ).join('');
  $('#operatorCorrectionReason').value = '';
  $('#operatorCorrectionPanel').classList.add('hidden');
  $('#toggleOperatorCorrection').textContent = 'Corrigir valores';
}

function renderOperatorCorrectionComparison(record) {
  const correction = record.lastOperatorCorrection;
  const panel = $('#operatorCorrectionComparison');
  if (!correction?.fields?.length) {
    panel.classList.add('hidden');
    $('#operatorCorrectionComparisonRows').innerHTML = '';
    return;
  }
  panel.classList.remove('hidden');
  $('#operatorCorrectionComparisonMeta').textContent = `${correction.reason} · ${correction.correctedByName || 'Financeiro'} · ${formatDateTime(correction.correctedAt)}`;
  $('#operatorCorrectionComparisonRows').innerHTML = correction.fields.map(item => {
    const impact = numberFrom(item.after) - numberFrom(item.before);
    return `<tr><td>${escapeHtml(item.label || item.field)}</td><td>${formatBRL(item.before)}</td><td>${formatBRL(item.after)}</td><td class="${differenceClass(impact)}">${impact > 0 ? '+' : ''}${formatBRL(impact)}</td></tr>`;
  }).join('');
}

function renderCardMachines(record) {
  const machines = activeMachineEntries(record);
  if (!machines.length) return '<p class="empty-inline">Nenhuma máquina foi selecionada pela loja.</p>';
  return machines.map(([machine,[credit,debit,pix]]) => `<div class="machine-summary"><div class="machine-summary-head"><b>${escapeHtml(machine)}</b><span>UTILIZADA</span></div><div class="machine-summary-values"><span>Crédito <strong>${formatBRL(record[credit])}</strong></span><span>Débito <strong>${formatBRL(record[debit])}</strong></span><span>Pix <strong>${formatBRL(record[pix])}</strong></span></div><em>Total ${formatBRL(numberFrom(record[credit])+numberFrom(record[debit])+numberFrom(record[pix]))}</em></div>`).join('');
}

function renderOutflows(record) {
  if (Array.isArray(record.outflows) && record.outflows.length) {
    return record.outflows.map(item => metric(`${item.category || 'Saída'} · ${item.description || 'Sem descrição'}`,item.amount)).join('');
  }
  return [
    ['Motoboy',record.expense_motoboy],['Freelancer',record.expense_freelancer],
    ['Entrega grátis',record.expense_free_delivery],['Outras despesas',record.expenses],
    ['Ajustes/saídas',record.expense_other]
  ].filter(item => numberFrom(item[1])).map(item => metric(item[0],item[1])).join('') || metric('Saídas declaradas',0);
}

function renderFinancePixRequests(record, existing={}) {
  const requests = Array.isArray(record.pixRequests) ? record.pixRequests : [];
  if (!requests.length) return '<p class="empty-inline">Nenhuma solicitação de pagamento via Pix.</p>';
  const statuses = existing.pixPaymentStatuses || [];
  return requests.map((request,index) => {
    const selected = statuses[index]?.status || request.status || 'pending';
    return `<div class="pix-approval-row"><div><span class="badge warn">${escapeHtml(request.type)}</span><b>${escapeHtml(request.name || 'Sem nome')}</b><small>Chave: ${escapeHtml(request.pixKey || 'não informada')} · ${escapeHtml(request.notes || 'sem observação')}</small></div><strong>${formatBRL(request.amount)}</strong><label>Situação<select class="pix-payment-status"><option value="pending" ${selected==='pending'?'selected':''}>Pendente</option><option value="paid" ${selected==='paid'?'selected':''}>Pago</option><option value="rejected" ${selected==='rejected'?'selected':''}>Recusado</option></select></label></div>`;
  }).join('');
}

function renderReviewAttachments(record) {
  const attachments = Array.isArray(record.attachments) ? record.attachments : [];
  $('#reviewAttachmentCount').textContent = `${attachments.length} ${attachments.length === 1 ? 'arquivo' : 'arquivos'}`;
  $('#reviewAttachments').innerHTML = attachments.length ? attachments.map(item => `<a class="review-attachment" href="${escapeHtml(item.url)}" target="_blank" rel="noopener"><span>${escapeHtml(item.category || 'Comprovante')}</span><b>${escapeHtml(item.name || 'Arquivo')}</b><small>${Math.round(numberFrom(item.size)/1024)} KB · enviado por ${escapeHtml(item.uploadedByName || 'loja')}</small><em>Abrir comprovante ↗</em></a>`).join('') : '<p class="empty-inline">Nenhum comprovante foi anexado pela loja.</p>';
}

async function renderAuditTimeline(closingId) {
  try {
    const snap = await get(ref(db,`auditLogs/${closingId}`));
    const entries = snap.exists() ? Object.values(snap.val()).sort((a,b) => numberFrom(b.timestamp)-numberFrom(a.timestamp)) : [];
    const labels = {
      draft_saved:'Rascunho salvo',submitted:'Enviado ao financeiro',approved:'Conferência aprovada',
      returned:'Devolvido para correção',reopened:'Fechamento reaberto',operator_values_corrected:'Valores do operador corrigidos',
      opening_float_connected:'Troco conectado ao fechamento anterior'
    };
    $('#auditTimeline').innerHTML = entries.length ? entries.map(entry => `<div class="audit-entry"><span></span><div><b>${escapeHtml(labels[entry.action] || entry.action)}</b><p>${escapeHtml(entry.details || 'Sem detalhes adicionais.')}</p><small>${escapeHtml(entry.actorName || 'Usuário')} · ${formatDateTime(entry.timestamp)}</small></div></div>`).join('') : '<p class="empty-inline">Nenhuma alteração registrada nesta versão do fechamento.</p>';
  } catch {
    $('#auditTimeline').innerHTML = '<p class="empty-inline">Não foi possível carregar o histórico de alterações.</p>';
  }
}

function openFinanceReview(id) {
  currentReviewRecord = financeClosings.find(item => item.id === id);
  if (!currentReviewRecord) return;
  $('#financeQueueCard').classList.add('hidden');
  $('#financeReviewPanel').classList.remove('hidden');
  $('#reviewRecordTitle').textContent = `${currentReviewRecord.store} · ${formatDate(currentReviewRecord.date)}`;
  $('#reviewRecordMeta').textContent = `${currentReviewRecord.shift || 'Turno não informado'} · Operador: ${currentReviewRecord.operator || '—'}`;
  const state = financeState(currentReviewRecord);
  const statusMap = {approved:['ok','Conferido'],returned:['bad','Devolvido'],reopened:['warn','Reaberto'],pending:['warn','Aguardando financeiro']};
  $('#reviewStatus').outerHTML = `<span id="reviewStatus" class="badge ${statusMap[state]?.[0] || 'draft'}">${statusMap[state]?.[1] || 'Rascunho'}</span>`;
  $('#reviewEntries').textContent = formatBRL(currentReviewRecord.systemTotal);
  $('#reviewOutflows').textContent = formatBRL(currentReviewRecord.totalOutflows);
  const sangria = sangriaAvailable(currentReviewRecord);
  $('#reviewSangriaAlert').classList.toggle('hidden',sangria <= 0);
  $('#reviewSangriaAmount').textContent = formatBRL(sangria);
  $('#reviewSangriaDetails').innerHTML = currentReviewRecord.withdrawals ? `<b>Destino: ${escapeHtml(currentReviewRecord.sangria_responsible || 'não informado')}</b><small>${formatDateTime(currentReviewRecord.sangria_delivered_at)}</small>${currentReviewRecord.financeReview?.sangriaReceivedByName ? `<small>Recebido por ${escapeHtml(currentReviewRecord.financeReview.sangriaReceivedByName)} em ${formatDateTime(currentReviewRecord.financeReview.sangriaReceivedAt)}</small>` : ''}` : '';
  $('#reviewMethodRows').innerHTML = methodRows(currentReviewRecord);
  $('#reviewSystemValues').innerHTML = renderSystemValues(currentReviewRecord);
  renderOperatorCorrection(currentReviewRecord);
  renderOperatorCorrectionComparison(currentReviewRecord);
  $('#reviewCardMachines').innerHTML = renderCardMachines(currentReviewRecord);
  $('#reviewExpenses').innerHTML = renderOutflows(currentReviewRecord) + metric('Sangrias',currentReviewRecord.withdrawals);
  $('#reviewControls').innerHTML = metric('Saldo inicial',currentReviewRecord.opening_float)
    + metric('Troco final',currentReviewRecord.closing_float)
    + metric('Destino da sangria registrado',currentReviewRecord.sangria_delivered ? 'Sim' : 'Não',false)
    + metric('Onde está a sangria',currentReviewRecord.sangria_responsible || '—',false)
    + metric('Horário do registro',formatDateTime(currentReviewRecord.sangria_delivered_at),false)
    + metric('Divergência operacional',currentReviewRecord.difference);
  $('#reviewNotes').textContent = currentReviewRecord.notes || 'Nenhuma observação informada.';
  renderReviewAttachments(currentReviewRecord);
  buildFinanceCardFields(currentReviewRecord);
  const form = $('#financeReviewForm');
  form.reset();
  $$('input[inputmode="decimal"]',form).forEach(input => input.value='0');
  const existing = currentReviewRecord.financeReview || {};
  const defaults = {finance_cash:currentReviewRecord.counted_cash};
  MACHINE_FIELDS.forEach(key => defaults[`finance_${key}`] = currentReviewRecord[key]);
  FINANCE_FIELDS.forEach(key => {
    if (!form.elements[key]) return;
    form.elements[key].value = existing[key] !== undefined ? existing[key] : numberFrom(defaults[key]);
  });
  FINANCE_CONFIRM_FIELDS.forEach(key => { if (form.elements[key]) form.elements[key].checked = Boolean(existing[key]); });
  form.elements.finance_notes.value = existing.finance_notes || '';
  form.elements.finance_divergence_reason.value = existing.finance_divergence_reason || '';
  form.elements.finance_sangria_received.checked = Boolean(existing.finance_sangria_received);
  $('#financePixRequests').innerHTML = renderFinancePixRequests(currentReviewRecord,existing);
  $('#reopenPanel').classList.add('hidden');
  $('#reopenReason').value = '';
  updateFinanceCalculation();
  setFinanceReviewLocked(state === 'approved');
  renderAuditTimeline(currentReviewRecord.id);
  window.scrollTo({top:0,behavior:'smooth'});
}

function setFinanceReviewLocked(locked) {
  $$('input,select,textarea',$('#financeReviewForm')).forEach(field => { field.disabled = locked; });
  $('#approveClosing').classList.toggle('hidden',locked);
  $('#returnClosing').classList.toggle('hidden',locked);
  $('#reopenClosing').classList.toggle('hidden',!(locked && profile?.role === 'admin'));
  $('#toggleOperatorCorrection').classList.toggle('hidden',locked);
  if (locked) $('#operatorCorrectionPanel').classList.add('hidden');
}

$('#closeReview').onclick = () => {
  currentReviewRecord = null;
  $('#financeReviewPanel').classList.add('hidden');
  $('#financeQueueCard').classList.remove('hidden');
};

$('#toggleOperatorCorrection').onclick = () => {
  if (!currentReviewRecord || financeState(currentReviewRecord) === 'approved') {
    toast('Reabra o fechamento antes de corrigir os valores.',true);
    return;
  }
  const panel = $('#operatorCorrectionPanel');
  panel.classList.toggle('hidden');
  $('#toggleOperatorCorrection').textContent = panel.classList.contains('hidden') ? 'Corrigir valores' : 'Fechar correção';
};

$('#cancelOperatorCorrection').onclick = () => {
  if (currentReviewRecord) renderOperatorCorrection(currentReviewRecord);
};

$('#saveOperatorCorrection').onclick = async () => {
  if (!currentReviewRecord || !isFinance() || financeState(currentReviewRecord) === 'approved') return;
  const reason = $('#operatorCorrectionReason').value.trim();
  if (!reason) {
    toast('Informe o motivo da correção.',true);
    $('#operatorCorrectionReason').focus();
    return;
  }
  const entries = operatorCorrectionEntries(currentReviewRecord);
  const corrected = Object.fromEntries(entries.map(([field]) => [
    field,numberFrom($(`[data-operator-correction-field="${field}"]`).value)
  ]));
  const changed = entries.filter(([field]) => numberFrom(currentReviewRecord[field]) !== corrected[field]);
  if (!changed.length) {
    toast('Nenhum valor foi alterado.',true);
    return;
  }
  const nextRecord = {...currentReviewRecord,...corrected};
  if (!validateClosingAmounts(nextRecord)) {
    toast('Revise os valores corrigidos. Não são permitidos valores negativos ou inválidos.',true);
    return;
  }
  const originalValues = currentReviewRecord.operatorOriginalValues || Object.fromEntries(
    entries.map(([field]) => [field,numberFrom(currentReviewRecord[field])])
  );
  const {status:calculationStatus,...calc} = calculateClosing(nextRecord);
  const now = Date.now();
  const correction = {
    reason,fields:changed.map(([field,label]) => ({field,label,before:numberFrom(currentReviewRecord[field]),after:corrected[field]})),
    correctedAt:now,correctedBy:auth.currentUser.uid,correctedByName:profile.name || auth.currentUser.email
  };
  const id = currentReviewRecord.id;
  try {
    await update(ref(db,`closings/${id}`),{
      ...corrected,...calc,calculationStatus,operatorOriginalValues:originalValues,lastOperatorCorrection:correction,updatedAt:now
    });
    const changeDetails = changed.map(([field,label]) =>
      `${label}: ${formatBRL(currentReviewRecord[field])} → ${formatBRL(corrected[field])}`
    ).join(' | ');
    await appendAudit(id,'operator_values_corrected',`${reason} · ${changeDetails}`).catch(()=>{});
    toast('Valores do operador corrigidos. O dashboard usará a versão do financeiro.');
    await loadDashboard();
    await loadFinance();
    openFinanceReview(id);
  } catch (error) {
    toast(error.message || 'Não foi possível salvar a correção.',true);
  }
};

function buildFinancePendingItems(record,financeData,result) {
  const items = [];
  const add = (severity,title,message,target) => items.push({severity,title,message,target});
  if (missingMachineReport(record)) {
    add('error','Relatório de maquininha ausente','A loja selecionou máquinas, mas não anexou o relatório obrigatório.','attachments');
  }
  const pixPending = financeData.pixPaymentStatuses.filter(item => item.status === 'pending').length;
  if (pixPending) {
    add('warning',`${pixPending} Pix aguardando decisão`,'Marque cada solicitação como paga ou recusada.','pix');
  }
  if (numberFrom(record.withdrawals) > 0 && !financeData.finance_sangria_received) {
    add('warning','Sangria aguardando recebimento',`Confirme o recebimento de ${formatBRL(record.withdrawals)}.`,'sangria');
  }
  const required = requiredFinanceConfirmFields(record);
  const missingConfirmations = required.filter(key => !financeData[key]).length;
  if (missingConfirmations) {
    add('warning',`${missingConfirmations} confirmações pendentes`,'Confirme dinheiro, máquinas e saídas revisadas.','confirmations');
  }
  if (!nearZero(result.totalDifference)
    && (!String(financeData.finance_divergence_reason || '').trim() || !String(financeData.finance_notes || '').trim())) {
    add('error','Diferença sem parecer completo','Informe o motivo e registre o parecer financeiro.','opinion');
  }
  return items;
}

function focusReviewPending(target) {
  const selectors = {
    attachments:'.attachment-review-card',pix:'#financePixRequests',sangria:'#reviewSangriaAlert',
    confirmations:'.finance-confirm-section',opinion:'[name="finance_divergence_reason"]'
  };
  const element = $(selectors[target]);
  element?.scrollIntoView({behavior:'smooth',block:'center'});
  if (element?.matches('input,select,textarea,button')) setTimeout(() => element.focus(),350);
}

function renderFinancePendingPanel(record,financeData,result) {
  const items = buildFinancePendingItems(record,financeData,result);
  const errors = items.filter(item => item.severity === 'error').length;
  $('#reviewPendingPanel').classList.toggle('has-errors',errors > 0);
  $('#reviewPendingPanel').classList.toggle('is-ready',!items.length);
  $('#reviewPendingTitle').textContent = items.length
    ? 'Resolva somente o que exige atenção'
    : 'Fechamento pronto para aprovação';
  $('#reviewPendingCount').textContent = `${items.length} ${items.length === 1 ? 'pendência' : 'pendências'}`;
  $('#reviewPendingItems').innerHTML = items.length ? items.map(item =>
    `<button type="button" class="review-pending-item ${item.severity}" data-review-pending-target="${item.target}"><span>${item.severity === 'error' ? '!' : 'i'}</span><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.message)}</small></div><em>Revisar →</em></button>`
  ).join('') : '<div class="review-ready"><span>✓</span><div><b>Nenhuma pendência</b><small>Todos os controles obrigatórios foram concluídos.</small></div></div>';
}

$('#reviewPendingItems').addEventListener('click',event => {
  const item = event.target.closest('[data-review-pending-target]');
  if (item) focusReviewPending(item.dataset.reviewPendingTarget);
});

function updateFinanceCalculation() {
  if (!currentReviewRecord) return;
  const financeData = financeFormData();
  const result = calculateFinanceReview(currentReviewRecord,{
    ...financeData,cardFeeRates:effectiveFeeRates(currentReviewRecord)
  });
  $('#reviewAvailable').textContent = formatBRL(result.totalAvailable);
  $('#reviewOutflows').textContent = formatBRL(result.totalOutflows);
  $('#reviewDifference').textContent = formatBRL(result.totalDifference);
  $('#financeReviewDiff').textContent = formatBRL(result.totalDifference);
  const severity = differenceSeverity(result.totalDifference,divergenceTolerance);
  $('#financeReviewDiff').style.color = severity === 'balanced' ? 'var(--green)' : severity === 'warning' ? 'var(--orange)' : 'var(--red)';
  $('#financeReviewMessage').textContent = severity === 'balanced' ? 'Valores financeiros conciliados.'
    : severity === 'warning' ? `Pequena diferença dentro da tolerância de ${formatBRL(divergenceTolerance)}.`
    : result.totalDifference > 0 ? 'Foi encontrada sobra crítica na conferência.' : 'Foi encontrada falta crítica na conferência.';
  $('#financeDivergenceFields').classList.toggle('hidden',nearZero(result.totalDifference));
  $('#financePaidPix').textContent = formatBRL(result.paidPixRequests);
  $('#financeGrossCard').textContent = formatBRL(result.grossCard);
  $('#financeCardFees').textContent = `− ${formatBRL(result.cardFeeTotal)}`;
  $('#financeNetCard').textContent = formatBRL(result.netCard);
  $('#financeGrossPix').textContent = formatBRL(result.grossPix);
  $('#financePixFees').textContent = `− ${formatBRL(result.pixFeeTotal)}`;
  $('#financeNetPix').textContent = formatBRL(result.netPix);
  $('#financeNetAvailable').textContent = formatBRL(result.totalAvailable);
  Object.entries(result.machineSettlements).forEach(([machine,settlement]) => {
    const fee = $(`[data-finance-machine-fees="${machine}"]`);
    const net = $(`[data-finance-machine-net="${machine}"]`);
    const creditFee = $(`[data-machine-fee="${machine}-credit"]`);
    const debitFee = $(`[data-machine-fee="${machine}-debit"]`);
    const pixFee = $(`[data-machine-fee="${machine}-pix"]`);
    if (fee) fee.textContent = `− ${formatBRL(settlement.fees)}`;
    if (net) net.textContent = formatBRL(settlement.totalNet);
    if (creditFee) creditFee.textContent = `${settlement.creditRate.toFixed(2).replace('.',',')}% · − ${formatBRL(settlement.creditFee)}`;
    if (debitFee) debitFee.textContent = `${settlement.debitRate.toFixed(2).replace('.',',')}% · − ${formatBRL(settlement.debitFee)}`;
    if (pixFee) pixFee.textContent = `${settlement.pixRate.toFixed(2).replace('.',',')}% · − ${formatBRL(settlement.pixFee)}`;
  });
  const required = requiredFinanceConfirmFields(currentReviewRecord);
  const confirmed = required.filter(key => financeData[key]).length;
  $('#financeConfirmedCount').textContent = `${confirmed}/${required.length}`;
  renderFinancePendingPanel(currentReviewRecord,financeData,result);
}
$('#financeReviewForm').addEventListener('input',updateFinanceCalculation);

function requiredFinanceConfirmFields(record) {
  const machineConfirmations = activeMachineEntries(record).flatMap(([,fields]) =>
    fields.map(field => `finance_confirm_${field}`)
  );
  return ['finance_confirm_cash',...machineConfirmations,'finance_confirm_outflows'];
}

async function saveFinanceReview(decision) {
  if (!currentReviewRecord || !isFinance()) return;
  if (financeState(currentReviewRecord) === 'approved') {
    toast('Este fechamento está bloqueado. Somente o administrador pode reabri-lo.',true);
    return;
  }
  const data = financeFormData();
  data.cardFeeRates = effectiveFeeRates(currentReviewRecord);
  const calc = calculateFinanceReview(currentReviewRecord,data);
  const requiredConfirmations = requiredFinanceConfirmFields(currentReviewRecord);
  if (decision === 'approved' && missingMachineReport(currentReviewRecord)) {
    toast('Devolva para a loja anexar o relatório obrigatório das máquinas.',true);
    return;
  }
  if (decision === 'approved' && requiredConfirmations.some(key => !data[key])) {
    toast('Confirme o Dinheiro, as máquinas utilizadas e as saídas antes de aprovar.',true);
    return;
  }
  if (decision === 'approved' && data.pixPaymentStatuses.some(item => item.status === 'pending')) {
    toast('Confirme como Pago ou Recusado cada solicitação de Pix.',true);
    return;
  }
  if (decision === 'approved' && numberFrom(currentReviewRecord.withdrawals) > 0 && !data.finance_sangria_received) {
    toast('Confirme o recebimento da sangria/fechamento antes de aprovar.',true);
    return;
  }
  if ((decision === 'returned' || !nearZero(calc.totalDifference)) && (!String(data.finance_divergence_reason || '').trim() || !String(data.finance_notes || '').trim())) {
    toast('Selecione o motivo e registre o parecer para justificar a diferença ou devolução.',true);
    return;
  }
  const now = Date.now();
  const review = {
    ...data,...calc,decision,reviewedAt:now,
    reviewedBy:auth.currentUser.uid,reviewedByName:profile.name || auth.currentUser.email,
    sangriaReceivedAt:data.finance_sangria_received ? now : null,
    sangriaReceivedBy: data.finance_sangria_received ? auth.currentUser.uid : null,
    sangriaReceivedByName:data.finance_sangria_received ? (profile.name || auth.currentUser.email) : null
  };
  await update(ref(db,`closings/${currentReviewRecord.id}`),{
    financeReview:review,financeStatus:decision,status:decision,locked:decision === 'approved',reviewedAt:now,updatedAt:now
  });
  await appendAudit(currentReviewRecord.id,decision,
    decision === 'approved' ? `Conferência aprovada. Resultado: ${formatBRL(calc.totalDifference)}.`
      : `${data.finance_divergence_reason}: ${data.finance_notes}`).catch(()=>{});
  toast(decision === 'approved' ? 'Conferência aprovada e resultado registrado.' : 'Caixa devolvido para correção.');
  currentReviewRecord = null;
  await loadFinance();
  await loadDashboard();
}

$('#financeReviewForm').addEventListener('submit', async event => {
  event.preventDefault();
  try { await saveFinanceReview('approved'); } catch (error) { toast(error.message || 'Erro ao aprovar a conferência.',true); }
});
$('#returnClosing').onclick = async () => {
  try { await saveFinanceReview('returned'); } catch (error) { toast(error.message || 'Erro ao devolver o caixa.',true); }
};

$('#reopenClosing').onclick = () => {
  if (profile?.role !== 'admin' || !currentReviewRecord || financeState(currentReviewRecord) !== 'approved') return;
  $('#reopenPanel').classList.remove('hidden');
  $('#reopenReason').focus();
};
$('#cancelReopen').onclick = () => {
  $('#reopenReason').value = '';
  $('#reopenPanel').classList.add('hidden');
};
$('#confirmReopen').onclick = async () => {
  const reason = $('#reopenReason').value.trim();
  if (!reason) {
    toast('Informe o motivo da reabertura.',true);
    return;
  }
  if (profile?.role !== 'admin' || !currentReviewRecord || financeState(currentReviewRecord) !== 'approved') return;
  const id = currentReviewRecord.id;
  const now = Date.now();
  try {
    await update(ref(db,`closings/${id}`),{
      status:'reopened',financeStatus:'reopened',locked:false,reopenReason:reason,
      reopenedAt:now,reopenedBy:auth.currentUser.uid,reopenedByName:profile.name || auth.currentUser.email,updatedAt:now
    });
    await appendAudit(id,'reopened',reason).catch(()=>{});
    toast('Fechamento reaberto e encaminhado para nova conferência.');
    $('#financeStatus').value = 'reopened';
    currentReviewRecord = null;
    await loadFinance();
    await loadDashboard();
  } catch (error) {
    toast(error.message || 'Não foi possível reabrir o fechamento.',true);
  }
};

function canEditClosing(record) {
  return record.createdBy === auth.currentUser?.uid && ['draft','returned'].includes(financeState(record));
}

function openClosingForEdit(record) {
  if (!canEditClosing(record)) {
    toast('Somente o responsável pode editar rascunhos ou caixas devolvidos.',true);
    return;
  }
  resetClosing();
  const form = $('#closingForm');
  form.dataset.id = record.id;
  if (record.openingFloatSourceId) form.dataset.openingFloatSourceId = record.openingFloatSourceId;
  const responsibleField = form.elements.sangria_responsible;
  if (responsibleField && record.sangria_responsible
      && ![...responsibleField.options].some(option => option.value === record.sangria_responsible)) {
    responsibleField.add(new Option(record.sangria_responsible,record.sangria_responsible));
  }
  ['date','store','shift','operator','sangria_responsible','sangria_delivered_at','divergence_reason','notes']
    .forEach(key => { if (form.elements[key] && record[key] !== undefined) form.elements[key].value = record[key] ?? ''; });
  const selected = new Set(activeMachineEntries(record).map(([name]) => name));
  $$('.machine-select').forEach(input => {
    input.checked = selected.has(input.value);
  });
  renderSelectedMachineCards();
  OPERATION_FIELDS.forEach(key => {
    if (form.elements[key]) form.elements[key].value = numberFrom(record[key]);
  });
  $('.optional-receipts').open = ['system_ifood_online','system_ifood_voucher','system_term','system_club','system_accrual']
    .some(key => !nearZero(record[key]));
  $('#outflowRows').innerHTML = '';
  (record.outflows || []).forEach(addOutflowRow);
  $('#pixRequestRows').innerHTML = '';
  (record.pixRequests || []).forEach(item => addPixRequestRow(item,false));
  savedAttachments = Array.isArray(record.attachments) ? record.attachments : [];
  pendingAttachments = [];
  form.elements.sangria_delivered.checked = Boolean(record.sangria_delivered);
  $('#sangriaDetails').classList.toggle('hidden',!record.sangria_delivered);
  renderAttachmentList();
  $('#formStatus').textContent = record.status === 'returned' ? 'Devolvido para correção' : 'Rascunho recuperado';
  $('#formStatus').className = `badge ${record.status === 'returned' ? 'bad' : 'draft'}`;
  updateClosingCalculation();
  showView('closing');
  window.scrollTo({top:0,behavior:'smooth'});
}

async function loadHistory() {
  try {
    const from = $('#historyFrom').value || isoToday();
    const to = $('#historyTo').value || isoToday();
    const store = $('#historyStore').value || 'all';
    historyClosings = (await fetchClosings(from,to)).map(enrichedClosing)
      .filter(item => store === 'all' || item.store === store)
      .sort((a,b) => b.date.localeCompare(a.date));
    $('#historyRows').innerHTML = historyClosings.length ? historyClosings.map(item => {
      const action = canEditClosing(item)
        ? `<button class="table-action" data-edit-closing="${escapeHtml(item.id)}">${item.status === 'returned' ? 'Corrigir' : 'Continuar'}</button>`
        : '—';
      return `<tr><td>${formatDate(item.date)}</td><td>${escapeHtml(item.store)}</td><td>${escapeHtml(item.operator)}</td><td>${formatBRL(item.systemTotal)}</td><td>${formatBRL(item.totalOutflows)}</td><td>${formatBRL(item.financeCalc?.totalDifference ?? item.difference)}</td><td>${stateBadge(item)}</td><td>${action}</td></tr>`;
    }).join('') : '<tr><td colspan="8" class="empty">Nenhum fechamento no período.</td></tr>';
  } catch {
    toast('Erro ao buscar o histórico.',true);
  }
}
$('#loadHistory').onclick = loadHistory;
$('#historyRows').addEventListener('click',event => {
  const button = event.target.closest('[data-edit-closing]');
  if (!button) return;
  const record = historyClosings.find(item => item.id === button.dataset.editClosing);
  if (record) openClosingForEdit(record);
});

$('#userForm').addEventListener('submit', async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  let secondary;
  try {
    secondary = initializeApp(firebaseConfig,`create-${Date.now()}`);
    const credential = await createUserWithEmailAndPassword(getAuth(secondary),data.email,data.password);
    const allStores = ['admin','finance'].includes(data.role);
    await set(ref(db,`users/${credential.user.uid}`),{
      name:data.name,email:data.email.toLowerCase(),role:data.role,
      store:allStores ? null : data.store,stores:allStores ? STORES : [data.store],
      active:true,createdAt:Date.now(),createdBy:auth.currentUser.uid
    });
    event.target.reset();
    fillStores();
    toast('Usuário criado com sucesso.');
    loadUsers();
  } catch (error) {
    toast(error.code === 'auth/email-already-in-use' ? 'Este e-mail já está cadastrado.' : 'Não foi possível criar o usuário.',true);
  } finally {
    if (secondary) deleteApp(secondary);
  }
});

async function loadUsers() {
  const snap = await get(ref(db,'users'));
  const users = snap.exists() ? Object.entries(snap.val()) : [];
  $('#usersList').innerHTML = users.map(([,user]) => `<div class="user-row"><div><b>${escapeHtml(user.name)}</b><div class="muted">${escapeHtml(user.email)} · ${escapeHtml(user.role)} · ${escapeHtml((user.stores || [user.store]).filter(Boolean).join(', '))}</div></div><span class="badge ${user.active===false?'bad':'ok'}">${user.active===false?'Inativo':'Ativo'}</span></div>`).join('');
}

function buildFinanceCardFields(record = {}) {
  const machines = activeMachineEntries(record);
  const rates = effectiveFeeRates(record);
  $('#financeCardFields').innerHTML = machines.length ? machines.map(([machine,[credit,debit,pix]]) => {
    const financeCredit = `finance_${credit}`;
    const financeDebit = `finance_${debit}`;
    const financePix = `finance_${pix}`;
    const row = (label,field,financeField,rateType=null) => `<div class="finance-verify-row"><div class="verify-method"><span>${label}</span>${rateType ? `<small>${numberFrom(rates[machine][rateType]).toFixed(2).replace('.',',')}% configurado</small>` : '<small>Sem desconto</small>'}</div><div class="verify-value"><small>Loja</small><strong>${formatBRL(record[field])}</strong></div><label class="verify-input"><small>Financeiro</small><input name="${financeField}" inputmode="decimal" value="0" /></label><div class="verify-fee"><small>${rateType ? 'Taxa' : 'Líquido'}</small><strong ${rateType ? `data-machine-fee="${escapeHtml(machine)}-${rateType}"` : ''}>${rateType ? 'R$ 0,00' : formatBRL(record[field])}</strong></div><label class="verify-check" title="Confirmar ${label}"><input name="finance_confirm_${field}" type="checkbox" /><span>✓</span></label></div>`;
    return `<article class="machine-finance-card"><div class="machine-sheet-title"><span>Conferência financeira</span><h4>${escapeHtml(machine)}</h4></div><div class="machine-sheet-subtitle">LOJA × FINANCEIRO × LÍQUIDO</div><div class="machine-verify-head"><span>Forma</span><span>Informado</span><span>Encontrado</span><span>Desconto</span><span>OK</span></div><div class="machine-pair">${row('Crédito',credit,financeCredit,'credit')}${row('Débito',debit,financeDebit,'debit')}${row('Pix',pix,financePix,'pix')}</div><footer class="machine-settlement-footer"><span>Taxas <b data-finance-machine-fees="${escapeHtml(machine)}">R$ 0,00</b></span><span>Total líquido <strong data-finance-machine-net="${escapeHtml(machine)}">R$ 0,00</strong></span></footer></article>`;
  }).join('') : '<p class="empty-inline">A loja não selecionou nenhuma máquina.</p>';
}

$('#toggleRateSettings').onclick = () => {
  $('#rateSettingsCard').classList.toggle('hidden');
  $('#toggleRateSettings').textContent = $('#rateSettingsCard').classList.contains('hidden')
    ? 'Configurar taxas' : 'Fechar taxas';
};
$('#saveRateSettings').onclick = async () => {
  try { await saveCardFeeRates(); }
  catch (error) { toast(error.message || 'Não foi possível salvar as taxas.',true); }
};

buildMachineSelection();
updateClosingCalculation();
