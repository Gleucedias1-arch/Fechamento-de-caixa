import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getDatabase, ref, get, set, push, update, query, orderByChild, startAt, endAt } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
import { firebaseConfig, ADMIN_EMAIL } from './firebase-config.js';
import { SYSTEM_FIELDS, COUNTED_FIELDS, numberFrom, calculateClosing, formatBRL } from './calculations.js';

const STORES = ['House 190 Teixeira','House 190 Eunápolis','House Food Park Teixeira'];
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
let profile = null;
let currentClosings = [];
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const isoToday = () => new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);

function toast(message, error=false){ const el=$('#toast'); el.textContent=message; el.className=`toast show${error?' error-toast':''}`; clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.className='toast',2800); }
function allowedStores(){ return profile?.role==='admin' ? STORES : (profile?.stores || (profile?.store?[profile.store]:[])); }
function fillStores(){ ['#dashStore','select[name="store"]','#historyStore','#userForm select[name="store"]'].forEach(selector=>{const el=$(selector);if(!el)return;const first=selector.includes('history')||selector.includes('dash')?'<option value="all">Todas as lojas</option>':'';el.innerHTML=first+allowedStores().map(s=>`<option>${s}</option>`).join('');}); }

async function ensureProfile(user){
  const snap=await get(ref(db,`users/${user.uid}`));
  if(snap.exists()) return snap.val();
  if(user.email?.toLowerCase()!==ADMIN_EMAIL) throw new Error('Usuário sem perfil autorizado. Procure o administrador.');
  const first={name:'Gleuce Dias',email:user.email,role:'admin',stores:STORES,active:true,createdAt:Date.now()};
  await set(ref(db,`users/${user.uid}`),first); return first;
}

onAuthStateChanged(auth, async user=>{
  if(!user){profile=null;$('#loginView').classList.remove('hidden');$('#appView').classList.add('hidden');return;}
  try{profile=await ensureProfile(user);if(profile.active===false)throw new Error('Acesso desativado.');$('#loginView').classList.add('hidden');$('#appView').classList.remove('hidden');$('#userName').textContent=profile.name||user.email;$('#userRole').textContent={admin:'Administrador',manager:'Gerente',operator:'Operador'}[profile.role]||profile.role;$('#userInitial').textContent=(profile.name||user.email)[0].toUpperCase();$$('.admin-only').forEach(el=>el.classList.toggle('hidden',profile.role!=='admin'));fillStores();initDates();await loadDashboard();if(profile.role==='admin')loadUsers();}catch(e){toast(e.message,true);await signOut(auth);}
});

$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();$('#loginError').textContent='';try{await signInWithEmailAndPassword(auth,$('#loginEmail').value.trim(),$('#loginPassword').value);}catch(err){$('#loginError').textContent='E-mail ou senha inválidos.';}});
$('#logoutBtn').onclick=()=>signOut(auth);
$('#menuBtn').onclick=()=>$('.sidebar').classList.toggle('open');
$$('.nav-item[data-view]').forEach(btn=>btn.onclick=()=>showView(btn.dataset.view));
function showView(name){$$('.view').forEach(v=>v.classList.remove('active-view'));$(`#${name}View`).classList.add('active-view');$$('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===name));$('#pageTitle').textContent={dashboard:'Dashboard',closing:'Novo fechamento',history:'Histórico',users:'Usuários'}[name];$('.sidebar').classList.remove('open');if(name==='history')loadHistory();}
function initDates(){const today=isoToday();$('#todayLabel').textContent=new Intl.DateTimeFormat('pt-BR',{dateStyle:'full'}).format(new Date(`${today}T12:00:00`));$('#dashDate').value=today;$('[name="date"]').value=today;$('#historyTo').value=today;const d=new Date(`${today}T12:00:00`);d.setDate(1);$('#historyFrom').value=d.toISOString().slice(0,10);}

function formData(){const raw=Object.fromEntries(new FormData($('#closingForm')));[...SYSTEM_FIELDS,...COUNTED_FIELDS,'opening_float','withdrawals','expenses','cash_in','closing_float','adjustments'].forEach(k=>raw[k]=numberFrom(raw[k]));return raw;}
function updateCalculation(){const result=calculateClosing(formData());$('#systemTotal').textContent=formatBRL(result.systemTotal);$('#countedTotal').textContent=formatBRL(result.countedTotal);$('#diffTotal').textContent=formatBRL(result.difference);const rec=$('.reconciliation'),icon=$('#diffBadge');rec.style.borderLeftColor=result.status==='balanced'?'var(--green)':result.status==='surplus'?'var(--orange)':'var(--red)';icon.className=`result-icon ${result.status==='balanced'?'ok':'bad'}`;icon.textContent=result.status==='balanced'?'✓':'!';$('#diffExplanation').textContent=result.status==='balanced'?'Os valores estão conciliados.':result.status==='surplus'?'Foi encontrada sobra de caixa.':'Foi encontrada falta de caixa.';}
$('#closingForm').addEventListener('input',updateCalculation);
async function persistClosing(finalStatus){const data=formData();const calc=calculateClosing(data);const user=auth.currentUser;if(!allowedStores().includes(data.store))throw new Error('Loja não autorizada.');const id=$('#closingForm').dataset.id||push(ref(db,'closings')).key;const record={...data,...calc,id,status:finalStatus,createdBy:user.uid,createdByName:profile.name,updatedAt:Date.now(),closedAt:finalStatus==='closed'?Date.now():null,searchDateStore:`${data.date}_${data.store}`};await set(ref(db,`closings/${id}`),record);$('#closingForm').dataset.id=id;$('#formStatus').textContent=finalStatus==='closed'?'Fechado':'Rascunho';$('#formStatus').className=`badge ${finalStatus==='closed'?(calc.status==='balanced'?'ok':'warn'):'draft'}`;toast(finalStatus==='closed'?'Caixa fechado com sucesso.':'Rascunho salvo.');if(finalStatus==='closed'){setTimeout(()=>{resetClosing();showView('dashboard');loadDashboard();},700);}}
$('#saveDraft').onclick=async()=>{try{await persistClosing('draft');}catch(e){toast(e.message,true)}};
$('#closingForm').addEventListener('submit',async e=>{e.preventDefault();const {difference}=calculateClosing(formData());if(Math.abs(difference)>=.01&&!$('[name="notes"]').value.trim()){toast('Descreva a divergência nas observações antes de fechar.',true);return;}try{await persistClosing('closed');}catch(err){toast(err.message,true)}});
function resetClosing(){const f=$('#closingForm');f.reset();delete f.dataset.id;initDates();$$('input[inputmode="decimal"]',f).forEach(i=>i.value='0');$('#formStatus').textContent='Rascunho';$('#formStatus').className='badge draft';updateCalculation();}

async function fetchClosings(from,to){const snap=await get(query(ref(db,'closings'),orderByChild('date'),startAt(from),endAt(to)));return snap.exists()?Object.values(snap.val()).filter(x=>allowedStores().includes(x.store)):[];}
async function loadDashboard(){try{const date=$('#dashDate').value||isoToday();currentClosings=await fetchClosings(date,date);const store=$('#dashStore').value||'all';const rows=currentClosings.filter(x=>(store==='all'||x.store===store)&&x.status==='closed');const total=(k)=>rows.reduce((s,x)=>s+numberFrom(x[k]),0);const system=total('systemTotal'),counted=total('countedTotal'),diff=total('difference');$('#kpiSales').textContent=formatBRL(system);$('#kpiCounted').textContent=formatBRL(counted);$('#kpiDiff').textContent=formatBRL(diff);$('#kpiDiff').style.color=Math.abs(diff)<.01?'var(--green)':'var(--red)';$('#kpiDiffText').textContent=Math.abs(diff)<.01?'Caixa conciliado':diff>0?'Sobra encontrada':'Falta encontrada';$('#kpiClosings').textContent=`${rows.length}/${store==='all'?allowedStores().length:1}`;renderStoreStatus(rows);renderChannels(rows);renderDivergences(rows);}catch(e){toast('Não foi possível carregar o dashboard.',true);}}
function renderStoreStatus(rows){$('#storeStatus').innerHTML=allowedStores().map(store=>{const found=rows.filter(x=>x.store===store),diff=found.reduce((s,x)=>s+x.difference,0);const cls=!found.length?'draft':Math.abs(diff)<.01?'ok':'bad';const text=!found.length?'Pendente':Math.abs(diff)<.01?'Conciliado':'Divergência';return `<div class="store-row"><div><b>${store}</b><small>${found.length?`${found.length} fechamento(s)`:'Nenhum fechamento'}</small></div><strong>${found.length?formatBRL(diff):'—'}</strong><span class="badge ${cls}">${text}</span></div>`}).join('');}
function renderChannels(rows){const channels=[['Dinheiro','system_cash'],['Cartões','system_credit','system_debit'],['Pix','system_pix'],['iFood','system_ifood_online','system_ifood_voucher'],['Outros','system_term','system_club']];const values=channels.map(([label,...keys])=>[label,rows.reduce((s,x)=>s+keys.reduce((a,k)=>a+numberFrom(x[k]),0),0)]);const max=Math.max(...values.map(x=>x[1]),1);$('#channelBars').innerHTML=values.map(([l,v])=>`<div><div class="bar-head"><span>${l}</span><b>${formatBRL(v)}</b></div><div class="bar-track"><div class="bar-fill" style="width:${v/max*100}%"></div></div></div>`).join('');}
function renderDivergences(rows){const d=rows.filter(x=>Math.abs(x.difference)>=.01).sort((a,b)=>Math.abs(b.difference)-Math.abs(a.difference));$('#divergenceRows').innerHTML=d.length?d.map(x=>`<tr><td>${x.store}</td><td>${x.operator}</td><td>${formatBRL(x.systemTotal)}</td><td>${formatBRL(x.countedTotal)}</td><td style="color:var(--red);font-weight:700">${formatBRL(x.difference)}</td><td><span class="badge bad">${x.difference>0?'Sobra':'Falta'}</span></td></tr>`).join(''):'<tr><td colspan="6" class="empty">Nenhuma divergência encontrada.</td></tr>';}
$('#refreshDash').onclick=loadDashboard;$('#dashDate').onchange=loadDashboard;$('#dashStore').onchange=loadDashboard;

async function loadHistory(){try{const from=$('#historyFrom').value||isoToday(),to=$('#historyTo').value||isoToday(),store=$('#historyStore').value||'all';let rows=(await fetchClosings(from,to)).filter(x=>store==='all'||x.store===store).sort((a,b)=>b.date.localeCompare(a.date));$('#historyRows').innerHTML=rows.length?rows.map(x=>`<tr><td>${x.date.split('-').reverse().join('/')}</td><td>${x.store}</td><td>${x.operator}</td><td>${formatBRL(x.systemTotal)}</td><td>${formatBRL(x.countedTotal)}</td><td>${formatBRL(x.difference)}</td><td><span class="badge ${x.status==='draft'?'draft':Math.abs(x.difference)<.01?'ok':'bad'}">${x.status==='draft'?'Rascunho':Math.abs(x.difference)<.01?'Conciliado':'Divergente'}</span></td></tr>`).join(''):'<tr><td colspan="7" class="empty">Nenhum fechamento no período.</td></tr>';}catch(e){toast('Erro ao buscar o histórico.',true)}}
$('#loadHistory').onclick=loadHistory;

$('#userForm').addEventListener('submit',async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));let secondary;try{secondary=initializeApp(firebaseConfig,`create-${Date.now()}`);const credential=await createUserWithEmailAndPassword(getAuth(secondary),data.email,data.password);await set(ref(db,`users/${credential.user.uid}`),{name:data.name,email:data.email.toLowerCase(),role:data.role,store:data.store,stores:[data.store],active:true,createdAt:Date.now(),createdBy:auth.currentUser.uid});e.target.reset();fillStores();toast('Usuário criado com sucesso.');loadUsers();}catch(err){toast(err.code==='auth/email-already-in-use'?'Este e-mail já está cadastrado.':'Não foi possível criar o usuário.',true)}finally{if(secondary)deleteApp(secondary)}});
async function loadUsers(){const snap=await get(ref(db,'users'));const users=snap.exists()?Object.entries(snap.val()):[];$('#usersList').innerHTML=users.map(([uid,u])=>`<div class="user-row"><div><b>${u.name}</b><div class="muted">${u.email} · ${u.role} · ${(u.stores||[u.store]).filter(Boolean).join(', ')}</div></div><span class="badge ${u.active===false?'bad':'ok'}">${u.active===false?'Inativo':'Ativo'}</span></div>`).join('');}

updateCalculation();
