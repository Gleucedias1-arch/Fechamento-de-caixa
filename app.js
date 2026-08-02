import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getDatabase, ref, get, set, push, update, query, orderByChild, startAt, endAt } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
import { firebaseConfig, ADMIN_EMAIL } from './firebase-config.js';
import {
  SYSTEM_FIELDS, COUNTED_FIELDS, EXPENSE_FIELDS, CARD_FIELDS, FINANCE_CARD_FIELDS, FINANCE_CONFIRM_FIELDS,
  numberFrom, calculateClosing, calculateFinanceReview, formatBRL
} from './calculations.js';

const STORES = ['House 190 Teixeira','House 190 Eunápolis','House Food Park Teixeira'];
const OPERATOR_GROUPS = {
  Stone: ['stone_credit','stone_debit'], Sipag: ['sipag_credit','sipag_debit'],
  Cielo: ['cielo_credit','cielo_debit'], Cappta: ['cappta_credit','cappta_debit'],
  Laranjinha: ['laranjinha_credit','laranjinha_debit'], Wise: ['wise_credit','wise_debit'],
};
const FINANCE_FIELDS = [
  'finance_cash','finance_pix',...FINANCE_CARD_FIELDS,'finance_adjustments'
];
const OPERATION_FIELDS = [
  ...SYSTEM_FIELDS,...COUNTED_FIELDS,...EXPENSE_FIELDS,'opening_float','withdrawals',
  'cash_in','closing_float','adjustments'
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
let profile = null;
let currentClosings = [];
let financeClosings = [];
let currentReviewRecord = null;

const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const isoToday = () => new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
const isFinance = () => ['admin','finance'].includes(profile?.role);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const formatDate = value => value?.includes('-') ? value.split('-').reverse().join('/') : '—';
const nearZero = value => Math.abs(numberFrom(value)) < 0.01;

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
  raw.sangria_delivered = $('[name="sangria_delivered"]').checked;
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
  FINANCE_FIELDS.forEach(key => raw[key] = numberFrom(raw[key]));
  raw.finance_sangria_received = $('[name="finance_sangria_received"]').checked;
  FINANCE_CONFIRM_FIELDS.forEach(key => raw[key] = Boolean($(`[name="${key}"]`)?.checked));
  raw.pixPaymentStatuses = $$('.pix-payment-status').map((select,index) => ({index,status:select.value}));
  return raw;
}

function entryRemoveButton() {
  return '<button class="entry-remove" type="button" aria-label="Remover item">×</button>';
}

function addOutflowRow(item={}) {
  const row = document.createElement('div');
  row.className = 'entry-row outflow-row';
  row.innerHTML = `<label>Tipo<select data-outflow-field="category"><option>Motoboy</option><option>Freelancer</option><option>Fornecedor</option><option>Compra</option><option>Outros</option></select></label><label class="entry-description">Descrição<input data-outflow-field="description" value="${escapeHtml(item.description || '')}" placeholder="Nome ou motivo da saída" /></label><label>Valor<input data-outflow-field="amount" inputmode="decimal" value="${numberFrom(item.amount)}" /></label>${entryRemoveButton()}`;
  $('[data-outflow-field="category"]',row).value = item.category || 'Outros';
  $('#outflowRows').append(row);
}

function addPixRequestRow(item={}) {
  const row = document.createElement('div');
  row.className = 'entry-row pix-request-row';
  row.innerHTML = `<label>Pagamento para<select data-pix-field="type"><option>Motoboy</option><option>Freelancer</option></select></label><label>Nome<input data-pix-field="name" value="${escapeHtml(item.name || '')}" placeholder="Nome do favorecido" /></label><label>Chave Pix<input data-pix-field="key" value="${escapeHtml(item.pixKey || '')}" placeholder="CPF, telefone, e-mail..." /></label><label>Valor<input data-pix-field="amount" inputmode="decimal" value="${numberFrom(item.amount)}" /></label><label class="entry-description">Observação<input data-pix-field="notes" value="${escapeHtml(item.notes || '')}" placeholder="Motivo ou turno" /></label>${entryRemoveButton()}`;
  $('[data-pix-field="type"]',row).value = item.type || 'Motoboy';
  $('#pixRequestRows').append(row);
}

$('#addOutflow').onclick = () => { addOutflowRow(); updateClosingCalculation(); };
$('#addPixRequest').onclick = () => { addPixRequestRow(); updateClosingCalculation(); };
['#outflowRows','#pixRequestRows'].forEach(selector => $(selector).addEventListener('click', event => {
  const button = event.target.closest('.entry-remove');
  if (button) { button.closest('.entry-row').remove(); updateClosingCalculation(); }
}));

function updateClosingCalculation() {
  const result = calculateClosing(closingFormData());
  $('#systemTotal').textContent = formatBRL(result.systemTotal);
  $('#countedTotal').textContent = formatBRL(result.countedReceipts);
  $('#cardConferenceTotal').textContent = formatBRL(result.countedByMethod.card);
  $('#outflowTotal').textContent = formatBRL(result.expenseTotal);
  $('#pixRequestTotal').textContent = formatBRL(closingFormData().pixRequests.reduce((sum,item) => sum + item.amount,0));
  $('#diffTotal').textContent = formatBRL(result.difference);
  const rec = $('.reconciliation');
  const icon = $('#diffBadge');
  rec.style.borderLeftColor = result.status === 'balanced' ? 'var(--green)' : result.status === 'surplus' ? 'var(--orange)' : 'var(--red)';
  icon.className = `result-icon ${result.status === 'balanced' ? 'ok' : 'bad'}`;
  icon.textContent = result.status === 'balanced' ? '✓' : '!';
  $('#diffExplanation').textContent = result.status === 'balanced' ? 'Os valores estão conciliados.' : result.status === 'surplus' ? 'Foi encontrada sobra no fechamento.' : 'Foi encontrada falta no fechamento.';
}
$('#closingForm').addEventListener('input', updateClosingCalculation);

async function persistClosing(finalStatus) {
  const data = closingFormData();
  const calc = calculateClosing(data);
  const user = auth.currentUser;
  if (!allowedStores().includes(data.store)) throw new Error('Loja não autorizada.');
  const id = $('#closingForm').dataset.id || push(ref(db,'closings')).key;
  const now = Date.now();
  const record = {
    ...data,...calc,id,status:finalStatus,
    financeStatus: finalStatus === 'submitted' ? 'pending' : 'not_submitted',
    createdBy:user.uid,createdByName:profile.name,updatedAt:now,
    submittedAt:finalStatus === 'submitted' ? now : null,
    searchDateStore:`${data.date}_${data.store}`
  };
  await set(ref(db,`closings/${id}`),record);
  $('#closingForm').dataset.id = id;
  $('#formStatus').textContent = finalStatus === 'submitted' ? 'Aguardando financeiro' : 'Rascunho';
  $('#formStatus').className = `badge ${finalStatus === 'submitted' ? 'warn' : 'draft'}`;
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
  const invalidOutflow = formData.outflows.some(item => !item.description || item.amount <= 0);
  const invalidPix = formData.pixRequests.some(item => !item.name || !item.pixKey || item.amount <= 0);
  if (invalidOutflow) {
    toast('Preencha a descrição e um valor maior que zero em todas as saídas.',true);
    return;
  }
  if (invalidPix) {
    toast('Preencha nome, chave Pix e valor em todas as solicitações.',true);
    return;
  }
  const result = calculateClosing(formData);
  if (!nearZero(result.difference) && !$('[name="notes"]').value.trim()) {
    toast('Descreva a divergência nas observações antes de enviar.',true);
    return;
  }
  try { await persistClosing('submitted'); } catch (error) { toast(error.message,true); }
});

function resetClosing() {
  const form = $('#closingForm');
  form.reset();
  delete form.dataset.id;
  initDates();
  $$('input[inputmode="decimal"]',form).forEach(input => input.value='0');
  $('#outflowRows').innerHTML = '';
  $('#pixRequestRows').innerHTML = '';
  addOutflowRow();
  $('#formStatus').textContent='Rascunho';
  $('#formStatus').className='badge draft';
  updateClosingCalculation();
}

async function fetchClosings(from, to) {
  const snap = await get(query(ref(db,'closings'),orderByChild('date'),startAt(from),endAt(to)));
  return snap.exists() ? Object.values(snap.val()).filter(item => allowedStores().includes(item.store)) : [];
}

function enrichedClosing(record) {
  const calc = calculateClosing(record);
  const finance = record.financeReview ? calculateFinanceReview(record, record.financeReview) : null;
  return {...record,...calc,financeCalc:finance};
}

function financeState(record) {
  if (record.financeStatus === 'approved' || record.status === 'approved') return 'approved';
  if (record.financeStatus === 'returned' || record.status === 'returned') return 'returned';
  if (record.status === 'draft') return 'draft';
  return 'pending';
}

function stateBadge(record) {
  const state = financeState(record);
  const map = {
    approved:['ok','Conferido'], returned:['bad','Devolvido'], draft:['draft','Rascunho'], pending:['warn','Aguardando financeiro']
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
    const available = rows.reduce((sum,item) => sum + numberFrom(item.financeCalc?.totalAvailable ?? item.totalAvailable),0);
    const diff = rows.reduce((sum,item) => sum + numberFrom(item.financeCalc?.totalDifference ?? item.difference),0);
    const reviewed = rows.filter(item => financeState(item) === 'approved').length;
    const pending = rows.filter(item => financeState(item) === 'pending').length;
    $('#kpiEntries').textContent = formatBRL(entries);
    $('#kpiOutflows').textContent = formatBRL(outflows);
    $('#kpiAvailable').textContent = formatBRL(available);
    $('#kpiDiff').textContent = formatBRL(diff);
    $('#kpiDiff').style.color = nearZero(diff) ? 'var(--green)' : diff > 0 ? 'var(--orange)' : 'var(--red)';
    $('#kpiDiffText').textContent = nearZero(diff) ? 'Sem divergência' : diff > 0 ? 'Sobra acumulada' : 'Falta acumulada';
    $('#kpiReviewed').textContent = reviewed;
    $('#kpiPending').textContent = pending;
    renderStoreStatus(rows);
    renderChannels(rows);
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

function renderDivergences(rows) {
  const divergent = rows.filter(item => {
    const source = item.financeCalc?.differences || item.differences;
    return Object.values(source || {}).some(value => !nearZero(value));
  }).sort((a,b) => Math.abs(numberFrom(b.financeCalc?.totalDifference ?? b.difference)) - Math.abs(numberFrom(a.financeCalc?.totalDifference ?? a.difference)));
  $('#divergenceRows').innerHTML = divergent.length ? divergent.map(item => {
    const diff = item.financeCalc?.differences || item.differences || {};
    const total = item.financeCalc?.totalDifference ?? item.difference;
    return `<tr><td>${escapeHtml(item.store)}</td><td>${escapeHtml(item.operator)}</td><td>${formatBRL(diff.cash)}</td><td>${formatBRL(diff.card)}</td><td>${formatBRL(diff.pix)}</td><td class="${nearZero(total)?'positive':numberFrom(total)>0?'warning-text':'negative'}">${formatBRL(total)}</td><td>${stateBadge(item)}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">Nenhuma divergência encontrada.</td></tr>';
}
$('#refreshDash').onclick = loadDashboard;
$('#dashDate').onchange = loadDashboard;
$('#dashStore').onchange = loadDashboard;

async function loadFinance() {
  if (!isFinance()) return;
  try {
    const date = $('#financeDate').value || isoToday();
    financeClosings = (await fetchClosings(date,date)).map(enrichedClosing);
    const store = $('#financeStore').value || 'all';
    const status = $('#financeStatus').value || 'pending';
    const scoped = financeClosings.filter(item => store === 'all' || item.store === store);
    const rows = scoped.filter(item => status === 'all' || financeState(item) === status);
    $('#financePending').textContent = scoped.filter(item => financeState(item) === 'pending').length;
    $('#financeApproved').textContent = scoped.filter(item => financeState(item) === 'approved').length;
    $('#financePixPending').textContent = scoped.reduce((sum,item) => {
      const statuses = item.financeReview?.pixPaymentStatuses || [];
      return sum + (item.pixRequests || []).filter((request,index) => (statuses[index]?.status || request.status || 'pending') === 'pending').length;
    },0);
    $('#financeDivergent').textContent = scoped.filter(item => !nearZero(item.financeCalc?.totalDifference ?? item.difference)).length;
    const totalDiff = scoped.reduce((sum,item) => sum + numberFrom(item.financeCalc?.totalDifference ?? item.difference),0);
    $('#financeTotalDiff').textContent = formatBRL(totalDiff);
    $('#financeTotalDiff').style.color = nearZero(totalDiff) ? 'var(--green)' : totalDiff > 0 ? 'var(--orange)' : 'var(--red)';
    $('#financeRows').innerHTML = rows.length ? rows.sort((a,b) => numberFrom(b.submittedAt) - numberFrom(a.submittedAt)).map(item => `<tr><td>${formatDate(item.date)}</td><td>${escapeHtml(item.store)}</td><td>${escapeHtml(item.operator)}</td><td>${formatBRL(item.systemTotal)}</td><td>${formatBRL(item.totalOutflows)}</td><td>${formatBRL(item.difference)}</td><td>${stateBadge(item)}</td><td><button class="table-action" data-review-id="${escapeHtml(item.id)}">Conferir</button></td></tr>`).join('') : '<tr><td colspan="8" class="empty">Nenhum fechamento neste filtro.</td></tr>';
    $('#financeReviewPanel').classList.add('hidden');
    $('#financeQueueCard').classList.remove('hidden');
  } catch {
    toast('Não foi possível carregar a fila financeira.',true);
  }
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
    return `<tr><td>${labels[key]}</td><td>${formatBRL(expected)}</td><td>${formatBRL(informed)}</td><td class="${nearZero(diff)?'positive':numberFrom(diff)>0?'warning-text':'negative'}">${formatBRL(diff)}</td></tr>`;
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

function renderCardMachines(record) {
  return Object.entries(OPERATOR_GROUPS).map(([machine,[credit,debit]]) => `<div class="machine-summary"><b>${escapeHtml(machine)}</b><span>Crédito <strong>${formatBRL(record[credit])}</strong></span><span>Débito <strong>${formatBRL(record[debit])}</strong></span><em>Total ${formatBRL(numberFrom(record[credit])+numberFrom(record[debit]))}</em></div>`).join('');
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

function openFinanceReview(id) {
  currentReviewRecord = financeClosings.find(item => item.id === id);
  if (!currentReviewRecord) return;
  $('#financeQueueCard').classList.add('hidden');
  $('#financeReviewPanel').classList.remove('hidden');
  $('#reviewRecordTitle').textContent = `${currentReviewRecord.store} · ${formatDate(currentReviewRecord.date)}`;
  $('#reviewRecordMeta').textContent = `${currentReviewRecord.shift || 'Turno não informado'} · Operador: ${currentReviewRecord.operator || '—'}`;
  $('#reviewStatus').outerHTML = `<span id="reviewStatus" class="badge ${financeState(currentReviewRecord)==='approved'?'ok':financeState(currentReviewRecord)==='returned'?'bad':'warn'}">${financeState(currentReviewRecord)==='approved'?'Conferido':financeState(currentReviewRecord)==='returned'?'Devolvido':'Aguardando financeiro'}</span>`;
  $('#reviewEntries').textContent = formatBRL(currentReviewRecord.systemTotal);
  $('#reviewOutflows').textContent = formatBRL(currentReviewRecord.totalOutflows);
  $('#reviewMethodRows').innerHTML = methodRows(currentReviewRecord);
  $('#reviewSystemValues').innerHTML = renderSystemValues(currentReviewRecord);
  $('#reviewCardMachines').innerHTML = renderCardMachines(currentReviewRecord);
  $('#reviewExpenses').innerHTML = renderOutflows(currentReviewRecord) + metric('Sangrias',currentReviewRecord.withdrawals);
  $('#reviewControls').innerHTML = metric('Saldo inicial',currentReviewRecord.opening_float)
    + metric('Troco final',currentReviewRecord.closing_float)
    + metric('Sangria entregue',currentReviewRecord.sangria_delivered ? 'Sim' : 'Não',false)
    + metric('Divergência operacional',currentReviewRecord.difference);
  $('#reviewNotes').textContent = currentReviewRecord.notes || 'Nenhuma observação informada.';
  const form = $('#financeReviewForm');
  form.reset();
  $$('input[inputmode="decimal"]',form).forEach(input => input.value='0');
  const existing = currentReviewRecord.financeReview || {};
  const defaults = {finance_cash:currentReviewRecord.counted_cash,finance_pix:currentReviewRecord.counted_pix};
  CARD_FIELDS.forEach(key => defaults[`finance_${key}`] = currentReviewRecord[key]);
  FINANCE_FIELDS.forEach(key => {
    if (!form.elements[key]) return;
    form.elements[key].value = existing[key] !== undefined ? existing[key] : numberFrom(defaults[key]);
  });
  FINANCE_CONFIRM_FIELDS.forEach(key => { if (form.elements[key]) form.elements[key].checked = Boolean(existing[key]); });
  form.elements.finance_notes.value = existing.finance_notes || '';
  form.elements.finance_sangria_received.checked = Boolean(existing.finance_sangria_received);
  $('#financePixRequests').innerHTML = renderFinancePixRequests(currentReviewRecord,existing);
  updateFinanceCalculation();
  window.scrollTo({top:0,behavior:'smooth'});
}

$('#closeReview').onclick = () => {
  currentReviewRecord = null;
  $('#financeReviewPanel').classList.add('hidden');
  $('#financeQueueCard').classList.remove('hidden');
};

function updateFinanceCalculation() {
  if (!currentReviewRecord) return;
  const result = calculateFinanceReview(currentReviewRecord, financeFormData());
  $('#reviewAvailable').textContent = formatBRL(result.totalAvailable);
  $('#reviewOutflows').textContent = formatBRL(result.totalOutflows);
  $('#reviewDifference').textContent = formatBRL(result.totalDifference);
  $('#financeReviewDiff').textContent = formatBRL(result.totalDifference);
  $('#financeReviewDiff').style.color = nearZero(result.totalDifference) ? 'var(--green)' : result.totalDifference > 0 ? 'var(--orange)' : 'var(--red)';
  $('#financeReviewMessage').textContent = nearZero(result.totalDifference) ? 'Valores financeiros conciliados.' : result.totalDifference > 0 ? 'Foi encontrada sobra na conferência.' : 'Foi encontrada falta na conferência.';
  $('#financePaidPix').textContent = formatBRL(result.paidPixRequests);
  const confirmed = FINANCE_CONFIRM_FIELDS.filter(key => financeFormData()[key]).length;
  $('#financeConfirmedCount').textContent = `${confirmed}/${FINANCE_CONFIRM_FIELDS.length}`;
}
$('#financeReviewForm').addEventListener('input',updateFinanceCalculation);

async function saveFinanceReview(decision) {
  if (!currentReviewRecord || !isFinance()) return;
  const data = financeFormData();
  const calc = calculateFinanceReview(currentReviewRecord,data);
  if (decision === 'approved' && FINANCE_CONFIRM_FIELDS.some(key => !data[key])) {
    toast('Confirme todos os campos de Dinheiro, Cartão, Pix e saídas antes de aprovar.',true);
    return;
  }
  if (decision === 'approved' && data.pixPaymentStatuses.some(item => item.status === 'pending')) {
    toast('Confirme como Pago ou Recusado cada solicitação de Pix.',true);
    return;
  }
  if (decision === 'approved' && !data.finance_sangria_received) {
    toast('Confirme o recebimento da sangria/fechamento antes de aprovar.',true);
    return;
  }
  if ((decision === 'returned' || !nearZero(calc.totalDifference)) && !String(data.finance_notes || '').trim()) {
    toast('Registre o parecer do financeiro para justificar a diferença ou devolução.',true);
    return;
  }
  const now = Date.now();
  const review = {
    ...data,...calc,decision,reviewedAt:now,
    reviewedBy:auth.currentUser.uid,reviewedByName:profile.name || auth.currentUser.email
  };
  await update(ref(db,`closings/${currentReviewRecord.id}`),{
    financeReview:review,financeStatus:decision,status:decision,reviewedAt:now,updatedAt:now
  });
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

async function loadHistory() {
  try {
    const from = $('#historyFrom').value || isoToday();
    const to = $('#historyTo').value || isoToday();
    const store = $('#historyStore').value || 'all';
    const rows = (await fetchClosings(from,to)).map(enrichedClosing).filter(item => store === 'all' || item.store === store).sort((a,b) => b.date.localeCompare(a.date));
    $('#historyRows').innerHTML = rows.length ? rows.map(item => `<tr><td>${formatDate(item.date)}</td><td>${escapeHtml(item.store)}</td><td>${escapeHtml(item.operator)}</td><td>${formatBRL(item.systemTotal)}</td><td>${formatBRL(item.totalOutflows)}</td><td>${formatBRL(item.financeCalc?.totalDifference ?? item.difference)}</td><td>${stateBadge(item)}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">Nenhum fechamento no período.</td></tr>';
  } catch {
    toast('Erro ao buscar o histórico.',true);
  }
}
$('#loadHistory').onclick = loadHistory;

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

function buildFinanceCardFields() {
  $('#financeCardFields').innerHTML = Object.entries(OPERATOR_GROUPS).map(([machine,[credit,debit]]) => {
    const financeCredit = `finance_${credit}`;
    const financeDebit = `finance_${debit}`;
    return `<div class="machine-finance-card"><h4>${escapeHtml(machine)}</h4><div class="machine-pair"><div class="confirm-field"><label>Crédito<input name="${financeCredit}" inputmode="decimal" value="0" /></label><label class="confirm-check"><input name="finance_confirm_${credit}" type="checkbox" /> Confirmado</label></div><div class="confirm-field"><label>Débito<input name="${financeDebit}" inputmode="decimal" value="0" /></label><label class="confirm-check"><input name="finance_confirm_${debit}" type="checkbox" /> Confirmado</label></div></div></div>`;
  }).join('');
}

buildFinanceCardFields();
addOutflowRow();
updateClosingCalculation();
