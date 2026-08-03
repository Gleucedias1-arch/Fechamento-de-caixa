import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getDatabase, ref, get } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

const db = getDatabase(initializeApp(firebaseConfig));
const $ = selector => document.querySelector(selector);
const formatBRL = value => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value) || 0);
const isoToday = () => new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
const nearZero = value => Math.abs(Number(value) || 0) < .01;
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
let snapshot = null;

function scopedData(source, store) {
  if (store === 'all') return source;
  const selectedStore = (source.stores || []).find(item => item.name === store);
  return {
    ...source,
    kpis:selectedStore?.kpis || {entries:0,outflows:0,available:0,sangria:0,difference:0,reviewed:0,pending:0,sangriaCount:0},
    stores:selectedStore ? [selectedStore] : [],channels:selectedStore?.channels || [],
    divergences:(source.divergences || []).filter(item => item.store === store),
    filteredNotice:true
  };
}

function statusBadge(status) {
  const map = {approved:['ok','Conferido'],waiting:['warn','Aguardando'],returned:['bad','Devolvido'],divergent:['bad','Divergência'],pending:['draft','Pendente']};
  const item = map[status] || map.pending;
  return `<span class="badge ${item[0]}">${item[1]}</span>`;
}

function render(source) {
  const store = $('#dashboardStore').value || 'all';
  const data = scopedData(source,store);
  const kpis = data.kpis || {};
  ['Entries','Outflows','Available','Sangria','Difference'].forEach(key => {
    $(`#public${key}`).textContent = formatBRL(kpis[key.toLowerCase()]);
  });
  $('#publicReviewed').textContent = kpis.reviewed || 0;
  $('#publicPending').textContent = kpis.pending || 0;
  $('#publicSangriaText').textContent = kpis.sangriaCount
    ? `${kpis.sangriaCount} ${kpis.sangriaCount === 1 ? 'caixa aguardando recebimento' : 'caixas aguardando recebimento'}`
    : 'Nenhuma sangria disponível';
  $('#publicSangriaCard').classList.toggle('active',Number(kpis.sangria) > 0);
  $('#publicDifference').className = nearZero(kpis.difference) ? 'positive' : Number(kpis.difference) > 0 ? 'warning' : 'negative';
  $('#publicDifferenceText').textContent = nearZero(kpis.difference) ? 'Sem divergência' : Number(kpis.difference) > 0 ? 'Sobra acumulada' : 'Falta acumulada';

  $('#publicStores').innerHTML = (data.stores || []).map(item => `<div class="store-row"><div><b>${escapeHtml(item.name)}</b><small>${item.closingCount ? `${item.approved} conferido(s) · ${item.pending} aguardando` : 'Nenhum fechamento'}</small></div><strong>${item.closingCount ? formatBRL(item.difference) : '—'}</strong>${statusBadge(item.status)}</div>`).join('') || '<p class="empty">Nenhum fechamento para esta loja.</p>';
  const max = Math.max(...(data.channels || []).map(item => Number(item.value) || 0),1);
  $('#publicChannels').innerHTML = (data.channels || []).map(item => `<div><div class="bar-head"><span>${escapeHtml(item.label)}</span><b>${formatBRL(item.value)}</b></div><div class="bar-track"><div class="bar-fill" style="width:${(Number(item.value) || 0)/max*100}%"></div></div></div>`).join('');
  $('#publicDivergences').innerHTML = (data.divergences || []).length ? data.divergences.map(item => `<div class="divergence-row"><div><b>${escapeHtml(item.store)}</b><small>Dinheiro ${formatBRL(item.cash)} · Cartão ${formatBRL(item.card)} · Pix ${formatBRL(item.pix)}</small></div><strong class="${item.severity === 'balanced' ? 'positive' : item.total > 0 ? 'warning' : 'negative'}">${formatBRL(item.total)}</strong>${statusBadge(item.severity === 'balanced' ? 'approved' : 'divergent')}</div>`).join('') : '<p class="empty">Nenhuma divergência encontrada.</p>';
  $('#dashboardContent').classList.remove('hidden');
}

async function loadDashboard() {
  const date = $('#dashboardDate').value || isoToday();
  $('#statusMessage').className = 'status-card loading';
  $('#statusMessage').textContent = 'Atualizando o dashboard...';
  $('#dashboardContent').classList.add('hidden');
  try {
    const result = await get(ref(db,`publicDashboards/${date}`));
    if (!result.exists()) {
      snapshot = null;
      $('#statusMessage').className = 'status-card';
      $('#statusMessage').textContent = 'Ainda não há um resumo publicado para esta data.';
      $('#updatedLabel').textContent = 'Selecione outra data ou tente novamente em instantes.';
      return;
    }
    snapshot = result.val();
    const stores = snapshot.stores || [];
    const currentStore = $('#dashboardStore').value || 'all';
    $('#dashboardStore').innerHTML = '<option value="all">Todas as lojas</option>' + stores.map(item => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join('');
    $('#dashboardStore').value = stores.some(item => item.name === currentStore) ? currentStore : 'all';
    $('#updatedLabel').textContent = `Atualizado em ${new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(snapshot.updatedAt))}`;
    $('#statusMessage').className = 'status-card hidden';
    render(snapshot);
  } catch {
    snapshot = null;
    $('#statusMessage').className = 'status-card error';
    $('#statusMessage').textContent = 'Não foi possível carregar o Dashboard agora. Tente novamente.';
    $('#updatedLabel').textContent = 'Conexão indisponível.';
  }
}

$('#dashboardDate').value = isoToday();
$('#dashboardDate').addEventListener('change',loadDashboard);
$('#dashboardStore').addEventListener('change',() => snapshot && render(snapshot));
$('#refreshDashboard').addEventListener('click',loadDashboard);
loadDashboard();
