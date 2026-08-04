import { getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getDatabase, ref, get, set, push, query, orderByChild, limitToLast } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';

const app = getApps().length ? getApp() : null;
const auth = getAuth(app);
const db = getDatabase(app);
const STORES = ['House 190 Teixeira','House 190 Eunápolis','House Food Park Teixeira'];
const CHANNELS = ['iFood','Stone','Sipag','Cielo','Cappta','Laranjinha','Wise','Outra máquina'];
let currentProfile = null;

const money = value => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
const number = value => Number(String(value ?? 0).replace(',','.')) || 0;
const dateBR = value => value ? value.split('-').reverse().join('/') : '—';
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const today = () => new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
const canAudit = () => ['admin','finance'].includes(currentProfile?.role);
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
  .audit-hero h3{margin:0;font-size:19px}.audit-hero p{margin:5px 0 0;color:#dbe9f1;font-size:11px}.audit-hero span{padding:7px 11px;border-radius:999px;background:#ffffff18;font-size:10px;font-weight:800}
  .audit-layout{display:grid;grid-template-columns:minmax(330px,.72fr) minmax(0,1.28fr);gap:16px}.audit-form{display:grid;gap:13px}.audit-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}.audit-form-grid .wide{grid-column:1/-1}
  .audit-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.audit-metric{padding:14px;border:1px solid var(--line);border-radius:11px;background:#f8fafb}.audit-metric span,.audit-metric small{display:block;color:var(--muted);font-size:9px}.audit-metric strong{display:block;margin:5px 0;font-size:18px}.audit-metric.positive strong{color:var(--green)}.audit-metric.negative strong{color:var(--red)}
  .audit-list{display:grid;gap:10px}.audit-record{display:grid;grid-template-columns:1.1fr .8fr .8fr .8fr;gap:12px;align-items:center;padding:13px;border:1px solid var(--line);border-radius:11px;background:#fff}.audit-record b,.audit-record span,.audit-record small{display:block}.audit-record span,.audit-record small{margin-top:3px;color:var(--muted);font-size:9px}.audit-record .difference{font-size:14px;font-weight:900}.difference.ok{color:var(--green)}.difference.bad{color:var(--red)}
  .backup-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.backup-card{padding:20px;border:1px solid var(--line);border-radius:14px;background:#fff}.backup-card h4{margin:0}.backup-card p{min-height:44px;color:var(--muted);font-size:10px;line-height:1.55}.backup-status{margin-top:15px;padding:12px;border-radius:10px;background:var(--blue-soft);color:var(--blue);font-size:10px;font-weight:800}
  @media(max-width:900px){.audit-layout{grid-template-columns:1fr}.backup-grid{grid-template-columns:1fr}.audit-record{grid-template-columns:1fr 1fr}}
  @media(max-width:620px){.audit-view{padding:14px}.audit-form-grid,.audit-summary,.audit-record{grid-template-columns:1fr}.audit-hero{align-items:flex-start;flex-direction:column}}
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
    <button class="nav-item finance-only audit-nav" data-audit-view="motoboyAudit">⇄ <span>Auditoria motoboys</span></button>
    <button class="nav-item finance-only audit-nav" data-audit-view="invoiceAudit">▤ <span>Auditoria de notas</span></button>
    <button class="nav-item admin-only audit-nav" data-audit-view="backupCenter">⟳ <span>Backups</span></button>`);
  workspace.insertAdjacentHTML('beforeend',`
    <section id="motoboyAuditView" class="audit-view">
      <div class="audit-hero"><div><h3>Auditoria de motoboys</h3><p>Compare o valor de entrega lançado no sistema com o valor efetivamente pago.</p></div><span>CONFERÊNCIA FINANCEIRA</span></div>
      <div class="audit-layout">
        <article class="card"><div class="card-title"><div><h3>Nova conferência</h3><p>Registre os dois valores para calcular a divergência.</p></div></div>
          <form id="motoboyAuditForm" class="audit-form"><div class="audit-form-grid">
            <label>Data<input name="date" type="date" required></label><label>Loja<select name="store" required>${storesOptions()}</select></label>
            <label class="wide">Motoboy<input name="driver" maxlength="100" required placeholder="Nome do motoboy"></label>
            <label>Valor no sistema<input name="systemAmount" type="number" min="0" max="10000000" step="0.01" required></label>
            <label>Valor pago<input name="paidAmount" type="number" min="0" max="10000000" step="0.01" required></label>
            <label class="wide">Observação<textarea name="notes" maxlength="500" rows="3" placeholder="Explique ajustes, descontos ou pagamentos adicionais"></textarea></label>
          </div><div id="motoboyPreview" class="audit-summary"></div><button class="btn btn-primary" type="submit">Registrar auditoria</button></form>
        </article>
        <article class="card"><div class="card-title"><div><h3>Últimas auditorias</h3><p>Histórico preservado para conferência.</p></div><button id="refreshMotoboyAudit" class="btn btn-secondary btn-small">Atualizar</button></div><div id="motoboyAuditList" class="audit-list"></div></article>
      </div>
    </section>
    <section id="invoiceAuditView" class="audit-view">
      <div class="audit-hero"><div><h3>Auditoria de emissão de notas</h3><p>Compare vendas do iFood e máquinas com as notas emitidas no dia.</p></div><span>QUANTIDADE + VALOR</span></div>
      <div class="audit-layout">
        <article class="card"><div class="card-title"><div><h3>Nova conferência</h3><p>Informe vendas e notas emitidas no mesmo canal.</p></div></div>
          <form id="invoiceAuditForm" class="audit-form"><div class="audit-form-grid">
            <label>Data<input name="date" type="date" required></label><label>Loja<select name="store" required>${storesOptions()}</select></label>
            <label class="wide">Canal<select name="channel" required>${channelsOptions()}</select></label>
            <label>Quantidade de vendas<input name="salesCount" type="number" min="0" max="100000" step="1" required></label>
            <label>Valor vendido<input name="salesAmount" type="number" min="0" max="10000000" step="0.01" required></label>
            <label>Quantidade de notas emitidas<input name="issuedCount" type="number" min="0" max="100000" step="1" required></label>
            <label>Valor total emitido<input name="issuedAmount" type="number" min="0" max="10000000" step="0.01" required></label>
            <label class="wide">Observação<textarea name="notes" maxlength="500" rows="3" placeholder="Explique notas pendentes, canceladas ou diferenças"></textarea></label>
          </div><div id="invoicePreview" class="audit-summary"></div><button class="btn btn-primary" type="submit">Registrar auditoria</button></form>
        </article>
        <article class="card"><div class="card-title"><div><h3>Últimas auditorias</h3><p>iFood e máquinas conferidos por dia.</p></div><button id="refreshInvoiceAudit" class="btn btn-secondary btn-small">Atualizar</button></div><div id="invoiceAuditList" class="audit-list"></div></article>
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
  const countDiff=number(form.issuedCount.value)-number(form.salesCount.value);
  const amountDiff=number(form.issuedAmount.value)-number(form.salesAmount.value);
  document.querySelector('#invoicePreview').innerHTML=`
    <div class="audit-metric ${countDiff===0?'positive':'negative'}"><span>DIFERENÇA EM NOTAS</span><strong>${countDiff}</strong><small>${countDiff===0?'Quantidade confere':countDiff>0?'Notas a mais':'Notas pendentes'}</small></div>
    <div class="audit-metric ${Math.abs(amountDiff)<.01?'positive':'negative'}"><span>DIFERENÇA EM VALOR</span><strong>${money(amountDiff)}</strong></div>
    <div class="audit-metric"><span>CANAL</span><strong>${escapeHtml(form.channel.value||'—')}</strong></div>`;
}

function bindForms(){
  const motoboy=document.querySelector('#motoboyAuditForm');
  const invoice=document.querySelector('#invoiceAuditForm');
  motoboy?.addEventListener('input',motoboyPreview); invoice?.addEventListener('input',invoicePreview);
  motoboyPreview(); invoicePreview();
  motoboy?.addEventListener('submit',async event=>{
    event.preventDefault(); if(!canAudit())return notify('Acesso restrito ao financeiro.',true);
    const data=Object.fromEntries(new FormData(motoboy));
    const systemAmount=number(data.systemAmount),paidAmount=number(data.paidAmount);
    const record={date:data.date,store:data.store,driver:String(data.driver).trim(),systemAmount,paidAmount,difference:paidAmount-systemAmount,notes:String(data.notes||'').trim(),createdAt:Date.now(),createdBy:auth.currentUser.uid,createdByName:currentProfile.name||auth.currentUser.email};
    try{await set(push(ref(db,'motoboyAudits')),record);notify('Auditoria do motoboy registrada.');motoboy.reset();motoboy.date.value=today();motoboyPreview();loadMotoboyAudits();}catch(error){notify('Não foi possível registrar: '+error.message,true);}
  });
  invoice?.addEventListener('submit',async event=>{
    event.preventDefault(); if(!canAudit())return notify('Acesso restrito ao financeiro.',true);
    const data=Object.fromEntries(new FormData(invoice));
    const record={date:data.date,store:data.store,channel:data.channel,salesCount:number(data.salesCount),salesAmount:number(data.salesAmount),issuedCount:number(data.issuedCount),issuedAmount:number(data.issuedAmount),notes:String(data.notes||'').trim(),createdAt:Date.now(),createdBy:auth.currentUser.uid,createdByName:currentProfile.name||auth.currentUser.email};
    record.countDifference=record.issuedCount-record.salesCount; record.amountDifference=record.issuedAmount-record.salesAmount;
    try{await set(push(ref(db,'invoiceAudits')),record);notify('Auditoria de notas registrada.');invoice.reset();invoice.date.value=today();invoicePreview();loadInvoiceAudits();}catch(error){notify('Não foi possível registrar: '+error.message,true);}
  });
  document.querySelector('#refreshMotoboyAudit')?.addEventListener('click',loadMotoboyAudits);
  document.querySelector('#refreshInvoiceAudit')?.addEventListener('click',loadInvoiceAudits);
  document.querySelector('#createBackupNow')?.addEventListener('click',()=>createBackup(true));
  document.querySelector('#downloadBackup')?.addEventListener('click',downloadLatestBackup);
}

async function loadMotoboyAudits(){
  const list=document.querySelector('#motoboyAuditList'); if(!list||!canAudit())return;
  list.innerHTML='<p class="empty">Carregando…</p>';
  try{const snap=await get(query(ref(db,'motoboyAudits'),orderByChild('createdAt'),limitToLast(40)));const rows=Object.values(snap.val()||{}).reverse();list.innerHTML=rows.length?rows.map(item=>`
    <div class="audit-record"><div><b>${escapeHtml(item.driver)}</b><span>${escapeHtml(item.store)} · ${dateBR(item.date)}</span></div><div><small>Sistema</small><b>${money(item.systemAmount)}</b></div><div><small>Pago</small><b>${money(item.paidAmount)}</b></div><div><small>Divergência</small><b class="difference ${Math.abs(item.difference)<.01?'ok':'bad'}">${money(item.difference)}</b><span>${Math.abs(item.difference)<.01?'Conferido':item.difference>0?'Pago a mais':'Pago a menos'}</span></div></div>`).join(''):'<p class="empty">Nenhuma auditoria registrada.</p>';}catch(error){list.innerHTML='<p class="empty">Não foi possível carregar.</p>';}
}
async function loadInvoiceAudits(){
  const list=document.querySelector('#invoiceAuditList'); if(!list||!canAudit())return;
  list.innerHTML='<p class="empty">Carregando…</p>';
  try{const snap=await get(query(ref(db,'invoiceAudits'),orderByChild('createdAt'),limitToLast(40)));const rows=Object.values(snap.val()||{}).reverse();list.innerHTML=rows.length?rows.map(item=>`
    <div class="audit-record"><div><b>${escapeHtml(item.channel)}</b><span>${escapeHtml(item.store)} · ${dateBR(item.date)}</span></div><div><small>Vendas</small><b>${item.salesCount} · ${money(item.salesAmount)}</b></div><div><small>Notas emitidas</small><b>${item.issuedCount} · ${money(item.issuedAmount)}</b></div><div><small>Divergência</small><b class="difference ${item.countDifference===0&&Math.abs(item.amountDifference)<.01?'ok':'bad'}">${item.countDifference} nota(s)</b><span>${money(item.amountDifference)}</span></div></div>`).join(''):'<p class="empty">Nenhuma auditoria registrada.</p>';}catch(error){list.innerHTML='<p class="empty">Não foi possível carregar.</p>';}
}

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

document.addEventListener('DOMContentLoaded',()=>{injectStyles();modernizeBrand();injectNavigationAndViews();});
onAuthStateChanged(auth,async user=>{
  if(!user){currentProfile=null;return;}
  try{const snap=await get(ref(db,'users/'+user.uid));currentProfile=snap.val();document.querySelectorAll('.audit-nav.finance-only').forEach(el=>el.classList.toggle('hidden',!canAudit()));document.querySelectorAll('.audit-nav.admin-only').forEach(el=>el.classList.toggle('hidden',!canBackup()));if(canBackup())ensureDailyBackup();}catch{currentProfile=null;}
});
