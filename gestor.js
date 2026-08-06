import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

const $ = sel => document.querySelector(sel);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const token = new URLSearchParams(location.search).get('t');
let mirror = null;
let scopeKey = 'all';

function setState(msg) {
  const el = $('#gState');
  if (msg) { el.textContent = msg; el.classList.remove('hidden'); $('#gPanel').classList.add('hidden'); }
  else { el.classList.add('hidden'); $('#gPanel').classList.remove('hidden'); }
}

function formatUpdated(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return 'Atualizado às ' + d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
}
function formatDateBR(iso) {
  if (!iso) return '—';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function buildTabs() {
  const names = mirror.storeNames || [];
  const tabs = [['all','Todas as lojas'], ...names.map((name,index) => [`s${index}`, name])];
  $('#gTabs').innerHTML = tabs.map(([key,label]) =>
    `<button class="gestor-tab ${key===scopeKey?'active':''}" data-scope="${key}" data-testid="gestor-tab-${key}">${label}</button>`).join('');
  $('#gTabs').querySelectorAll('.gestor-tab').forEach(btn => {
    btn.addEventListener('click', () => { scopeKey = btn.dataset.scope; buildTabs(); renderScope(); });
  });
}

function renderScope() {
  const scope = (mirror.stores || {})[scopeKey];
  if (!scope) { return; }
  const k = scope.kpis || {};
  $('#gEntries').textContent = k.entries ?? 'R$ 0,00';
  $('#gOutflows').textContent = k.outflows ?? 'R$ 0,00';
  $('#gAvailable').textContent = k.available ?? 'R$ 0,00';
  $('#gSangria').textContent = k.sangria ?? 'R$ 0,00';
  $('#gSangriaText').textContent = k.sangriaText ?? '';
  $('#gSangriaCard').classList.toggle('sangria-active', !!k.sangriaActive);
  $('#gDiff').textContent = k.diff ?? 'Sem divergência';
  $('#gDiff').style.color = k.diffColor || 'var(--green)';
  $('#gDiffText').textContent = k.diffText ?? '';
  $('#gReviewed').textContent = k.reviewed ?? 0;
  $('#gPending').textContent = k.pending ?? 0;
  $('#gStoreStatus').innerHTML = scope.storeStatusHTML || '';
  $('#gChannels').innerHTML = scope.channelsHTML || '';
  const o = scope.overview || {};
  $('#gOverviewGross').textContent = o.gross ?? 'R$ 0,00';
  $('#gOverviewCash').textContent = o.cash ?? 'R$ 0,00';
  $('#gOverviewFees').textContent = o.fees ?? '− R$ 0,00';
  $('#gOverviewCommitments').textContent = o.commitments ?? '− R$ 0,00';
  $('#gOverviewAvailable').textContent = o.available ?? 'R$ 0,00';
  $('#gOverviewAvailable').className = o.availableNeg ? 'negative' : '';
  $('#gOverviewStatus').textContent = o.statusText ?? 'Aguardando dados';
  $('#gOverviewStatus').className = o.statusClass || 'badge draft';
  $('#gDivergenceRows').innerHTML = scope.divergenceRowsHTML || '<tr><td colspan="7" class="empty">Nenhuma divergência encontrada.</td></tr>';
}

function subscribe() {
  onValue(ref(db, `publicDashboard/${token}`), snap => {
    if (!snap.exists()) { setState('Painel ainda não publicado. Peça para o financeiro/admin abrir o sistema uma vez.'); return; }
    mirror = snap.val();
    $('#gDate').textContent = 'Hoje · ' + formatDateBR(mirror.date);
    $('#gUpdated').textContent = formatUpdated(mirror.updatedAt);
    if (!mirror.stores || !mirror.stores[scopeKey]) scopeKey = 'all';
    buildTabs();
    renderScope();
    setState(null);
  }, () => {
    setState('Não foi possível carregar o painel. Verifique o link.');
  });
}

if (!token) {
  setState('Link inválido: código de acesso ausente.');
} else {
  setState('Conectando…');
  onAuthStateChanged(auth, user => { if (user) subscribe(); });
  signInAnonymously(auth).catch(() => setState('Não foi possível conectar. Tente novamente mais tarde.'));
}
