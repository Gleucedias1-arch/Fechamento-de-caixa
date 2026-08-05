import { getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getDatabase, ref, get, set, push, query, orderByChild, limitToLast, equalTo } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';

const app = getApps().length ? getApp() : null;
const auth = getAuth(app);
const db = getDatabase(app);
const STORES = ['House 190 Teixeira','House 190 Eunápolis','House Food Park Teixeira'];
const CHANNELS = ['iFood','Stone','Sipag','Cielo','Cappta','Laranjinha','Wise','Outra máquina'];
let currentProfile = null;

const money = value => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
const number = value => Number(String(value ?? 0).replace(',','.')) || 0;
const dateBR = value => value ? value.split('-').reverse().join('/') : '—';
const dateTimeBR = value => {
  const timestamp = Number(value);
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(timestamp));
};
const authorLabel = item => {
  const name = String(item?.createdByName || '').trim();
  const when = dateTimeBR(item?.createdAt);
  if (!name && when === '—') return '';
  if (!name) return `Lançado em ${when}`;
  if (when === '—') return `Lançado por ${name}`;
  return `Lançado por ${name} · ${when}`;
};
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const today = () => new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
const canAudit = () => ['admin','finance','operator','manager'].includes(currentProfile?.role);
const canBackup = () => currentProfile?.role === 'admin';

function notify(message,error=false) {
  const toast=document.querySelector('#toast');
  if (!toast) return;
  toast.textContent=message;
  toast.className=`toast show${error?' error-toast':''}`;
  clearTimeout(notify.timer);
  notify.timer=setTimeout(()=>toast.className='toast',3400);
}

function modernizeBrand() {
  const logo = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 30 32 12l22 18v24H39V38H25v16H10Z"/><path class="logo-cut" d="M27 25h10v8H27z"/></svg><span class="logo-number">190</span>`;
  document.querySelectorAll('.brand-mark').forEach(mark=>{
    mark.innerHTML=logo;
    mark.setAttribute('aria-label','House 190');
    mark.classList.add('modern-house-mark');
  });
}

function injectStyles() {
  const style=document.createElement('style');
  style.textContent=`
  .modern-house-mark{position:relative!important;background:linear-gradient(145deg,#f6cd48,#dba913)!important;color:#142f43!important;overflow:hidden;box-shadow:0 10px 24px #0b223522!important;letter-spacing:0!important}
  .modern-house-mark svg{width:62%;height:62%;fill:#142f43}.modern-house-mark .logo-cut{fill:#f3c43b}.modern-house-mark .logo-number{position:absolute;right:5px;bottom:4px;padding:1px 4px;border-radius:5px;background:#142f43;color:#fff;font-size:9px!important;font-weight:900;line-height:1.25}
  .modern-house-mark.small .logo-number{right:2px;bottom:2px;font-size:6px!important}
  .audit-view{display:none;padding:28px;max-width:1450px;margin:auto}.audit-view.active-view{display:block}
  .audit-hero{display:flex;justify-content:space-between;align-items:center;gap:18px;margin-bottom:18px;padding:20px;border-radius:16px;background:linear-gradient(135deg,#17384f,#285f80);color:#fff}
  .audit-hero-body{display:flex;align-items:center;gap:14px;min-width:0;flex:1}
  .audit-hero-icon{display:inline-flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:14px;background:#ffffff1f;font-size:26px;line-height:1;flex-shrink:0}
  .audit-title-icon{margin-right:6px;font-size:1.05em;line-height:1}
  .audit-hero-badge{padding:7px 11px;border-radius:999px;background:#ffffff18;font-size:10px;font-weight:800;white-space:nowrap;letter-spacing:.04em}
  .audit-hero h3{margin:0;font-size:19px;text-align:left;line-height:1.2}
  .audit-hero p{margin:5px 0 0;color:#dbe9f1;font-size:11px;text-align:left;line-height:1.4}
  .audit-layout{display:grid;grid-template-columns:minmax(330px,.72fr) minmax(0,1.28fr);gap:16px}.audit-form{display:grid;gap:13px}.audit-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}.audit-form-grid .wide{grid-column:1/-1}
  .audit-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.audit-metric{padding:14px;border:1px solid var(--line);border-radius:11px;background:#f8fafb}.audit-metric span,.audit-metric small{display:block;color:var(--muted);font-size:9px}.audit-metric strong{display:block;margin:5px 0;font-size:18px}.audit-metric.positive strong{color:var(--green)}.audit-metric.negative strong{color:var(--red)}
  .audit-list{display:grid;gap:10px}.audit-record{display:grid;grid-template-columns:1.1fr .8fr .8fr .8fr;gap:12px;align-items:center;padding:13px;border:1px solid var(--line);border-radius:11px;background:#fff;position:relative;padding-bottom:24px}.audit-record b,.audit-record span,.audit-record small{display:block}.audit-record span,.audit-record small{margin-top:3px;color:var(--muted);font-size:9px}.audit-record .difference{font-size:14px;font-weight:900}.difference.ok{color:var(--green)}.difference.bad{color:var(--red)}
  .audit-record .audit-author{position:absolute;left:13px;right:13px;bottom:6px;margin:0;padding-top:6px;border-top:1px dashed #e7ecf1;color:#7a8592;font-size:9px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;display:flex;align-items:center;gap:6px}
  .audit-record .audit-author::before{content:"👤";font-size:11px}
  .backup-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.backup-card{padding:20px;border:1px solid var(--line);border-radius:14px;background:#fff}.backup-card h4{margin:0}.backup-card p{min-height:44px;color:var(--muted);font-size:10px;line-height:1.55}.backup-status{margin-top:15px;padding:12px;border-radius:10px;background:var(--blue-soft);color:var(--blue);font-size:10px;font-weight:800}
  @media(max-width:1200px){.audit-view{padding:22px}.audit-layout{grid-template-columns:minmax(300px,.8fr) minmax(0,1.2fr)}}
  @media(max-width:960px){.audit-layout{grid-template-columns:1fr;gap:14px}.backup-grid{grid-template-columns:1fr}.audit-record{grid-template-columns:1fr 1fr}}
  @media(max-width:640px){.audit-view{padding:14px}.audit-form-grid,.audit-summary,.audit-record{grid-template-columns:1fr}.audit-hero{flex-direction:column;align-items:stretch;gap:12px;padding:16px}.audit-hero-body{align-items:flex-start}.audit-hero-icon{width:44px;height:44px;font-size:22px;border-radius:12px}.audit-hero h3{font-size:17px}.audit-hero p{font-size:11px}.audit-hero-badge{align-self:flex-start;font-size:9px;padding:5px 9px}.audit-record{padding-bottom:28px}}

  /* Daily audit summary card injected into the closing view */
  .daily-audit-card{margin:0 0 16px;padding:16px 18px;border-radius:16px;border:1px solid var(--line);background:linear-gradient(135deg,#fff,#f4f7fa);display:grid;gap:12px}
  .daily-audit-card .daily-audit-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .daily-audit-card h4{margin:0;font-size:14px;letter-spacing:.02em}
  .daily-audit-card small.daily-audit-meta{color:var(--muted);font-size:10px}
  .daily-audit-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .daily-audit-item{border:1px solid var(--line);border-radius:12px;padding:12px;background:#fff;display:grid;gap:6px;position:relative}
  .daily-audit-item .daily-audit-title{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-weight:800}
  .daily-audit-item .daily-audit-title .icon{font-size:16px;line-height:1}
  .daily-audit-item .daily-audit-value{font-size:16px;font-weight:800}
  .daily-audit-item .daily-audit-author{font-size:10px;color:#6c7683;font-weight:600;display:flex;align-items:center;gap:6px}
  .daily-audit-item .daily-audit-author::before{content:"👤";font-size:11px}
  .daily-audit-item .daily-audit-status{font-size:11px;font-weight:700}
  .daily-audit-item.pending{border-color:#f0c17a;background:#fff8ec}
  .daily-audit-item.pending .daily-audit-status{color:#a4670a}
  .daily-audit-item.ok{border-color:#bbe7c1;background:#f2fbf3}
  .daily-audit-item.ok .daily-audit-status{color:var(--green)}
  .daily-audit-item.diff .daily-audit-status{color:var(--red)}
  .daily-audit-item.diff{border-color:#f2b8b8;background:#fff5f5}
  .daily-audit-item .daily-audit-link{position:absolute;top:10px;right:12px;font-size:10px;color:var(--blue);cursor:pointer;background:none;border:0;padding:0;text-decoration:underline}

  /* Blocked submit banner */
  #dailyAuditBlockBanner{margin:8px 0 0;padding:11px 13px;border-radius:10px;background:#fdecec;border:1px solid #f2b8b8;color:#932e2e;font-size:12px;font-weight:600}
  #dailyAuditBlockBanner.hidden{display:none}

  /* Mini divergence chart */
  .audit-chart-card{margin-top:14px;padding:14px 16px;border:1px solid var(--line);border-radius:14px;background:#fff}
  .audit-chart-card .audit-chart-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:10px;flex-wrap:wrap}
  .audit-chart-card h4{margin:0;font-size:13px}
  .audit-chart-card small{color:var(--muted);font-size:10px}
  .audit-chart-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:10px;color:var(--muted)}
  .audit-chart-legend span{display:inline-flex;align-items:center;gap:6px}
  .audit-chart-legend i{width:10px;height:10px;border-radius:3px;display:inline-block}
  .audit-chart-svg{width:100%;height:150px;display:block}
  .audit-chart-svg .grid-line{stroke:#e5e9ee;stroke-width:1}
  .audit-chart-svg .zero-line{stroke:#9ca8b3;stroke-dasharray:3 3;stroke-width:1}
  .audit-chart-svg .axis-label{font-size:9px;fill:#8b95a2;font-family:Inter,system-ui,sans-serif}
  .audit-chart-svg .bar-positive{fill:#4caf7a}
  .audit-chart-svg .bar-negative{fill:#d95757}
  .audit-chart-svg .bar:hover{opacity:.75}
  .audit-chart-empty{padding:24px;text-align:center;color:var(--muted);font-size:11px}

  @media(max-width:620px){.daily-audit-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function storesOptions(){return STORES.map(store=>`<option>${escapeHtml(store)}</option>`).join('');}
function channelsOptions(){return CHANNELS.map(channel=>`<option>${escapeHtml(channel)}</option>`).join('');}

function injectNavigationAndViews() {
  const nav=document.querySelector('.sidebar nav');
  const workspace=document.querySelector('.workspace');
  if (!nav || !workspace || document.querySelector('[data-audit-view="motoboyAudit"]')) return;
  nav.insertAdjacentHTML('beforeend',`
    <button class="nav-item audit-nav operator-audit-nav" data-audit-view="motoboyAudit">🏍️ <span>Auditoria motoboys</span></button>
    <button class="nav-item audit-nav operator-audit-nav" data-audit-view="invoiceAudit">🧾 <span>Auditoria de notas</span></button>
    <button class="nav-item admin-only audit-nav" data-audit-view="backupCenter">⟳ <span>Backups</span></button>`);
  workspace.insertAdjacentHTML('beforeend',`
    <section id="motoboyAuditView" class="audit-view">
      <div class="audit-hero"><div class="audit-hero-body"><span class="audit-hero-icon" aria-hidden="true">🏍️</span><div><h3>Auditoria de motoboys</h3><p>Compare o valor de entrega lançado no sistema com o valor efetivamente pago.</p></div></div><span class="audit-hero-badge">CONFERÊNCIA DIÁRIA</span></div>
      <div class="audit-layout">
        <article class="card"><div class="card-title"><div><h3>Nova conferência</h3><p>Registre os dois valores para calcular a divergência.</p></div></div>
          <form id="motoboyAuditForm" class="audit-form"><div class="audit-form-grid">
            <label>Data<input name="date" type="date" required></label><label>Loja<select name="store" required>${storesOptions()}</select></label>
            <label>Valor de motoboy no sistema<input name="systemAmount" type="number" min="0" max="10000000" step="0.01" required placeholder="0,00"></label>
            <label>Valor realmente pago<input name="paidAmount" type="number" min="0" max="10000000" step="0.01" required placeholder="0,00"></label>
            <label class="wide">Observação<textarea name="notes" maxlength="500" rows="3" placeholder="Motoboy conferido, ajustes, descontos ou pagamentos adicionais"></textarea></label>
          </div><div id="motoboyPreview" class="audit-summary"></div><button class="btn btn-primary" type="submit">Registrar auditoria</button></form>
        </article>
        <article class="card"><div class="card-title"><div><h3>Últimas auditorias</h3><p>Histórico preservado para conferência.</p></div><button id="refreshMotoboyAudit" class="btn btn-secondary btn-small">Atualizar</button></div><div id="motoboyAuditList" class="audit-list"></div><div id="motoboyAuditChart" class="audit-chart-card"></div></article>
      </div>
    </section>
    <section id="invoiceAuditView" class="audit-view">
      <div class="audit-hero"><div class="audit-hero-body"><span class="audit-hero-icon" aria-hidden="true">🧾</span><div><h3>Auditoria de lançamento de notas</h3><p>Concilie iFood, máquinas fiscais e a nota fiscal emitida do dia.</p></div></div><span class="audit-hero-badge">CONFERÊNCIA DIÁRIA</span></div>
      <div class="audit-layout">
        <article class="card"><div class="card-title"><div><h3>Nova conferência</h3><p>Informe os três valores do dia para conferir a emissão.</p></div></div>
          <form id="invoiceAuditForm" class="audit-form"><div class="audit-form-grid">
            <label>Data<input name="date" type="date" required></label><label>Loja<select name="store" required>${storesOptions()}</select></label>
            <label>Valor vendido no iFood<input name="ifoodAmount" type="number" min="0" max="10000000" step="0.01" required placeholder="0,00"></label>
            <label>Valor passado nas máquinas fiscais<input name="machinesAmount" type="number" min="0" max="10000000" step="0.01" required placeholder="0,00"></label>
            <label class="wide">Valor de nota fiscal emitida<input name="invoiceAmount" type="number" min="0" max="10000000" step="0.01" required placeholder="0,00"></label>
            <label class="wide">Observação<textarea name="notes" maxlength="500" rows="3" placeholder="Explique notas pendentes, canceladas ou diferenças"></textarea></label>
          </div><div id="invoicePreview" class="audit-summary"></div><button class="btn btn-primary" type="submit">Registrar auditoria</button></form>
        </article>
        <article class="card"><div class="card-title"><div><h3>Últimas auditorias</h3><p>iFood, máquinas fiscais e nota emitida por dia.</p></div><button id="refreshInvoiceAudit" class="btn btn-secondary btn-small">Atualizar</button></div><div id="invoiceAuditList" class="audit-list"></div><div id="invoiceAuditChart" class="audit-chart-card"></div></article>
      </div>
    </section>
    <section id="backupCenterView" class="audit-view">
      <div class="audit-hero"><div><h3>Central de backups</h3><p>Proteção adicional contra exclusões acidentais e perda operacional.</p></div><span>ACESSO ADMINISTRATIVO</span></div>
      <div class="backup-grid">
        <article class="backup-card"><h4>Backup automático diário</h4><p>Ao primeiro acesso administrativo do dia, o sistema cria uma cópia protegida dos dados essenciais no Firebase.</p><div id="autoBackupStatus" class="backup-status">Verificando backup de hoje…</div></article>
        <article class="backup-card"><h4>Criar cópia agora</h4><p>Gera imediatamente um novo snapshot dos usuários, configurações, fechamentos e auditorias.</p><button id="createBackupNow" class="btn btn-primary">Criar backup</button></article>
        <article class="backup-card"><h4>Baixar arquivo JSON</h4><p>Baixe uma cópia independente para guardar no computador ou no Google Drive.</p><button id="downloadBackup" class="btn btn-secondary">Baixar backup</button></article>
      </div>
    </section>`);

  document.querySelectorAll('.audit-nav').forEach(button=>button.addEventListener('click',()=>{
    document.querySelectorAll('.view,.audit-view').forEach(view=>view.classList.remove('active-view'));
    document.querySelectorAll('.nav-item').forEach(item=>item.classList.remove('active'));
    const key=button.dataset.auditView;
    document.querySelector('#'+key+'View')?.classList.add('active-view');
    button.classList.add('active');
    const titles={motoboyAudit:'Auditoria de motoboys',invoiceAudit:'Auditoria de notas',backupCenter:'Backups'};
    const title=document.querySelector('#pageTitle'); if(title) title.textContent=titles[key];
    document.querySelector('.sidebar')?.classList.remove('open');
    if(key==='motoboyAudit') loadMotoboyAudits();
    if(key==='invoiceAudit') loadInvoiceAudits();
  }));

  document.querySelectorAll('.nav-item:not(.audit-nav)').forEach(button=>button.addEventListener('click',()=>{
    document.querySelectorAll('.audit-view').forEach(view=>view.classList.remove('active-view'));
  }));

  const dateInputs=document.querySelectorAll('#motoboyAuditForm input[name="date"],#invoiceAuditForm input[name="date"]');
  dateInputs.forEach(input=>input.value=today());
  bindForms();
}

function motoboyPreview(){
  const form=document.querySelector('#motoboyAuditForm'); if(!form)return;
  const system=number(form.systemAmount.value),paid=number(form.paidAmount.value),diff=paid-system;
  document.querySelector('#motoboyPreview').innerHTML=`
    <div class="audit-metric"><span>NO SISTEMA</span><strong>${money(system)}</strong></div>
    <div class="audit-metric"><span>VALOR PAGO</span><strong>${money(paid)}</strong></div>
    <div class="audit-metric ${Math.abs(diff)<.01?'positive':'negative'}"><span>DIVERGÊNCIA</span><strong>${money(diff)}</strong><small>${Math.abs(diff)<.01?'Valores conferem':diff>0?'Pago a mais':'Pago a menos'}</small></div>`;
}
function invoicePreview(){
  const form=document.querySelector('#invoiceAuditForm'); if(!form)return;
  const ifood=number(form.ifoodAmount.value);
  const machines=number(form.machinesAmount.value);
  const invoice=number(form.invoiceAmount.value);
  const expected=ifood+machines;
  const diff=expected-invoice;
  const isEven=Math.abs(diff)<.01;
  const statusLabel=isEven?'Nota confere com iFood + máquinas':diff>0?'Nota emitida a menos':'Nota emitida a mais';
  document.querySelector('#invoicePreview').innerHTML=`
    <div class="audit-metric"><span>IFOOD + MÁQUINAS</span><strong>${money(expected)}</strong><small>${money(ifood)} + ${money(machines)}</small></div>
    <div class="audit-metric"><span>NF EMITIDA</span><strong>${money(invoice)}</strong></div>
    <div class="audit-metric ${isEven?'positive':'negative'}"><span>DIFERENÇA (ESPERADO − NF)</span><strong>${money(diff)}</strong><small>${statusLabel}</small></div>`;
}

function bindForms(){
  const motoboy=document.querySelector('#motoboyAuditForm');
  const invoice=document.querySelector('#invoiceAuditForm');
  motoboy?.addEventListener('input',motoboyPreview); invoice?.addEventListener('input',invoicePreview);
  motoboyPreview(); invoicePreview();
  motoboy?.addEventListener('submit',async event=>{
    event.preventDefault(); if(!canAudit())return notify('Acesso restrito à equipe autorizada.',true);
    const data=Object.fromEntries(new FormData(motoboy));
    const systemAmount=number(data.systemAmount),paidAmount=number(data.paidAmount);
    const record={date:data.date,store:data.store,systemAmount,paidAmount,difference:paidAmount-systemAmount,notes:String(data.notes||'').trim(),createdAt:Date.now(),createdBy:auth.currentUser.uid,createdByName:currentProfile.name||auth.currentUser.email};
    try{await set(push(ref(db,'motoboyAudits')),record);notify('Auditoria do motoboy registrada.');motoboy.reset();motoboy.date.value=today();motoboyPreview();loadMotoboyAudits();refreshDailyAuditSummary();}catch(error){notify('Não foi possível registrar: '+error.message,true);}
  });
  invoice?.addEventListener('submit',async event=>{
    event.preventDefault(); if(!canAudit())return notify('Acesso restrito à equipe autorizada.',true);
    const data=Object.fromEntries(new FormData(invoice));
    const ifoodAmount=number(data.ifoodAmount);
    const machinesAmount=number(data.machinesAmount);
    const invoiceAmount=number(data.invoiceAmount);
    const expectedAmount=ifoodAmount+machinesAmount;
    const difference=expectedAmount-invoiceAmount;
    const record={date:data.date,store:data.store,ifoodAmount,machinesAmount,invoiceAmount,expectedAmount,difference,notes:String(data.notes||'').trim(),createdAt:Date.now(),createdBy:auth.currentUser.uid,createdByName:currentProfile.name||auth.currentUser.email};
    try{await set(push(ref(db,'invoiceAudits')),record);notify('Auditoria de notas registrada.');invoice.reset();invoice.date.value=today();invoicePreview();loadInvoiceAudits();refreshDailyAuditSummary();}catch(error){notify('Não foi possível registrar: '+error.message,true);}
  });
  document.querySelector('#refreshMotoboyAudit')?.addEventListener('click',loadMotoboyAudits);
  document.querySelector('#refreshInvoiceAudit')?.addEventListener('click',loadInvoiceAudits);
  document.querySelector('#createBackupNow')?.addEventListener('click',()=>createBackup(true));
  document.querySelector('#downloadBackup')?.addEventListener('click',downloadLatestBackup);
}

async function loadMotoboyAudits(){
  const list=document.querySelector('#motoboyAuditList'); if(!list||!canAudit())return;
  list.innerHTML='<p class="empty">Carregando…</p>';
  try{const snap=await get(query(ref(db,'motoboyAudits'),orderByChild('createdAt'),limitToLast(120)));const rows=Object.values(snap.val()||{}).reverse();const preview=rows.slice(0,40);list.innerHTML=preview.length?preview.map(item=>{
    const sys=number(item.systemAmount);const paid=number(item.paidAmount);
    const diff=item.difference!=null?number(item.difference):(paid-sys);
    const title=item.driver?escapeHtml(item.driver):'🏍️ Motoboys do dia';
    const author=authorLabel(item);const authorHtml=author?`<p class="audit-author">${escapeHtml(author)}</p>`:'';
    return `<div class="audit-record"><div><b>${title}</b><span>${escapeHtml(item.store||'—')} · ${dateBR(item.date)}</span></div><div><small>Sistema</small><b>${money(sys)}</b></div><div><small>Pago</small><b>${money(paid)}</b></div><div><small>Divergência</small><b class="difference ${Math.abs(diff)<.01?'ok':'bad'}">${money(diff)}</b><span>${Math.abs(diff)<.01?'Conferido':diff>0?'Pago a mais':'Pago a menos'}</span></div>${authorHtml}</div>`;
  }).join(''):'<p class="empty">Nenhuma auditoria registrada.</p>';renderDivergenceChart('motoboyAuditChart',rows,{title:'Divergência de motoboys (últimos 14 dias)',subtitle:'Valor pago menos valor no sistema.',valueOf:item=>item.difference!=null?number(item.difference):(number(item.paidAmount)-number(item.systemAmount))});}catch(error){list.innerHTML='<p class="empty">Não foi possível carregar.</p>';}
}
async function loadInvoiceAudits(){
  const list=document.querySelector('#invoiceAuditList'); if(!list||!canAudit())return;
  list.innerHTML='<p class="empty">Carregando…</p>';
  try{const snap=await get(query(ref(db,'invoiceAudits'),orderByChild('createdAt'),limitToLast(120)));const rows=Object.values(snap.val()||{}).reverse();const preview=rows.slice(0,40);list.innerHTML=preview.length?preview.map(item=>{
    const author=authorLabel(item);const authorHtml=author?`<p class="audit-author">${escapeHtml(author)}</p>`:'';
    const hasNew=item.ifoodAmount!=null||item.machinesAmount!=null||item.invoiceAmount!=null;
    if(hasNew){
      const ifood=number(item.ifoodAmount);const machines=number(item.machinesAmount);const invoice=number(item.invoiceAmount);
      const expected=item.expectedAmount!=null?number(item.expectedAmount):(ifood+machines);
      const diff=item.difference!=null?number(item.difference):(expected-invoice);
      const isEven=Math.abs(diff)<.01;
      const label=isEven?'Nota confere':diff>0?'Nota emitida a menos':'Nota emitida a mais';
      return `<div class="audit-record"><div><b>🧾 ${escapeHtml(item.store||'—')}</b><span>${dateBR(item.date)}</span></div><div><small>iFood + Máquinas</small><b>${money(expected)}</b><span>${money(ifood)} + ${money(machines)}</span></div><div><small>NF emitida</small><b>${money(invoice)}</b></div><div><small>Divergência</small><b class="difference ${isEven?'ok':'bad'}">${money(diff)}</b><span>${label}</span></div>${authorHtml}</div>`;
    }
    const salesAmt=number(item.salesAmount);const issuedAmt=number(item.issuedAmount);
    const amountDiff=item.amountDifference!=null?number(item.amountDifference):(issuedAmt-salesAmt);
    const countDiff=item.countDifference!=null?item.countDifference:((item.issuedCount||0)-(item.salesCount||0));
    return `<div class="audit-record legacy-record"><div><b>${escapeHtml(item.channel||'—')}</b><span>${escapeHtml(item.store||'—')} · ${dateBR(item.date)}</span><small>Registro anterior</small></div><div><small>Vendas</small><b>${item.salesCount??'—'} · ${money(salesAmt)}</b></div><div><small>Notas emitidas</small><b>${item.issuedCount??'—'} · ${money(issuedAmt)}</b></div><div><small>Divergência</small><b class="difference ${countDiff===0&&Math.abs(amountDiff)<.01?'ok':'bad'}">${countDiff} nota(s)</b><span>${money(amountDiff)}</span></div>${authorHtml}</div>`;
  }).join(''):'<p class="empty">Nenhuma auditoria registrada.</p>';renderDivergenceChart('invoiceAuditChart',rows,{title:'Divergência de notas (últimos 14 dias)',subtitle:'(iFood + Máquinas) menos NF emitida.',valueOf:item=>{if(item.difference!=null)return number(item.difference);if(item.expectedAmount!=null||item.ifoodAmount!=null||item.invoiceAmount!=null){const exp=item.expectedAmount!=null?number(item.expectedAmount):(number(item.ifoodAmount)+number(item.machinesAmount));return exp-number(item.invoiceAmount);}return number(item.amountDifference);}});}catch(error){list.innerHTML='<p class="empty">Não foi possível carregar.</p>';}
}

function renderDivergenceChart(containerId,rows,{title,subtitle,valueOf}){
  const container=document.querySelector('#'+containerId); if(!container)return;
  const validRows=(rows||[]).filter(item=>item&&item.date&&item.store);
  const stores=Array.from(new Set(validRows.map(item=>item.store))).sort();
  const currentFilter=container.dataset.storeFilter||'__all__';
  const filteredRows=currentFilter==='__all__'?validRows:validRows.filter(item=>item.store===currentFilter);
  // Aggregate by date within selected filter (sum of divergences per day).
  const byDate=new Map();
  filteredRows.forEach(item=>{
    const v=Number(valueOf(item))||0;
    byDate.set(item.date,(byDate.get(item.date)||0)+v);
  });
  const sortedDates=Array.from(byDate.keys()).sort().slice(-14);
  const values=sortedDates.map(date=>({date,value:byDate.get(date)}));
  const maxAbs=Math.max(1,...values.map(item=>Math.abs(item.value)));
  const width=560,height=150,padLeft=44,padRight=12,padTop=14,padBottom=26;
  const chartW=width-padLeft-padRight,chartH=height-padTop-padBottom;
  const zeroY=padTop+chartH/2;
  const barW=values.length?Math.max(6,Math.min(28,(chartW-8)/values.length-4)):0;
  const gap=values.length?(chartW-barW*values.length)/(values.length+1):0;
  const yTickTop=padTop,yTickBottom=padTop+chartH;
  const filterOptions=['__all__',...stores].map(store=>`<option value="${escapeHtml(store)}"${store===currentFilter?' selected':''}>${store==='__all__'?'Todas as lojas':escapeHtml(store)}</option>`).join('');
  const emptyMessage=`<div class="audit-chart-empty">Sem dados suficientes para gerar o gráfico.</div>`;
  let bars='';
  values.forEach((item,index)=>{
    const barH=Math.abs(item.value)/maxAbs*(chartH/2);
    const x=padLeft+gap+(index)*(barW+gap);
    const y=item.value>=0?zeroY-barH:zeroY;
    const cls=item.value>=0?'bar bar-positive':'bar bar-negative';
    const label=`${dateBR(item.date)} · ${money(item.value)}`;
    bars+=`<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(2,barH).toFixed(1)}" rx="2"><title>${escapeHtml(label)}</title></rect>`;
    const dayLabel=item.date.split('-').slice(1).reverse().join('/');
    bars+=`<text class="axis-label" x="${(x+barW/2).toFixed(1)}" y="${(padTop+chartH+16).toFixed(1)}" text-anchor="middle">${escapeHtml(dayLabel)}</text>`;
  });
  const yLabelTop=money(maxAbs);const yLabelBottom=money(-maxAbs);
  const svg=values.length?`<svg class="audit-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(title)}">
    <line class="grid-line" x1="${padLeft}" y1="${yTickTop}" x2="${width-padRight}" y2="${yTickTop}"></line>
    <line class="grid-line" x1="${padLeft}" y1="${yTickBottom}" x2="${width-padRight}" y2="${yTickBottom}"></line>
    <line class="zero-line" x1="${padLeft}" y1="${zeroY}" x2="${width-padRight}" y2="${zeroY}"></line>
    <text class="axis-label" x="${padLeft-6}" y="${yTickTop+4}" text-anchor="end">${escapeHtml(yLabelTop)}</text>
    <text class="axis-label" x="${padLeft-6}" y="${zeroY+3}" text-anchor="end">R$ 0,00</text>
    <text class="axis-label" x="${padLeft-6}" y="${yTickBottom+4}" text-anchor="end">${escapeHtml(yLabelBottom)}</text>
    ${bars}
  </svg>`:emptyMessage;
  container.innerHTML=`<div class="audit-chart-head"><div><h4>${escapeHtml(title)}</h4><small>${escapeHtml(subtitle)}</small></div><label class="audit-chart-filter"><small>Loja</small><select data-chart-store>${filterOptions}</select></label></div>
    <div class="audit-chart-legend"><span><i style="background:#4caf7a"></i>A favor da loja</span><span><i style="background:#d95757"></i>Contra a loja</span></div>
    ${svg}`;
  const select=container.querySelector('[data-chart-store]');
  select?.addEventListener('change',event=>{container.dataset.storeFilter=event.target.value;renderDivergenceChart(containerId,rows,{title,subtitle,valueOf});});
}

// ============================================================
// Daily audit summary card injected into the closing view
// ============================================================
function injectClosingDailyCard(){
  if(document.querySelector('#dailyAuditSummary'))return;
  const form=document.querySelector('#closingForm');
  const heading=form?.querySelector('.form-heading');
  if(!form||!heading)return;
  const card=document.createElement('article');
  card.id='dailyAuditSummary';
  card.className='card daily-audit-card';
  card.innerHTML=`
    <div class="daily-audit-head"><div><h4>Auditorias do dia</h4><small class="daily-audit-meta" id="dailyAuditMeta">Selecione data e loja para carregar.</small></div><span id="dailyAuditGate" class="badge draft">Aguardando…</span></div>
    <div class="daily-audit-grid">
      <div class="daily-audit-item pending" data-audit-item="motoboy">
        <span class="daily-audit-title"><span class="icon" aria-hidden="true">🏍️</span>Motoboy</span>
        <strong class="daily-audit-value" data-audit-value>—</strong>
        <small class="daily-audit-status" data-audit-status>Ainda não lançada</small>
        <small class="daily-audit-author" data-audit-author hidden></small>
        <button type="button" class="daily-audit-link" data-audit-jump="motoboyAudit">Abrir auditoria</button>
      </div>
      <div class="daily-audit-item pending" data-audit-item="invoice">
        <span class="daily-audit-title"><span class="icon" aria-hidden="true">🧾</span>Notas fiscais</span>
        <strong class="daily-audit-value" data-audit-value>—</strong>
        <small class="daily-audit-status" data-audit-status>Ainda não lançada</small>
        <small class="daily-audit-author" data-audit-author hidden></small>
        <button type="button" class="daily-audit-link" data-audit-jump="invoiceAudit">Abrir auditoria</button>
      </div>
    </div>
    <p id="dailyAuditBlockBanner" class="hidden" role="alert">Você precisa registrar as duas auditorias do dia para conseguir enviar o fechamento.</p>`;
  heading.after(card);
  card.querySelectorAll('[data-audit-jump]').forEach(btn=>btn.addEventListener('click',()=>{
    const target=document.querySelector(`[data-audit-view="${btn.dataset.auditJump}"]`);
    target?.click();
  }));
  const dateInput=form.querySelector('input[name="date"]');
  const storeInput=form.querySelector('[name="store"]');
  const trigger=()=>refreshDailyAuditSummary();
  dateInput?.addEventListener('change',trigger);
  storeInput?.addEventListener('change',trigger);
  // Also refresh whenever closing view becomes active.
  document.querySelectorAll('.nav-item[data-view="closing"]').forEach(btn=>btn.addEventListener('click',()=>setTimeout(refreshDailyAuditSummary,50)));
  refreshDailyAuditSummary();
}

async function fetchDailyAuditsFor(store,date){
  if(!store||!date||!canAudit())return {motoboy:null,invoice:null};
  const [motoSnap,invSnap]=await Promise.all([
    get(query(ref(db,'motoboyAudits'),orderByChild('date'),equalTo(date))).catch(()=>null),
    get(query(ref(db,'invoiceAudits'),orderByChild('date'),equalTo(date))).catch(()=>null),
  ]);
  const pickForStore=(snap)=>{
    if(!snap||!snap.exists())return null;
    const rows=Object.values(snap.val()||{}).filter(item=>item.store===store);
    if(!rows.length)return null;
    rows.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    return rows[0];
  };
  return {motoboy:pickForStore(motoSnap),invoice:pickForStore(invSnap)};
}

async function refreshDailyAuditSummary(){
  const card=document.querySelector('#dailyAuditSummary'); if(!card)return;
  const form=document.querySelector('#closingForm'); if(!form)return;
  const store=form.querySelector('[name="store"]')?.value||'';
  const date=form.querySelector('input[name="date"]')?.value||'';
  const meta=card.querySelector('#dailyAuditMeta');
  const gate=card.querySelector('#dailyAuditGate');
  const banner=card.querySelector('#dailyAuditBlockBanner');
  const motoItem=card.querySelector('[data-audit-item="motoboy"]');
  const invItem=card.querySelector('[data-audit-item="invoice"]');
  const setItem=(item,record,formatter)=>{
    const valueEl=item.querySelector('[data-audit-value]');
    const statusEl=item.querySelector('[data-audit-status]');
    const authorEl=item.querySelector('[data-audit-author]');
    item.classList.remove('pending','ok','diff');
    if(!record){item.classList.add('pending');valueEl.textContent='—';statusEl.textContent='Ainda não lançada';if(authorEl){authorEl.hidden=true;authorEl.textContent='';}return false;}
    const {value,statusText,isEven}=formatter(record);
    valueEl.textContent=value;statusEl.textContent=statusText;
    item.classList.add(isEven?'ok':'diff');
    if(authorEl){const label=authorLabel(record);if(label){authorEl.hidden=false;authorEl.textContent=label;}else{authorEl.hidden=true;authorEl.textContent='';}}
    return true;
  };
  if(!store||!date){meta.textContent='Selecione data e loja para carregar.';gate.textContent='Aguardando…';gate.className='badge draft';setItem(motoItem,null,()=>({}));setItem(invItem,null,()=>({}));banner.classList.add('hidden');return;}
  meta.textContent=`${escapeHtml(store)} · ${dateBR(date)}`;
  gate.textContent='Verificando…';gate.className='badge draft';
  try{
    const {motoboy,invoice}=await fetchDailyAuditsFor(store,date);
    const motoOk=setItem(motoItem,motoboy,record=>{
      const diff=record.difference!=null?number(record.difference):(number(record.paidAmount)-number(record.systemAmount));
      const isEven=Math.abs(diff)<.01;
      return {value:money(diff),statusText:isEven?'Motoboys conferidos':(diff>0?'Pago a mais':'Pago a menos'),isEven};
    });
    const invOk=setItem(invItem,invoice,record=>{
      const diff=record.difference!=null?number(record.difference):(number(record.expectedAmount||(number(record.ifoodAmount)+number(record.machinesAmount)))-number(record.invoiceAmount));
      const isEven=Math.abs(diff)<.01;
      return {value:money(diff),statusText:isEven?'Notas conferem':(diff>0?'NF emitida a menos':'NF emitida a mais'),isEven};
    });
    if(motoOk&&invOk){gate.textContent='Auditorias OK';gate.className='badge success';banner.classList.add('hidden');}
    else{gate.textContent='Faltam auditorias';gate.className='badge warn';banner.classList.remove('hidden');}
  }catch(error){meta.textContent='Não foi possível verificar as auditorias.';gate.textContent='Erro';gate.className='badge warn';}
}

// ============================================================
// Public API used by app.js to enforce the daily lock
// ============================================================
window.HouseAudits={
  async checkDailyAudits(store,date){
    try{
      const {motoboy,invoice}=await fetchDailyAuditsFor(store,date);
      return {motoboy:!!motoboy,invoice:!!invoice,ok:!!motoboy&&!!invoice};
    }catch{return {motoboy:false,invoice:false,ok:false,error:true};}
  },
  refreshClosingSummary:refreshDailyAuditSummary,
};

async function collectBackup(){
  const paths=['users','settings','closings','motoboyAudits','invoiceAudits'];
  const snapshots=await Promise.all(paths.map(path=>get(ref(db,path))));
  const data=Object.fromEntries(paths.map((path,index)=>[path,snapshots[index].val()||{}]));
  const auditLogs={};
  for(const closingId of Object.keys(data.closings||{})){try{const snap=await get(ref(db,'auditLogs/'+closingId));if(snap.exists())auditLogs[closingId]=snap.val();}catch{}}
  data.auditLogs=auditLogs;
  return {schemaVersion:1,system:'House 190 - Fechamento de Caixa',createdAt:new Date().toISOString(),createdBy:auth.currentUser.email,data};
}
async function createBackup(manual=false){
  if(!canBackup())return;
  const status=document.querySelector('#autoBackupStatus');
  if(status)status.textContent='Criando backup…';
  try{const backup=await collectBackup();const key=(manual?today()+'-'+Date.now():today());await set(ref(db,'backups/'+key),backup);if(status)status.textContent='Último backup: '+new Date().toLocaleString('pt-BR');notify('Backup criado com sucesso.');return backup;}catch(error){if(status)status.textContent='Falha no backup: '+error.message;notify('Falha ao criar backup.',true);}
}
async function ensureDailyBackup(){
  if(!canBackup())return;
  const status=document.querySelector('#autoBackupStatus');
  try{const snap=await get(ref(db,'backups/'+today()));if(snap.exists()){if(status)status.textContent='Backup de hoje já está protegido.';return;}await createBackup(false);}catch(error){if(status)status.textContent='Não foi possível verificar o backup.';}
}
async function downloadLatestBackup(){
  if(!canBackup())return;
  try{const backup=await collectBackup();const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=`house190-backup-${today()}.json`;anchor.click();URL.revokeObjectURL(url);notify('Arquivo de backup baixado.');}catch(error){notify('Não foi possível gerar o arquivo.',true);}
}

document.addEventListener('DOMContentLoaded',()=>{injectStyles();modernizeBrand();injectNavigationAndViews();injectClosingDailyCard();});
onAuthStateChanged(auth,async user=>{
  if(!user){currentProfile=null;return;}
  try{const snap=await get(ref(db,'users/'+user.uid));currentProfile=snap.val();document.querySelectorAll('.audit-nav.operator-audit-nav').forEach(el=>el.classList.toggle('hidden',!canAudit()));document.querySelectorAll('.audit-nav.admin-only').forEach(el=>el.classList.toggle('hidden',!canBackup()));if(canBackup())ensureDailyBackup();refreshDailyAuditSummary();}catch{currentProfile=null;}
});
