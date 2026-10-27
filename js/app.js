(() => {
const LS = "pomodoro-panel-v1", LT = "pomodoro-timer-v1";
const DEF = {settings:{focus:25,short:5,long:15,longEvery:4,goal:8,autoBreaks:false,autoFocus:false,sound:true,ambKind:"rain",ambVol:.5,ambSync:false,jtags:[]},
  tasks:[],notes:[],log:[],tlog:{},activeTaskId:null,updatedAt:0};
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
const esc = s => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const dayKey = t => {const d=new Date(t);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const hhmm = t => new Date(t).toLocaleTimeString("es",{hour:"2-digit",minute:"2-digit"});
const lsGet = k => {try{return JSON.parse(localStorage.getItem(k))}catch{return null}};
const lsSet = (k,v) => {try{localStorage.setItem(k,JSON.stringify(v))}catch{}};

let S = normalize(lsGet(LS));
function normalize(x){
  x = x && typeof x==="object" ? x : {};
  return {settings:{...DEF.settings,...(x.settings||{})},tasks:Array.isArray(x.tasks)?x.tasks.map(t=>t.status?t:{...t,status:t.completed?"done":"todo"}):[],notes:Array.isArray(x.notes)?x.notes:[],
    log:Array.isArray(x.log)?x.log:[],tlog:x.tlog&&typeof x.tlog==="object"&&!Array.isArray(x.tlog)?x.tlog:{},music:Array.isArray(x.music)?x.music:[],activeTaskId:x.activeTaskId??null,updatedAt:x.updatedAt||0};
}

// ---------- persistence (browser + private db doc) ----------
let docRef=null, saving=false, dirty=false, saveTimer=null;
function commit(){
  S.updatedAt = Date.now();
  const cutoff = Date.now()-60*864e5; S.log = S.log.filter(e=>e.t>cutoff);
  { const old=dayKey(Date.now()-120*864e5); Object.keys(S.tlog).forEach(k=>{ if(k<old) delete S.tlog[k]; }); }
  lsSet(LS,S); render(); schedule();
}
function schedule(){ if(!docRef) return; dirty=true; clearTimeout(saveTimer); saveTimer=setTimeout(flush,900); }
async function flush(){
  if(!docRef||saving||!dirty) return;
  saving=true; dirty=false; setSync("Guardando…");
  try{ await docRef.set(JSON.parse(JSON.stringify(S))); setSync("Guardado en tu cuenta"); }
  catch(e){ setSync(e&&e.code==="quota_exceeded"?"Sin espacio para guardar":"Guardado solo en este navegador"); if(e&&e.code==="unavailable") dirty=true; }
  saving=false; if(dirty) saveTimer=setTimeout(flush,1500);
}
function setSync(t){ $("#sync").textContent=t; }

// ---------- timer ----------
let T = lsGet(LT) || {mode:"focus",running:false,endAt:0,remaining:null,count:0};
const durMs = m => S.settings[m==="focus"?"focus":m==="short"?"short":"long"]*60000;
if(T.remaining==null) T.remaining=durMs(T.mode);
function saveT(){ lsSet(LT,T); }
T.track=T.track||null; T.pomoTasks=T.pomoTasks||{};
function left(){ return T.running? Math.max(0,T.endAt-Date.now()) : T.remaining; }
// Per-task time: only one task advances, and only while a focus pomodoro is running.
const taskById = id => S.tasks.find(x=>x.id===id);
function accrue(){
  if(!T.track||!T.track.since) return;
  const now=T.running?Math.min(Date.now(),T.endAt):Date.now(), d=Math.max(0,now-T.track.since);
  const t=taskById(T.track.id); if(t) t.spent=(t.spent||0)+d;
  if(d>0){ const k=dayKey(now), L=S.tlog[k]||(S.tlog[k]={}); L[T.track.id]=(L[T.track.id]||0)+d; } // time per day, for the weekly summary
  T.pomoTasks[T.track.id]=(T.pomoTasks[T.track.id]||0)+d;
  T.track.since=(T.running&&T.mode==="focus")?now:null;
}
function liveSpent(t){ let v=t.spent||0; if(T.track&&T.track.id===t.id&&T.track.since) v+=Math.max(0,(T.running?Math.min(Date.now(),T.endAt):Date.now())-T.track.since); return v; }
function stopTrack(){ if(!T.track) return; accrue(); T.track=null; saveT(); }
function startTrack(id){
  ensureAudio(); accrue();
  if(T.mode!=="focus"){ T.track=null; setMode("focus",false); }
  { const pv=T.track&&T.track.id!==id&&taskById(T.track.id); if(pv&&pv.status==="doing"&&!pv.completed) pv.status="paused"; }
  T.track={id,since:null}; S.activeTaskId=id;
  { const tk=taskById(id); if(tk&&(!tk.status||tk.status==="inbox"||tk.status==="backlog"||tk.status==="todo"||tk.status==="paused")) tk.status="doing"; }
  if(T.running) T.track.since=Date.now(); else start();
  saveT(); commit();
}
function start(){ ensureAudio(); if(T.running) return; T.running=true; T.endAt=Date.now()+T.remaining; T.startedAt=T.startedAt||Date.now(); if(T.track&&T.mode==="focus") T.track.since=Date.now(); saveT(); tick(); }
function pause(){ if(!T.running) return; const had=!!T.track; stopTrack(); T.remaining=left(); T.running=false; saveT(); if(had) commit(); else tick(); }
function setMode(m,auto){ const had=!!T.track; stopTrack(); T.mode=m; T.running=false; T.remaining=durMs(m); T.startedAt=null; T.pomoTasks={}; saveT(); if(auto) start(); if(had) commit(); else tick(); }
function reset(){ const had=!!T.track; stopTrack(); T.running=false; T.remaining=durMs(T.mode); T.startedAt=null; T.pomoTasks={}; saveT(); if(had) commit(); else tick(); }
function finish(skipped){
  const m=T.mode, ms=durMs(m)-(skipped?left():0);
  stopTrack(); T.running=false; T.remaining=0;
  const worked=Object.entries(T.pomoTasks).filter(([,v])=>v>=30000).sort((a,b)=>b[1]-a[1]);
  if(!skipped || ms>=60000){
    S.log.push({t:Date.now(),k:m,min:Math.round(ms/60000),task:m==="focus"?(worked[0]?.[0]??S.activeTaskId):null,
      tasks:m==="focus"?worked.map(([id,v])=>({id,min:Math.max(1,Math.round(v/60000))})):undefined,partial:!!skipped});
    if(m==="focus"&&!skipped){ const t=taskById(worked[0]?.[0]??S.activeTaskId); if(t) t.pomos=(t.pomos||0)+1; }
  }
  commit();
  if(!skipped){ chime(m); toast(m==="focus"?"Pomodoro completado. Toca una pausa.":"Pausa terminada. A enfocarse."); }
  if(m==="focus"){ T.count=(T.count||0)+1; const longNext=T.count%S.settings.longEvery===0; setMode(longNext?"long":"short",S.settings.autoBreaks); }
  else { if(m==="long") T.count=0; setMode("focus",S.settings.autoFocus); }
}
const C=2*Math.PI*88; $("#prg").style.strokeDasharray=C;
(()=>{let g="";for(let i=0;i<60;i++){const a=i/60*2*Math.PI,r1=i%5?97:94;g+=`<line x1="${100+r1*Math.cos(a)}" y1="${100+r1*Math.sin(a)}" x2="${100+99.5*Math.cos(a)}" y2="${100+99.5*Math.sin(a)}" stroke-width="${i%5?.6:1.2}"/>`}$("#ticks").innerHTML=g})();
function tick(){
  const ms=left(); if(T.running&&ms<=0){ finish(false); return; }
  const s=Math.ceil(ms/1000), txt=String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");
  $("#time").textContent=txt;
  const frac=1-ms/durMs(T.mode); $("#prg").style.strokeDashoffset=C*(1-Math.min(1,Math.max(0,frac)));
  document.body.dataset.mode=T.mode; document.body.classList.toggle("focusing",!!(T.running&&T.mode==="focus"&&S.settings.focusMode!==false));
  document.querySelectorAll(".modes button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.mode===T.mode));
  $("#toggle").textContent=T.running?"Pausar":(ms<durMs(T.mode)?"Continuar":"Iniciar");
  const every=S.settings.longEvery, n=(T.count||0)%every;
  const ft=(T.track&&taskById(T.track.id))||(S.activeTaskId&&taskById(S.activeTaskId));
  const s1=T.mode==="focus"?(ft&&!ft.completed?ft.title:"Sin tarea seleccionada"):T.mode==="short"?"Pausa corta":"Pausa larga";
  const nx=T.mode==="focus"&&ft&&!ft.completed?(ft.todos||[]).find(x=>!x.done):null;
  const subKey=s1+"\u0000"+(nx?nx.text:"");
  if($("#sub").dataset.k!==subKey){ $("#sub").dataset.k=subKey; $("#sub").innerHTML=`<span class="s1">${esc(s1)}</span>`+(nx?`<span class="s2">${esc(nx.text)}</span>`:"");
    $("#sub").title=s1+(nx?"\nSiguiente: "+nx.text:"")+(T.mode==="focus"&&ft&&!ft.completed?"\nClic para abrir la tarea":""); }
  const pj=T.mode==="focus"&&ft&&!ft.completed&&ft.tag?ft.tag:""; if($("#proj").textContent!==pj){ $("#proj").textContent=pj; $("#proj").title=pj?"Proyecto: "+pj:""; } $("#proj").hidden=!pj;
  const lk=T.mode==="focus"&&!!ft&&!ft.completed; $("#sub").classList.toggle("link",lk); $("#sub").dataset.tid=lk?ft.id:"";
  if(lk){ $("#sub").setAttribute("role","button"); $("#sub").tabIndex=0; } else { $("#sub").removeAttribute("role"); $("#sub").removeAttribute("tabindex"); }
  $("#cyc").innerHTML=Array.from({length:every},(_,i)=>`<i class="${i<n?"on":""}"></i>`).join("");
  const label={focus:"Enfoque",short:"Pausa",long:"Pausa larga"}[T.mode];
  BASE_TITLE=(T.running||ms<durMs(T.mode))?`${txt} · ${label}`:"Tareas"; if(!alBlinkT) document.title=BASE_TITLE;
  updateFloat(txt,label,frac);
  if(typeof syncAmbient==="function") syncAmbient();
  if(T.track){ const t=taskById(T.track.id); if(t){ const v=clock(liveSpent(t)); document.querySelectorAll(`[data-spent="${t.id}"]`).forEach(el=>el.textContent=v); } }
}
const clock = ms => { const s=Math.floor(ms/1000), h=Math.floor(s/3600), m=Math.floor(s/60)%60, ss=s%60;
  return (h?h+":"+String(m).padStart(2,"0"):String(m).padStart(2,"0"))+":"+String(ss).padStart(2,"0"); };
setInterval(()=>{ if(T.running) tick(); },250);
// while a task advances, save its time once a minute
setInterval(()=>{ if(T.track&&T.track.since){ accrue(); saveT(); commit(); } },60000);
document.addEventListener("visibilitychange",tick);

// sound
let AC=null;
function ensureAudio(){ try{ AC=AC||new (window.AudioContext||window.webkitAudioContext)(); if(AC.state==="suspended") AC.resume(); }catch{} }
function chime(m){
  if(!S.settings.sound||!AC) return;
  const notes=m==="focus"?[660,880,990]:[880,660,523];
  notes.forEach((f,i)=>{const o=AC.createOscillator(),g=AC.createGain(),t=AC.currentTime+i*.22;
    o.type="sine";o.frequency.value=f;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.25,t+.02);g.gain.exponentialRampToValueAtTime(.001,t+.6);
    o.connect(g).connect(AC.destination);o.start(t);o.stop(t+.65);});
}

// ---------- tasks ----------
const fold=x=>String(x||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
let tq="";
function hl(txt){ const e=esc(txt); if(!tq.trim()) return e; const ws=fold(tq.trim()).split(/\s+/).filter(Boolean); const f=fold(txt); const mk=new Array(txt.length).fill(false);
  if(f.length!==txt.length) return e; ws.forEach(w=>{ let i=0; while((i=f.indexOf(w,i))>=0){ for(let k=i;k<i+w.length;k++) mk[k]=true; i+=w.length; } });
  let out="",on=false; for(let i=0;i<txt.length;i++){ if(mk[i]!==on){ out+=mk[i]?'<mark class="hl">':'</mark>'; on=mk[i]; } out+=esc(txt[i]); } return out+(on?"</mark>":""); }
let filter=(lsGet("pp-filter")||"open"), tagF=lsGet("pp-tag")||null, tagKey="", sortBy=(lsGet("pp-sort")||"manual"), editing=null, todoAdd=null, qnote=null, qnoteNew=null, linkAdd=null, alertAdd=null;
// attached links: only http(s); a bare address gets https://
const normUrl=v=>{ v=String(v||"").trim(); if(!v) return ""; if(!/^[a-z][a-z0-9+.-]*:/i.test(v)) v="https://"+v; try{ const u=new URL(v); return /^https?:$/.test(u.protocol)?u.href:""; }catch{ return ""; } };
const linkName=(url,name)=>{ if(name) return name; try{ const u=new URL(url), last=decodeURIComponent(u.pathname.split("/").filter(Boolean).pop()||""); return last&&last.length<60?last:u.hostname.replace(/^www\./,""); }catch{ return url; } };
const IC_P={"bell": "<path d=\"M4 11.4V7.6a4 4 0 0 1 8 0v3.8l1.3 1.3H2.7zM6.5 14a1.6 1.6 0 0 0 3 0\"/>", "link": "<path d=\"M6.7 9.3a2.6 2.6 0 0 0 3.7 0l2.3-2.3a2.6 2.6 0 0 0-3.7-3.7l-.9.9M9.3 6.7a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.9-.9\"/>", "table": "<rect x=\"2\" y=\"2.8\" width=\"12\" height=\"10.4\" rx=\"1.4\"/><path d=\"M2 6.3h12M2 9.8h12M6.2 2.8v10.4M10.2 2.8v10.4\"/>", "pause": "<path d=\"M5.4 3.4v9.2M10.6 3.4v9.2\"/>", "sun": "<circle cx=\"8\" cy=\"8\" r=\"2.9\"/><path d=\"M8 1.6v1.5M8 12.9v1.5M1.6 8h1.5M12.9 8h1.5M3.5 3.5l1 1M11.5 11.5l1 1M3.5 12.5l1-1M11.5 4.5l1-1\"/>", "moon": "<path d=\"M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z\"/>", "monitor": "<rect x=\"1.8\" y=\"2.6\" width=\"12.4\" height=\"8.6\" rx=\"1.3\"/><path d=\"M5.6 14h4.8M8 11.2V14\"/>", "cols": "<rect x=\"1.8\" y=\"2.6\" width=\"12.4\" height=\"10.8\" rx=\"1.3\"/><path d=\"M6.4 2.6v10.8\"/>", "rows": "<rect x=\"1.8\" y=\"2.6\" width=\"12.4\" height=\"10.8\" rx=\"1.3\"/><path d=\"M1.8 7.4h12.4\"/>", "timer": "<circle cx=\"8\" cy=\"9\" r=\"5.2\"/><path d=\"M8 9V6.4M6.3 1.8h3.4M12.1 4.7l1-1\"/>", "image": "<rect x=\"2\" y=\"3\" width=\"12\" height=\"10\" rx=\"1.6\"/><circle cx=\"5.7\" cy=\"6.4\" r=\"1.1\"/><path d=\"M2.4 11.6l3.6-3.3 2.6 2.3 2-1.7 3 2.6\"/>", "trash": "<path d=\"M2.8 4.4h10.4M6.4 4.4V2.8h3.2v1.6M4.3 4.4l.6 8.8h6.2l.6-8.8M6.9 7v4.2M9.1 7v4.2\"/>", "x": "<path d=\"M4 4l8 8M12 4l-8 8\"/>", "star": "<path d=\"M8 1.9l1.85 3.85 4.2.55-3.07 2.92.78 4.17L8 11.35 4.24 13.4l.78-4.17L1.95 6.3l4.2-.55z\"/>", "check": "<path d=\"M3 8.6l3.1 3L13 4.6\"/>", "zap": "<path d=\"M9 1.6L3.6 9H8l-1 5.4L12.4 7H8z\"/>", "cal": "<rect x=\"2\" y=\"3\" width=\"12\" height=\"11\" rx=\"1.6\"/><path d=\"M2 6.6h12M5.4 1.6v2.8M10.6 1.6v2.8\"/>", "hl": "<path d=\"M10 2.2l3.8 3.8-6.3 6.3H3.7V8.5z\"/><path d=\"M2.2 14.3h6\"/>", "go": "<path d=\"M5 11l6-6M6.2 5H11v4.8\"/>", "rep": "<path d=\"M2.6 7.2V6.4A2.2 2.2 0 0 1 4.8 4.2h8.2M11 2.2l2 2-2 2M13.4 8.8v.8a2.2 2.2 0 0 1-2.2 2.2H3M5 13.8l-2-2 2-2\"/>", "book": "<path d=\"M3 3.2A1.6 1.6 0 0 1 4.6 1.6H13v10.6H4.6A1.6 1.6 0 0 0 3 13.8z\"/><path d=\"M3 13.8a1.6 1.6 0 0 0 1.6 1.6H13v-3.2\"/>", "plus": "<path d=\"M8 3v10M3 8h10\"/>", "edit": "<path d=\"M10.4 2.6l3 3L6 13H3v-3z\"/>", "up": "<path d=\"M8 13V3.4M4 7l4-4 4 4\"/>", "side": "<rect x=\"2\" y=\"2.6\" width=\"12\" height=\"10.8\" rx=\"1.6\"/><path d=\"M9.6 2.6v10.8\"/>", "board": "<rect x=\"2\" y=\"2.6\" width=\"12\" height=\"10.8\" rx=\"1.6\"/><path d=\"M6 2.6v10.8M10 2.6v10.8\"/>", "gear": "<circle cx=\"8\" cy=\"8\" r=\"2.2\"/><path d=\"M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M3.5 12.5l1.3-1.3M11.2 4.8l1.3-1.3\"/>", "down": "<path d=\"M8 2.4v8M4.6 7.2L8 10.6l3.4-3.4M3 13.6h10\"/>", "upl": "<path d=\"M8 10.6v-8M4.6 5.8L8 2.4l3.4 3.4M3 13.6h10\"/>", "play": "<path d=\"M5 3.4v9.2L12.2 8z\"/>", "circle": "<circle cx=\"8\" cy=\"8\" r=\"5\"/>", "sum": "<path d=\"M12 3H4.2L8.6 8l-4.4 5H12\"/>", "alert": "<circle cx=\"8\" cy=\"8\" r=\"6\"/><path d=\"M8 4.8v3.6M8 11h.01\"/>", "head": "<path d=\"M2.6 10.4V8a5.4 5.4 0 0 1 10.8 0v2.4\"/><rect x=\"2.4\" y=\"9.4\" width=\"2.8\" height=\"4.2\" rx=\"1\"/><rect x=\"10.8\" y=\"9.4\" width=\"2.8\" height=\"4.2\" rx=\"1\"/>", "tv": "<rect x=\"2\" y=\"3.2\" width=\"12\" height=\"8.6\" rx=\"1.6\"/><path d=\"M5.8 14.2h4.4\"/>", "arr": "<path d=\"M3 8h9.6M9 4.4L12.6 8 9 11.6\"/>"};
const ic=(n,c)=>`<svg class="ic${c?" "+c:""}" viewBox="0 0 16 16" aria-hidden="true">${IC_P[n]}</svg>`;
const ICON_LIST='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4h8M6 8h8M6 12h8"/><circle cx="2.6" cy="4" r=".9" fill="currentColor" stroke="none"/><circle cx="2.6" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="2.6" cy="12" r=".9" fill="currentColor" stroke="none"/></svg>';
const ICON_UNDO='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 6.2A5.2 5.2 0 1 1 3 9.5"/><path d="M3 2.6v3.8h3.8"/></svg>';
const ICON_NOTE='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h7l3 3v9H3z"/><path d="M10 2v3h3M5.5 8h5M5.5 11h3.5"/></svg>';
const ICON_PLAY='<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z"/></svg>';
const ICON_STOP='<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1.2"/></svg>';
// Criticality as a signal meter: 5 bars; Baja lights 2, Media 3, Alta all 5.
function sig(c){ const lit={baja:2,media:3,alta:5}[c]||3, lbl={alta:"Alta",media:"Media",baja:"Baja"}[c]||"Media";
  return `<span class="sig ${c}" title="Criticidad ${lbl.toLowerCase()}" role="img" aria-label="Criticidad ${lbl.toLowerCase()}"><svg viewBox="0 0 22 16">${[0,1,2,3,4].map(i=>`<rect class="${i<lit?"on":""}" x="${i*4.5}" y="${12-i*3}" width="3" height="${4+i*3}" rx=".8"/>`).join("")}</svg></span>`; }
// Task status: done and cancelled close the task; the rest keep it open.
const STATUS=[["inbox","Sin asignar"],["backlog","Backlog"],["todo","Por hacer"],["doing","En curso"],["paused","En pausa"],["review","En revisión"],["done","Hecha"],["cancelled","Cancelada"]];
const STL=Object.fromEntries(STATUS), STO=Object.fromEntries(STATUS.map(([k],i)=>[k,i]));
const ST_ICON={
  inbox:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 9.5l1.6-5.2c.15-.5.6-.8 1.1-.8h5.6c.5 0 .95.3 1.1.8l1.6 5.2v3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2.6 9.5h3l.9 1.6h3l.9-1.6h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  backlog:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.2 2"/></svg>',
  todo:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  doing:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4a4 4 0 0 1 0 8z" fill="currentColor"/></svg>',
  paused:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="5.6" y="5" width="1.7" height="6" rx=".5" fill="currentColor"/><rect x="8.7" y="5" width="1.7" height="6" rx=".5" fill="currentColor"/></svg>',
  review:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4a4 4 0 1 1-4 4h4z" fill="currentColor"/></svg>',
  done:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5 8.2l2 2 4-4.2" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cancelled:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/></svg>'};
function statusOpts(cur){ return STATUS.map(([k,l])=>`<option value="${k}" ${k===cur?"selected":""}>${l}</option>`).join(""); }
let kbView=lsGet("pp-kbview")==="today"?"today":"all";
function renderKanban(){
  const dlg=$("#kanban"); if(!dlg.open) return;
  document.querySelectorAll("[data-kbv]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.kbv===kbView)));
  { const n=S.tasks.filter(t=>t.star).length; $("#kbStarCnt").textContent=n?String(n):"";
    $(".kbhint").textContent=kbView!=="today"?"Arrastra una tarjeta a otra columna para cambiar su estado.":n?"Solo las tareas con ★ para hoy. Arrastra una tarjeta para cambiar su estado.":"Aún no marcas tareas para hoy. Toca la ☆ junto a una tarea en la lista para agregarla."; }
  const CR={alta:0,media:1,baja:2}, ord=t=>t.order??t.createdAt;
  $("#kbCols").innerHTML=STATUS.map(([k,l])=>{
    const list=S.tasks.filter(t=>(t.status||"todo")===k&&(kbView!=="today"||t.star)).sort((a,b)=>(CR[a.crit||"media"]-CR[b.crit||"media"])||ord(a)-ord(b));
    return `<section class="kbcol st-${k}" data-col="${k}" aria-label="${l}"><h3>${ST_ICON[k]}${l}<span class="n">${list.length}</span></h3>
      ${list.length?list.map(t=>{ const du=dueInfo(t.due), trk=T.track&&T.track.id===t.id;
        return `<article class="kbcard ${trk?"tracking":""}" draggable="true" data-id="${t.id}"><div class="kt">${t.star?`<span class="ks" title="Hoy">${ic("star","fill")}</span>`:""}${esc(t.title)}</div>
          <div class="meta">${sig(t.crit||"media")}${t.tag?`<span class="tag">${esc(t.tag)}</span>`:""}${du&&!t.completed?`<span class="due ${du.cls}">${du.txt}</span>`:""}<span class="spent">${clock(liveSpent(t))}</span></div>
          <select class="kmove" data-kmove aria-label="Mover a">${statusOpts(k)}</select></article>`; }).join(""):`<div class="kbempty">Sin tareas</div>`}
    </section>`; }).join("");
}
function kbMove(id,st){ const t=taskById(id); if(!t||(t.status||"todo")===st) return; setStatus(t,st); commit(); renderKanban(); toast(`${t.title}: ${STL[st]}`); }
$("#kanbanBtn").addEventListener("click",e=>{ e.stopPropagation(); $("#kanban").showModal(); renderKanban(); });
$("#kbClose").addEventListener("click",()=>$("#kanban").close());
document.querySelectorAll("[data-kbv]").forEach(b=>b.addEventListener("click",()=>{ kbView=b.dataset.kbv; lsSet("pp-kbview",kbView); renderKanban(); }));
$("#kanban").addEventListener("click",e=>{ if(e.target===e.currentTarget) e.currentTarget.close(); });
$("#kbCols").addEventListener("change",e=>{ if(e.target.matches("[data-kmove]")) kbMove(e.target.closest(".kbcard").dataset.id,e.target.value); });
$("#kbCols").addEventListener("dragstart",e=>{ const c=e.target.closest(".kbcard"); if(!c) return; e.dataTransfer.setData("text/plain",c.dataset.id); e.dataTransfer.effectAllowed="move"; c.classList.add("dragging"); });
$("#kbCols").addEventListener("dragend",e=>{ e.target.closest?.(".kbcard")?.classList.remove("dragging"); document.querySelectorAll(".kbcol.over").forEach(c=>c.classList.remove("over")); });
$("#kbCols").addEventListener("dragover",e=>{ const col=e.target.closest(".kbcol"); if(!col) return; e.preventDefault(); e.dataTransfer.dropEffect="move";
  document.querySelectorAll(".kbcol.over").forEach(c=>{ if(c!==col) c.classList.remove("over"); }); col.classList.add("over"); });
$("#kbCols").addEventListener("dragleave",e=>{ const col=e.target.closest(".kbcol"); if(col&&!col.contains(e.relatedTarget)) col.classList.remove("over"); });
$("#kbCols").addEventListener("drop",e=>{ const col=e.target.closest(".kbcol"); if(!col) return; e.preventDefault(); col.classList.remove("over"); kbMove(e.dataTransfer.getData("text/plain"),col.dataset.col); });
function setStatus(t,st){
  t.status=st; const closed=st==="done"||st==="cancelled";
  if(closed&&!t.completed){ if(T.track&&T.track.id===t.id) stopTrack(); t.completed=true; t.completedAt=Date.now();
    if(st==="done"&&t.rec&&REC[t.rec]&&!t.recNext) recSpawn(t);
    if(S.activeTaskId===t.id){ const nx=S.tasks.find(x=>!x.completed); S.activeTaskId=nx?nx.id:null; } }
  else if(!closed&&t.completed){ t.completed=false; t.completedAt=null; }
}
// recurring tasks: closing one as Hecha creates the next occurrence
const REC={"":"No se repite",day:"Cada día",weekday:"Lunes a viernes",week:"Cada semana",month:"Cada mes"};
function recNextDue(rec,base){
  const today=dayKey(Date.now()), [y,m,d]=(base||today).split("-").map(Number); let dt=new Date(y,m-1,d);
  const step=()=>{ if(rec==="week") dt.setDate(dt.getDate()+7); else if(rec==="month"){ const dd=dt.getDate(); dt.setDate(1); dt.setMonth(dt.getMonth()+1); dt.setDate(Math.min(dd,new Date(dt.getFullYear(),dt.getMonth()+1,0).getDate())); }
    else { dt.setDate(dt.getDate()+1); if(rec==="weekday") while(dt.getDay()===0||dt.getDay()===6) dt.setDate(dt.getDate()+1); } };
  step(); let g=0; while(dayKey(dt)<=today&&g++<400) step();
  return dayKey(dt);
}
function recSpawn(t){
  const n={id:uid(),title:t.title,tag:t.tag||"",status:"todo",crit:t.crit||"media",due:recNextDue(t.rec,t.due),rec:t.rec,est:1,pomos:0,spent:0,completed:false,
    createdAt:Date.now(),order:t.order??t.createdAt,todos:(t.todos||[]).map(x=>({...x,id:uid(),done:false})),todoMin:t.todoMin};
  if(t.alert&&t.due){ const [y,m,d]=t.due.split("-").map(Number), [y2,m2,d2]=n.due.split("-").map(Number), a=new Date(t.alert);
    a.setDate(a.getDate()+Math.round((new Date(y2,m2-1,d2)-new Date(y,m-1,d))/864e5)); n.alert=a.getTime(); }
  S.tasks.push(n); t.recNext=n.id;
  setTimeout(()=>toast(`Se creó la próxima: ${dueInfo(n.due).txt.toLowerCase()}`),40);
}
const isLate=t=>!t.completed&&!!t.due&&t.due<=dayKey(Date.now()); // overdue or due today
function dueInfo(d){
  if(!d) return null; const [y,m,dd]=d.split("-").map(Number); const due=new Date(y,m-1,dd), t0=new Date(); t0.setHours(0,0,0,0);
  const diff=Math.round((due-t0)/864e5), f=due.toLocaleDateString("es",{day:"numeric",month:"short"});
  if(diff<0) return {cls:"over",txt:`Vencida ${f}`}; if(diff===0) return {cls:"soon",txt:"Vence hoy"}; if(diff===1) return {cls:"soon",txt:"Vence mañana"};
  return {cls:"",txt:`Vence ${f}`};
}
var applyBg=()=>{}, dragTodo=null;
var jReady=false; // set once the bitácora code below has run
function render(){ applyLook();
  const st=S.settings;
  renderKanban(); if(jReady){ jClosedRender(); jMarkTasks(); calRender(); }
  // tags
  const tags=[...new Set(S.tasks.map(t=>t.tag).filter(Boolean))].sort();
  $("#tags").innerHTML=tags.map(t=>`<option value="${esc(t)}">`).join("");
  if(tagF && !tags.includes(tagF)) { tagF=null; lsSet("pp-tag",null); }
  { const k=tags.join("\u0001"), sel=$("#tagSel"); // rebuild only when the project list changes, so an open dropdown is not reset
    if(k!==tagKey){ tagKey=k; sel.innerHTML=`<option value="">Todos los proyectos</option>`+tags.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join(""); }
    sel.value=tagF||""; sel.classList.toggle("on",!!tagF); sel.hidden=!tags.length; }
  document.querySelectorAll("[data-f]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.f===filter));
  { const sc=S.tasks.filter(t=>t.star&&!t.completed).length; $("#starCnt").textContent=sc?String(sc):""; }
  { const ic=S.tasks.filter(t=>t.status==="inbox"&&!t.completed).length; $("#inboxCnt").textContent=ic?String(ic):"";
    const HID={inbox:"Sin asignar",doing:"En curso",paused:"En pausa",backlog:"Backlog",done:"Cerradas",all:"Todas"};
    $("#fMoreLbl").textContent=HID[filter]||"Más"; $("#fMore").setAttribute("aria-pressed",String(!!HID[filter]));
    $("#fMoreCnt").textContent=ic&&filter!=="inbox"?String(ic):""; $("#fMore").title=ic&&filter!=="inbox"?`Más filtros · ${ic} sin asignar`:"Más filtros"; }
  { const lc=S.tasks.filter(isLate).length; $("#lateCnt").textContent=lc?String(lc):""; $("#lateChip").hidden=!lc&&filter!=="late"; }
  let list=S.tasks.filter(t=>filter==="all"||(filter==="late"?isLate(t):filter==="done"?t.completed:filter==="star"?!t.completed&&t.star:filter==="doing"?!t.completed&&t.status==="doing":filter==="paused"?!t.completed&&t.status==="paused":filter==="backlog"?!t.completed&&t.status==="backlog":filter==="inbox"?!t.completed&&t.status==="inbox":!t.completed&&(t.status==="todo"||t.status==="review"||!t.status)));
  if(tagF) list=list.filter(t=>t.tag===tagF);
  const qn=fold(tq.trim()), qw=qn?qn.split(/\s+/):[];
  if(qw.length){ const nt={}; S.notes.forEach(n=>{ if(n.task) nt[n.task]=(nt[n.task]||"")+" "+n.text; });
    list=list.filter(t=>{ const h=fold([t.title,t.tag,(t.todos||[]).map(x=>x.text).join(" "),(t.links||[]).map(x=>x.name).join(" "),nt[t.id]||""].join(" ")); return qw.every(w=>h.includes(w)); }); }
  const ord=t=>t.order??t.createdAt, CR={alta:0,media:1,baja:2};
  const cmp={manual:(a,b)=>ord(a)-ord(b),
    crit:(a,b)=>(CR[a.crit||"media"]-CR[b.crit||"media"])||((a.due||"9999")<(b.due||"9999")?-1:(a.due||"9999")>(b.due||"9999")?1:0)||ord(a)-ord(b),
    status:(a,b)=>(STO[a.status||"todo"]-STO[b.status||"todo"])||(CR[a.crit||"media"]-CR[b.crit||"media"])||ord(a)-ord(b),
    due:(a,b)=>((a.due||"9999")<(b.due||"9999")?-1:(a.due||"9999")>(b.due||"9999")?1:0)||(CR[a.crit||"media"]-CR[b.crit||"media"])||ord(a)-ord(b)}[sortBy]||((a,b)=>ord(a)-ord(b));
  list.sort((a,b)=>(a.completed-b.completed)||cmp(a,b));
  $("#sort").value=sortBy;
  const ae=document.activeElement, editingNow=ae&&ae.closest&&ae.closest(".edit,.todos,.qnote,.tladd,.taladd")&&ae.matches("input[type=text],input[type=date],input[type=datetime-local],input[type=number],select,textarea");
  if(!editingNow&&!dragTodo) $("#tasks").innerHTML=list.length?list.map(t=>{
    const p=t.pomos||0, over=p>t.est, crit=t.crit||"media", trk=T.track&&T.track.id===t.id;
    const nN=S.notes.filter(n=>n.task===t.id&&!n.done).length, du=dueInfo(t.due), todos=t.todos||[], tdDone=todos.filter(x=>x.done).length;
    return `<li class="task ${t.completed?(t.status==="cancelled"?"cancelled":"done"):""} ${trk?"tracking":""} ${!trk&&t.id===S.activeTaskId?"active":""}" data-id="${t.id}">
      ${t.completed?"<span style=\"width:28px\"></span>":`<button class="btn track ${trk?"on":""}" type="button" data-act="track" aria-label="${trk?"Detener":"Iniciar"}" title="${trk?"Detener":"Iniciar"}">${trk?ICON_STOP:ICON_PLAY}</button>`}
      <div style="min-width:0"><div class="trow"><button class="star ${t.star?"on":""}" type="button" data-act="star" aria-pressed="${!!t.star}" aria-label="${t.star?"Quitar de Hoy":"Marcar para hoy"}" title="${t.star?"Quitar de Hoy":"Marcar para hoy"}">${ic("star",t.star?"fill":"")}</button><div class="t" data-act="edit" title="Editar tarea">${hl(t.title)}</div></div>
        <div class="meta"><label class="st st-${t.status||"todo"}" title="Estado">${ST_ICON[t.status||"todo"]}<select data-status aria-label="Estado">${statusOpts(t.status||"todo")}</select></label>${sig(crit)}${t.tag?`<span class="tag">${esc(t.tag)}</span>`:""}${du&&!t.completed?`<span class="due ${du.cls}">${du.txt}</span>`:""}${t.alert&&!t.completed?alChip(t):""}${t.rec?`<span class="rec" title="Se repite: ${REC[t.rec]}. Al cerrarla se crea la siguiente.">${ic("rep")} ${REC[t.rec]}</span>`:""}${t.jday?`<button class="nlink" type="button" data-act="jday" title="Ver la línea de la bitácora donde nació esta tarea">Bitácora ${esc(jLabel(t.jday))}</button>`:""}${liveSpent(t)>0||trk?`<span class="spent" data-spent="${t.id}" title="Tiempo invertido en la tarea">${clock(liveSpent(t))}</span>`:""}${nN?`<button class="nlink" type="button" data-act="qnote" title="Ver notas de la tarea">${nN} nota${nN>1?"s":""}</button>`:""}${todos.length?(t.completed?`<span class="ico has-todo" title="${todos.length} to-do (${tdDone} hecho${tdDone!==1?"s":""})" aria-label="Tiene to-do">${ICON_LIST}</span>`
  :`<button class="ico has-todo tdtog" type="button" data-act="todo-toggle" aria-expanded="${!t.todoMin}" title="${t.todoMin?"Mostrar":"Ocultar"} la lista to-do · ${tdDone} de ${todos.length} hechos">${ICON_LIST} ${tdDone}/${todos.length}<span class="car" aria-hidden="true">${t.todoMin?"▸":"▾"}</span></button>`):""}</div>
      <div class="acts">
        ${t.completed?"":`<button class="icon ico" type="button" data-act="todo" aria-label="Agregar to-do" title="Agregar to-do">${ICON_LIST}</button>
        <button class="icon ico" type="button" data-act="qnote" aria-label="Agregar nota" title="Agregar nota">${ICON_NOTE}</button>
        <button class="icon ico" type="button" data-act="alert" aria-label="Alerta" title="${t.alert?"Cambiar la alerta":"Agregar una alerta"}">${ic("bell")}</button>`}
        <button class="icon ico" type="button" data-act="link" aria-label="Adjuntar link" title="Adjuntar link">${ic("link")}</button>
        <button class="icon" type="button" data-act="edit" aria-label="Editar" title="Editar">${ic("edit")}</button>
        <button class="icon" type="button" data-act="up" aria-label="Subir" title="Subir">${ic("up")}</button>
        <button class="icon" type="button" data-act="del" aria-label="Eliminar" title="Eliminar">${ic("x")}</button>
      </div></div>
      <button class="check" type="button" data-act="done" aria-label="${t.completed?"Reabrir tarea":"Marcar hecha"}" title="${t.completed?"Reabrir tarea":"Marcar como hecha"}">${ic(t.completed&&t.status==="cancelled"?"x":"check")}</button>
      ${(t.links||[]).length||linkAdd===t.id?`<div class="tlinks">${(t.links||[]).map(l=>`<span class="tlink" data-link="${l.id}"><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.url)}">${ic("link")}${esc(l.name)}</a><button class="x" type="button" data-act="link-del" aria-label="Quitar link ${esc(l.name)}" title="Quitar link">${ic("x")}</button></span>`).join("")}
        ${linkAdd===t.id?`<div class="tladd"><input type="url" id="tl-url" placeholder="Pega el link (OneDrive, SharePoint, web…)" aria-label="Link"><input type="text" id="tl-name" placeholder="Nombre (opcional)" aria-label="Nombre del link"><button class="btn sm" type="button" data-act="link-cancel">Cancelar</button><button class="btn sm primary" type="button" data-act="link-save">Adjuntar</button></div>`:""}</div>`:""}
      ${alertAdd===t.id&&!t.completed?alForm(t):""}
      ${editing===t.id?`<div class="edit">
        <label class="fld wide"><span>Tarea</span><input type="text" id="e-title" value="${esc(t.title)}"></label>
        <label class="fld"><span>Proyecto</span><input type="text" id="e-tag" value="${esc(t.tag||"")}" list="tags"></label>
        <label class="fld"><span>Estado</span><select id="e-status">${statusOpts(t.status||"todo")}</select></label>
        <label class="fld"><span>Criticidad</span><select id="e-crit">${["alta","media","baja"].map(c=>`<option value="${c}" ${c===crit?"selected":""}>${{alta:"Alta",media:"Media",baja:"Baja"}[c]}</option>`).join("")}</select></label>
        <label class="fld"><span>Vence</span><input type="date" id="e-due" value="${esc(t.due||"")}"></label>
        <label class="fld"><span>Repetir</span><select id="e-rec">${Object.entries(REC).map(([k,v])=>`<option value="${k}" ${k===(t.rec||"")?"selected":""}>${v}</option>`).join("")}</select></label>
        <label class="fld"><span>Alerta</span><input type="datetime-local" id="e-alert" value="${t.alert?alLocal(t.alert):""}"></label>
        <div class="wide" style="display:flex;gap:8px;justify-content:flex-end"><button class="btn sm" type="button" data-act="cancel">Cancelar</button><button class="btn sm primary" type="button" data-act="save">Guardar</button></div>
      </div>`:""}
      ${!t.completed&&(todoAdd===t.id||(todos.length&&!t.todoMin))?`<div class="todos">
        ${todos.map((x,i)=>`<label class="todo ${x.done?"ok":""}" data-todo="${x.id}"><span class="grip" data-grip title="Arrastra para reordenar" aria-hidden="true">⋮⋮</span><input type="checkbox" data-act="todo-check" ${x.done?"checked":""}><span>${esc(x.text)}</span><span class="tdacts"><button class="icon" type="button" data-act="todo-up" aria-label="Subir to-do" title="Subir" ${i?"":"disabled"}>↑</button><button class="icon" type="button" data-act="todo-down" aria-label="Bajar to-do" title="Bajar" ${i<todos.length-1?"":"disabled"}>↓</button><button class="icon" type="button" data-act="todo-del" aria-label="Eliminar to-do">✕</button></span></label>`).join("")}
        ${todoAdd===t.id?`<div class="todoin"><input type="text" id="todo-in" placeholder="Nuevo to-do y Enter" aria-label="Nuevo to-do"><button class="btn sm" type="button" data-act="todo-cancel">Cancelar</button><button class="btn sm primary" type="button" data-act="todo-add">Agregar</button></div>`
          :`<div class="todofoot"><button class="btn sm newitem" type="button" data-act="todo">+ Nuevo ítem</button>${todos.length?`<button class="btn sm" type="button" data-act="todo-hide" title="Ocultar la lista; se vuelve a abrir con el ícono to-do">Ocultar lista</button>`:""}</div>`}
      </div>`:""}
      ${qnote===t.id?`<div class="qnote">${S.notes.filter(n=>n.task===t.id).sort((x,y)=>(x.done?1:0)-(y.done?1:0)||x.createdAt-y.createdAt).map(n=>`<div class="tnote ${n.done?"ndone":""}" data-nid="${n.id}"><div class="tx">${linkify(n.text)}</div>
          <div class="tm"><span>${new Date(n.createdAt).toLocaleDateString("es",{day:"numeric",month:"short"})}${n.done?" · realizada":""}</span><label class="pub" title="Si está marcada, la nota también aparece en el panel Notas"><input type="checkbox" data-act="npub" ${n.priv?"":"checked"}> Publicar en Notas</label><button class="icon" type="button" data-act="ndel" aria-label="Eliminar nota" title="Eliminar nota">✕</button></div></div>`).join("")}
        ${S.notes.some(n=>n.task===t.id)?"":`<div class="meta" style="margin:0">Esta tarea aún no tiene notas.</div>`}
        ${qnoteNew===t.id?`<textarea id="qnote-in" rows="2" placeholder="Nota para esta tarea. Ctrl+Enter para guardar." aria-label="Nota para la tarea"></textarea>
        <div class="r"><label class="pub"><input type="checkbox" id="qnote-pub" ${lsGet("pp-qpub")===false?"":"checked"}> Publicar en Notas</label><span style="flex:1"></span><button class="btn sm" type="button" data-act="qnote-new-cancel">Cancelar</button><button class="btn sm primary" type="button" data-act="qnote-save">Guardar nota</button></div>`
        :`<div class="r"><button class="btn sm primary" type="button" data-act="qnote-new">+ Nueva nota</button><span style="flex:1"></span><button class="btn sm" type="button" data-act="qnote-cancel">Cerrar</button></div>`}</div>`:""}</li>`}).join("")
    : `<li class="empty">${tq.trim()?`Ninguna tarea coincide con «${esc(tq.trim())}».`:filter==="late"?"Nada atrasado: no hay tareas vencidas ni que venzan hoy.":filter==="star"?"Aún no marcas tareas para hoy. Toca la ☆ junto al nombre de una tarea para agregarla.":filter==="doing"?"No hay tareas en curso.":filter==="paused"?"No hay tareas en pausa.":filter==="backlog"?"No hay tareas en backlog.":filter==="inbox"?"No hay tareas sin asignar. Usa ⚡ Ingreso rápido para anotar varias de una vez.":filter==="done"?"Aún no hay tareas terminadas.":"Pulsa «+ Nueva tarea» para agregar la primera y luego Iniciar para contar su tiempo."}</li>`;
  const open=S.tasks.filter(t=>!t.completed); $("#pendCount").textContent=open.length; $("#pendCount").hidden=!open.length;
  const doneToday=S.tasks.filter(t=>t.completed&&t.completedAt&&dayKey(t.completedAt)===dayKey(Date.now())).length;
  $("#taskSum").innerHTML=open.length||doneToday?`<span>${open.length} abierta${open.length!==1?"s":""}</span>${doneToday?`<span>· ${doneToday} cerrada${doneToday!==1?"s":""} hoy</span>`:""}`:"";
  // current task
  const a=T.track&&taskById(T.track.id);
  $("#now").innerHTML=a?`<span style="min-width:0;overflow-wrap:anywhere">Avanzando <b>${esc(a.title)}</b> · <span class="spent" data-spent="${a.id}">${clock(liveSpent(a))}</span></span><span style="display:flex;gap:4px"><button class="btn ghost sm" type="button" id="stopA">Detener</button><button class="btn ghost sm" type="button" id="markA">Marcar hecha</button></span>`
    :"";
  $("#now").hidden=!a;
  // notes
  $("#nTask").innerHTML=`<option value="">Sin tarea vinculada</option>`+S.tasks.filter(t=>!t.completed).map(t=>`<option value="${t.id}" ${t.id===S.activeTaskId?"selected":""}>${esc(t.title)}</option>`).join("");
  const fmtN=n=>`${new Date(n.createdAt).toLocaleDateString("es",{day:"numeric",month:"short"})} ${hhmm(n.createdAt)}`;
  const notes=S.notes.filter(n=>!n.done&&!n.priv).sort((x,y)=>(y.pin?1:0)-(x.pin?1:0)||y.createdAt-x.createdAt);
  const doneN=S.notes.filter(n=>n.done&&!n.priv).sort((x,y)=>(y.doneAt||0)-(x.doneAt||0));
  $("#noteCount").textContent=notes.length?`${notes.length} nota${notes.length>1?"s":""}`:"";
  if(!document.activeElement||!document.activeElement.closest||!document.activeElement.closest("#notes"))
  $("#notes").innerHTML=(notes.length?notes.map(n=>`<li class="note" data-id="${n.id}">
      <div class="nrow"><button class="ncheck" type="button" data-nact="done" aria-label="Marcar nota como realizada" title="Marcar como realizada"></button><textarea rows="1" aria-label="Nota">${esc(n.text)}</textarea></div>
      <div class="meta"><span class="nl"><span>${fmtN(n)}</span>
        <select data-nsel aria-label="Tarea vinculada"><option value="">Sin tarea</option>${S.tasks.filter(t=>!t.completed||t.id===n.task).map(t=>`<option value="${t.id}" ${t.id===n.task?"selected":""}>${esc(t.title)}${t.completed?" (hecha)":""}</option>`).join("")}</select></span>
      <span class="acts">${n.task&&taskById(n.task)?`<button class="icon golink" type="button" data-nact="go" aria-label="Ir a la tarea" title="Ir a la tarea">${ic("go")}</button>`:""}<button class="icon" type="button" data-nact="pin" aria-label="${n.pin?"Desfijar":"Fijar arriba"}">${n.pin?"★":"☆"}</button><button class="icon" type="button" data-nact="del" aria-label="Eliminar nota">✕</button></span></div></li>`).join("")
    :`<li class="empty">${doneN.length?"No tienes notas pendientes.":"Aún no hay notas. Pulsa Nueva nota para agregar la primera."}</li>`)
   +(doneN.length?`<li class="donehead"><span class="label">Listas</span><span class="label">${doneN.length}</span></li>`+doneN.map(n=>{const tk=S.tasks.find(t=>t.id===n.task);
      return `<li class="note done" data-id="${n.id}"><div class="nrow"><span class="ntext">${esc(n.text)}</span>
        <span class="acts">${n.task&&taskById(n.task)?`<button class="icon golink" type="button" data-nact="go" aria-label="Ir a la tarea" title="Ir a la tarea">${ic("go")}</button>`:""}<button class="icon restore" type="button" data-nact="undo" aria-label="Volver a la lista principal" title="Volver a la lista principal">${ICON_UNDO}</button><button class="icon" type="button" data-nact="del" aria-label="Eliminar nota">✕</button></span></div>
        <div class="meta"><span>${fmtN(n)}${tk?` · ${esc(tk.title)}`:""}</span></div></li>`}).join(""):"");
  fitNotes(); renderMusic(); ambUI(); applyBg();
  // stats
  const tk=dayKey(Date.now()), todayLog=S.log.filter(e=>dayKey(e.t)===tk);
  const focusLog=todayLog.filter(e=>e.k==="focus"), mins=focusLog.reduce((a,e)=>a+e.min,0), pom=focusLog.filter(e=>!e.partial);
  $("#today").textContent=new Date().toLocaleDateString("es",{weekday:"long",day:"numeric",month:"long"});
  $("#sPomo").textContent=pom.length;
  $("#sMin").textContent=mins;
  const days=new Set(S.log.filter(e=>e.k==="focus"&&!e.partial).map(e=>dayKey(e.t))); let streak=0,d=new Date();
  if(!days.has(dayKey(d))) d.setDate(d.getDate()-1);
  while(days.has(dayKey(d))){streak++;d.setDate(d.getDate()-1);}
  $("#sStreak").textContent=streak+(streak===1?" día":" días");
  const done=pom.length;
  $("#goal").innerHTML=Array.from({length:Math.max(st.goal,done)},(_,i)=>`<i class="${i<done?"on":""}"></i>`).join("");
  $("#goalTxt").textContent=done>=st.goal?`Meta del día cumplida (${st.goal}).`:`${done} de ${st.goal} para la meta del día.`;
  const ints=todayLog.filter(e=>e.k==="int").length;
  $("#log").innerHTML=todayLog.length?[...todayLog].reverse().map(e=>{
    const tsk=S.tasks.find(t=>t.id===e.task);
    const txt=e.k==="int"?`Interrupción${tsk?" en "+esc(tsk.title):""}`:e.k==="focus"?`${e.min} min de enfoque${e.partial?" (incompleto)":""}${e.tasks&&e.tasks.length?" · "+e.tasks.map(x=>{const k=taskById(x.id);return k?esc(k.title)+(e.tasks.length>1?` (${x.min} min)`:""):""}).filter(Boolean).join(", "):tsk?" · "+esc(tsk.title):""}`:`${e.min} min de ${e.k==="long"?"pausa larga":"pausa"}`;
    return `<li><span class="tm">${hhmm(e.t)}</span><span class="dot ${e.k==="int"?"int":e.k==="focus"?"":e.k}"></span><span>${txt}</span></li>`}).join("")
    :`<li style="display:block;color:var(--ink-3)">Cuando termines un pomodoro quedará registrado aquí.</li>`;
  if(ints) $("#log").insertAdjacentHTML("afterbegin",`<li style="display:block;color:var(--danger)">${ints} interrupción${ints>1?"es":""} hoy</li>`);
  tick();
}

$("#addTask").addEventListener("submit",e=>{
  e.preventDefault(); const title=$("#tTitle").value.trim(); if(!title) return;
  const t={id:uid(),title,tag:$("#tTag").value.trim(),status:$("#tStatus").value,crit:$("#tCrit").value,due:$("#tDue").value||null,rec:$("#tRec").value||null,star:starOn("#tStar"),est:1,pomos:0,spent:0,completed:false,createdAt:Date.now(),order:Date.now()};
  S.tasks.push(t); if(!S.activeTaskId) S.activeTaskId=t.id;
  if(filter==="done") filter="open"; showTaskForm(false); commit(); toast("Tarea agregada");
});
// ★ toggle in the create forms; starts on when the list is showing ★ Hoy
const starOn=sel=>$(sel).getAttribute("aria-pressed")==="true";
function starSet(sel,on){ const b=$(sel); b.setAttribute("aria-pressed",String(on)); b.classList.toggle("on",on);
  if(sel==="#tStar"){ b.innerHTML=ic("star",on?"fill":""); b.title=on?"Marcada para hoy (★ Hoy). Clic para quitar":"Marcar para hoy (★ Hoy)"; }
  else b.innerHTML=ic("star",on?"fill":"")+(on?"Para hoy":"Marcar para hoy"); }
["#tStar","#qaStar"].forEach(sel=>{ starSet(sel,false); $(sel).addEventListener("click",()=>starSet(sel,!starOn(sel))); });
function showTaskForm(on){ if(on) showQuick(false); $("#addTask").hidden=!on; $("#newTaskBtn").hidden=on; $("#quickBtn").hidden=on;
  if(on){ starSet("#tStar",filter==="star"); $("#tTitle").focus(); } else { $("#tTitle").value=""; $("#tTag").value=""; $("#tDue").value=""; $("#tRec").value=""; $("#tCrit").value="media"; $("#tStatus").value="todo"; } }
$("#newTaskBtn").addEventListener("click",()=>showTaskForm(true));
// Quick capture: one box, several tasks split on commas or line breaks, all created as "Sin asignar".
const qaParse=v=>v.split(/[,\n]/).map(x=>x.trim()).filter(Boolean);
function qaCount(){ const n=qaParse($("#qaText").value).length; $("#qaCount").textContent=n?`Se ${n===1?"creará 1 tarea":`crearán ${n} tareas`}`:""; $("#qaSubmit").disabled=!n; }
function showQuick(on){ if(on&&!$("#addTask").hidden) showTaskForm(false); $("#quickAdd").hidden=!on; $("#quickBtn").hidden=on; $("#newTaskBtn").hidden=on;
  if(on){ starSet("#qaStar",filter==="star"); qaCount(); $("#qaText").focus(); } else $("#qaText").value=""; }
$("#quickBtn").addEventListener("click",()=>showQuick(true));
$("#qaCancel").addEventListener("click",()=>showQuick(false));
$("#qaText").addEventListener("input",qaCount);
$("#quickAdd").addEventListener("keydown",e=>{ if(e.key==="Escape"){ e.preventDefault(); showQuick(false); }
  else if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); $("#quickAdd").requestSubmit(); } });
$("#quickAdd").addEventListener("submit",e=>{ e.preventDefault(); const L=qaParse($("#qaText").value); if(!L.length) return;
  const now=Date.now(), st=starOn("#qaStar"); L.forEach((title,i)=>S.tasks.push({id:uid(),title,tag:"",status:"inbox",crit:"media",due:null,...(st?{star:true}:{}),est:1,pomos:0,spent:0,completed:false,createdAt:now+i,order:now+i}));
  if(!S.activeTaskId) S.activeTaskId=S.tasks[S.tasks.length-L.length].id;
  if(filter!=="all"&&!(st&&filter==="star")) filter="inbox"; lsSet("pp-filter",filter); showQuick(false); commit(); toast(L.length===1?"1 tarea agregada":`${L.length} tareas agregadas`); });
$("#cancelTask").addEventListener("click",()=>showTaskForm(false));
$("#addTask").addEventListener("keydown",e=>{ if(e.key==="Escape"){ e.preventDefault(); showTaskForm(false); } });
function linkSave(t){ const url=normUrl($("#tl-url").value); if(!url){ toast("Ese link no es válido. Copia la dirección completa."); $("#tl-url").focus(); return; }
  t.links=[...(t.links||[]),{id:uid(),url,name:linkName(url,$("#tl-name").value.trim())}]; linkAdd=null; document.activeElement.blur(); commit(); toast("Link adjuntado"); }
$("#tasks").addEventListener("keydown",e=>{ if(!e.target.closest(".tladd")) return; const t=taskById(e.target.closest(".task").dataset.id);
  if(e.key==="Enter"){ e.preventDefault(); t&&linkSave(t); } else if(e.key==="Escape"){ e.preventDefault(); linkAdd=null; render(); } });
$("#tasks").addEventListener("click",e=>{
  const b=e.target.closest("[data-act]"); if(!b) return; const id=b.closest(".task").dataset.id, t=S.tasks.find(x=>x.id===id); if(!t) return;
  const a=b.dataset.act;
  if(a==="todo-toggle"){ t.todoMin=!t.todoMin; if(t.todoMin&&todoAdd===id) todoAdd=null; commit(); return; }
  if(a==="link"){ linkAdd=linkAdd===id?null:id; render(); const el=$("#tl-url"); el&&el.focus(); return; }
  if(a==="link-cancel"){ linkAdd=null; document.activeElement.blur(); render(); return; }
  if(a==="alert"){ alertAdd=alertAdd===id?null:id; render(); const el=$("#ta-at"); el&&el.focus(); return; }
  if(a==="alert-cancel"){ alertAdd=null; document.activeElement.blur(); render(); return; }
  if(a==="alert-quick"){ alSave(t,alQuick(b.dataset.q,t)); return; }
  if(a==="alert-save"){ const v=$("#ta-at").value; if(!v){ toast("Elige el día y la hora de la alerta."); $("#ta-at").focus(); return; } alSave(t,new Date(v).getTime()); return; }
  if(a==="alert-del"){ alertAdd=null; alSet(t,null); document.activeElement.blur(); commit(); toast("Alerta quitada"); return; }
  if(a==="link-save"){ linkSave(t); return; }
  if(a==="link-del"){ const lid=b.closest("[data-link]").dataset.link, l=(t.links||[]).find(x=>x.id===lid); t.links=(t.links||[]).filter(x=>x.id!==lid); commit(); if(l) toast(`Link "${l.name}" quitado`); return; }
  if(a==="todo-hide"){ t.todoMin=true; if(todoAdd===id) todoAdd=null; commit(); return; }
  if(a==="todo"&&t.todoMin&&(t.todos||[]).length){ t.todoMin=false; commit(); return; }
  if(a==="todo"){ todoAdd=id; render(); const el=$("#todo-in"); el&&el.focus(); return; }
  if(a==="todo-cancel"){ todoAdd=null; document.activeElement.blur(); render(); return; }
  if(a==="todo-add"){ addTodo(t); return; }
  if(a==="todo-check"){ const x=(t.todos||[]).find(z=>z.id===b.closest("[data-todo]").dataset.todo); if(x){ x.done=b.checked; } b.blur(); commit(); return; }
  if(a==="todo-up"||a==="todo-down"){ e.preventDefault(); const L=t.todos||[], i=L.findIndex(z=>z.id===b.closest("[data-todo]").dataset.todo), j=i+(a==="todo-up"?-1:1);
    if(i>=0&&j>=0&&j<L.length){ [L[i],L[j]]=[L[j],L[i]]; commit(); const nb=$(`#tasks [data-todo="${L[j].id}"] [data-act="${a}"]`); (nb&&!nb.disabled?nb:$(`#tasks [data-todo="${L[j].id}"] input`))?.focus(); } return; }
  if(a==="todo-del"){ e.preventDefault(); t.todos=(t.todos||[]).filter(z=>z.id!==b.closest("[data-todo]").dataset.todo); commit(); return; }
  if(a==="qnote"){ qnote=qnote===id?null:id; qnoteNew=null; render(); return; }
  if(a==="qnote-cancel"){ qnote=null; qnoteNew=null; document.activeElement.blur(); render(); return; }
  if(a==="qnote-new"){ qnoteNew=id; render(); const el=$("#qnote-in"); el&&el.focus(); return; }
  if(a==="qnote-new-cancel"){ qnoteNew=null; document.activeElement.blur(); render(); return; }
  if(a==="qnote-save"){ saveQnote(t); return; }
  if(a==="npub"){ const n=S.notes.find(z=>z.id===b.closest("[data-nid]").dataset.nid); if(n){ n.priv=!b.checked; toast(n.priv?"Nota privada: solo en la tarea":"Nota publicada en el panel Notas"); } b.blur(); commit(); return; }
  if(a==="ndel"){ const nid=b.closest("[data-nid]").dataset.nid; confirmDel("¿Eliminar esta nota? No se puede deshacer.",()=>{ S.notes=S.notes.filter(z=>z.id!==nid); commit(); toast("Nota eliminada"); }); return; }
  if(a==="track"){ if(T.track&&T.track.id===id){ stopTrack(); } else { startTrack(id); return; } }
  else if(a==="edit"){ editing=editing===id?null:id; render(); if(editing){ const el=$("#e-title"); el&&el.focus(); } return; }
  else if(a==="cancel"){ editing=null; document.activeElement.blur(); render(); return; }
  else if(a==="save"){ const ti=$("#e-title").value.trim(); if(ti) t.title=ti; t.tag=$("#e-tag").value.trim(); t.crit=$("#e-crit").value; setStatus(t,$("#e-status").value); t.due=$("#e-due").value||null; t.rec=$("#e-rec").value||null; { const av=$("#e-alert").value, ms=av?new Date(av).getTime():null; if((ms||null)!==(t.alert||null)) alSet(t,ms); } editing=null; document.activeElement.blur(); toast("Tarea actualizada"); }
  else if(a==="done"){ setStatus(t,t.completed?"todo":"done"); }
  else if(a==="jday"){ jGoTask(t); return; }
  else if(a==="star"){ t.star=!t.star; toast(t.star?"Agregada a ★ Hoy":"Quitada de ★ Hoy"); }
  else if(a==="up"){ const open=S.tasks.filter(x=>x.completed===t.completed).sort((x,y)=>(x.order??x.createdAt)-(y.order??y.createdAt)); const i=open.indexOf(t); if(i>0){ const p=open[i-1], o=p.order??p.createdAt; p.order=t.order??t.createdAt; t.order=o; } }
  else if(a==="del"){ const nN=S.notes.filter(n=>n.task===id).length;
    confirmDel(`¿Eliminar la tarea "${t.title}"?${nN===1?" Su nota se conservará sin tarea vinculada.":nN>1?` Sus ${nN} notas se conservarán sin tarea vinculada.`:""} No se puede deshacer.`,()=>{
      if(T.track&&T.track.id===id) stopTrack(); S.tasks=S.tasks.filter(x=>x.id!==id); S.notes.forEach(n=>{ if(n.task===id) n.task=null; }); if(S.activeTaskId===id) S.activeTaskId=null; commit(); toast("Tarea eliminada"); });
    return; }
  commit();
});
function addTodo(t){ const el=$("#todo-in"), v=el?el.value.trim():""; if(!v){ todoAdd=null; el&&el.blur(); render(); return; }
  (t.todos=t.todos||[]).push({id:uid(),text:v,done:false}); el.blur(); commit(); const n=$("#todo-in"); n&&n.focus(); }
function saveQnote(t){ const el=$("#qnote-in"), v=el?el.value.trim():"", pb=$("#qnote-pub"), pub=pb?pb.checked:true; el&&el.blur(); lsSet("pp-qpub",pub);
  if(v){ S.notes.push(pub?{id:uid(),text:v,task:t.id,createdAt:Date.now()}:{id:uid(),text:v,task:t.id,createdAt:Date.now(),priv:true}); qnoteNew=null; commit(); toast(pub?"Nota guardada y publicada en Notas":"Nota privada guardada en la tarea"); } else { qnoteNew=null; render(); } }
function linkify(x){ return esc(x).replace(/https?:\/\/[^\s<]+/g,u=>{ const h=u.replace(/[).,;]+$/,""), r=u.slice(h.length); return `<a href="${h}" target="_blank" rel="noopener">${h.length>60?h.slice(0,57)+"…":h}</a>${r}`; }); }
// drag to reorder to-dos (handle only, within the same task)
$("#tasks").addEventListener("pointerdown",e=>{ const g=e.target.closest("[data-grip]"); if(g) g.closest(".todo").draggable=true; });
$("#tasks").addEventListener("dragstart",e=>{ const r=e.target.closest&&e.target.closest(".todo"); if(!r||!r.draggable) return;
  dragTodo={tid:r.closest(".task").dataset.id,id:r.dataset.todo}; r.classList.add("dragging"); e.dataTransfer.effectAllowed="move"; try{ e.dataTransfer.setData("text/plain",r.dataset.todo); }catch{} });
const clearDrop=()=>document.querySelectorAll(".todo.drop-before,.todo.drop-after").forEach(x=>x.classList.remove("drop-before","drop-after"));
$("#tasks").addEventListener("dragover",e=>{ if(!dragTodo) return; const r=e.target.closest(".todo"); if(!r||r.closest(".task").dataset.id!==dragTodo.tid) return;
  e.preventDefault(); clearDrop(); if(r.dataset.todo===dragTodo.id) return; const bx=r.getBoundingClientRect(); r.classList.add(e.clientY<bx.top+bx.height/2?"drop-before":"drop-after"); });
$("#tasks").addEventListener("drop",e=>{ if(!dragTodo) return; e.preventDefault(); const r=e.target.closest(".todo"); const d=dragTodo;
  if(r&&r.closest(".task").dataset.id===d.tid&&r.dataset.todo!==d.id){ const t=taskById(d.tid), L=t.todos||[], from=L.findIndex(z=>z.id===d.id);
    const after=r.classList.contains("drop-after"); const [m]=L.splice(from,1); let to=L.findIndex(z=>z.id===r.dataset.todo); if(after) to++; L.splice(to,0,m); dragTodo=null; clearDrop(); commit(); return; }
  clearDrop(); });
$("#tasks").addEventListener("dragend",e=>{ const r=e.target.closest&&e.target.closest(".todo"); if(r){ r.classList.remove("dragging"); r.draggable=false; } clearDrop(); if(dragTodo){ dragTodo=null; render(); } });
$("#tasks").addEventListener("keydown",e=>{
  if(e.target.id==="todo-in"){ if(e.key==="Enter"){ e.preventDefault(); addTodo(taskById(e.target.closest(".task").dataset.id)); } else if(e.key==="Escape"){ todoAdd=null; e.target.blur(); render(); } return; }
  if(e.target.id==="qnote-in"){ if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); saveQnote(taskById(e.target.closest(".task").dataset.id)); } else if(e.key==="Escape"){ qnoteNew=null; e.target.blur(); render(); } return; } if(e.key==="Enter"&&e.target.closest(".edit")){ e.preventDefault(); e.target.closest(".task").querySelector('[data-act="save"]').click(); } else if(e.key==="Escape"&&e.target.closest(".edit")){ e.target.closest(".task").querySelector('[data-act="cancel"]').click(); } });
function setCollapsed(c){ const g=$("#grid"), b=$("#collapseTasks"); g.classList.toggle("collapsed",c); b.setAttribute("aria-expanded",String(!c));
  b.title=c?"Mostrar tareas":"Contraer tareas"; b.setAttribute("aria-label",b.title); lsSet("pp-collapsed",c); }
setCollapsed(!!lsGet("pp-collapsed"));
function goToTask(id,opt={}){
  const t=taskById(id); if(!t) return;
  setCollapsed(false); if(opt.notes){ qnote=t.id; qnoteNew=null; editing=null; } else editing=t.id; render();
  if(!$(`#tasks li[data-id="${t.id}"]`)){ tq=""; $("#tSearch").value=""; $("#tSearchClear").hidden=true; $(".tsearch").classList.remove("has"); tagF=null; lsSet("pp-tag",null); filter="open"; render(); if(!$(`#tasks li[data-id="${t.id}"]`)){ filter="all"; render(); } lsSet("pp-filter",filter); }
  const li=$(`#tasks li[data-id="${t.id}"]`); if(!li) return;
  li.scrollIntoView({behavior:"smooth",block:"center"}); li.classList.remove("flash"); void li.offsetWidth; li.classList.add("flash");
  const el=opt.notes?$(`#tasks li[data-id="${t.id}"] [data-act="qnote-new"]`):$("#e-title"); el&&el.focus({preventScroll:true});
}
$("#sub").addEventListener("click",()=>{ const id=$("#sub").dataset.tid; if(id) goToTask(id); });
$("#sub").addEventListener("keydown",e=>{ const id=$("#sub").dataset.tid; if(id&&(e.key==="Enter"||e.key===" ")){ e.preventDefault(); e.stopPropagation(); goToTask(id); } });
$("#collapseTasks").addEventListener("click",e=>{ e.stopPropagation(); setCollapsed(!$("#grid").classList.contains("collapsed")); });
document.querySelector(".tasks-panel").addEventListener("click",e=>{ if($("#grid").classList.contains("collapsed")&&!e.target.closest("button")) setCollapsed(false); });
$("#tasks").addEventListener("change",e=>{ if(!e.target.matches("[data-status]")) return; const t=taskById(e.target.closest(".task").dataset.id); if(!t) return;
  setStatus(t,e.target.value); e.target.blur(); commit(); toast(`Estado: ${STL[t.status]}`); });
$("#tSearch").addEventListener("input",e=>{ tq=e.target.value; $("#tSearchClear").hidden=!tq; e.target.parentNode.classList.toggle("has",!!tq); render(); });
$("#tSearch").addEventListener("keydown",e=>{ if(e.key==="Escape"&&tq){ e.preventDefault(); e.stopPropagation(); e.target.value=""; tq=""; $("#tSearchClear").hidden=true; $(".tsearch").classList.remove("has"); render(); } });
$("#tSearchClear").addEventListener("click",()=>{ const i=$("#tSearch"); i.value=""; tq=""; $("#tSearchClear").hidden=true; $(".tsearch").classList.remove("has"); render(); i.focus(); });
$("#sort").addEventListener("change",e=>{ sortBy=e.target.value; lsSet("pp-sort",sortBy); render(); });
$("#now").addEventListener("click",e=>{ if(e.target.id==="stopA"){ stopTrack(); commit(); return; } if(e.target.id==="markA"){ const t=T.track&&taskById(T.track.id); if(t){ setStatus(t,"done"); commit(); toast("Tarea completada");} } });
document.querySelectorAll("[data-f]").forEach(b=>b.addEventListener("click",()=>{filter=b.dataset.f; lsSet("pp-filter",filter); fMoreShow(false); render();}));
// the menu lives on <body> (the glass panel would clip it) and is placed under the button
function fMoreShow(on){ const pop=$("#fMorePop"), b=$("#fMore"); pop.hidden=!on; b.setAttribute("aria-expanded",String(on)); if(!on) return;
  if(pop.parentElement!==document.body) document.body.appendChild(pop);
  const r=b.getBoundingClientRect(), w=pop.offsetWidth, h=pop.offsetHeight;
  pop.style.left=Math.max(8,Math.min(r.right-w,innerWidth-w-8))+"px";
  pop.style.top=(r.bottom+6+h>innerHeight&&r.top-6-h>0?r.top-6-h:r.bottom+6)+"px"; }
addEventListener("resize",()=>{ if(!$("#fMorePop").hidden) fMoreShow(false); });
addEventListener("scroll",()=>{ if(!$("#fMorePop").hidden) fMoreShow(true); },true); // follow the button
$("#fMore").addEventListener("click",e=>{ e.stopPropagation(); fMoreShow($("#fMorePop").hidden); });
document.addEventListener("click",e=>{ if(e.isTrusted&&!$("#fMorePop").hidden&&!e.target.closest(".fmorew,#fMorePop")) fMoreShow(false); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&!$("#fMorePop").hidden){ fMoreShow(false); $("#fMore").focus(); } });
$("#tagSel").addEventListener("change",e=>{ tagF=e.target.value||null; lsSet("pp-tag",tagF); e.target.blur(); render(); });

// ---------- notes ----------
function fitNotes(){ document.querySelectorAll("#notes textarea").forEach(a=>{ a.style.height="auto"; a.style.height=a.scrollHeight+"px"; }); }
addEventListener("resize",()=>{ clearTimeout(fitNotes.t); fitNotes.t=setTimeout(fitNotes,150); });
document.fonts&&document.fonts.ready.then(fitNotes);
function showNoteForm(on){ $("#addNote").hidden=!on; $("#newNoteBtn").hidden=on; if(on) $("#nText").focus(); else $("#nText").value=""; }
function addNote(){ const text=$("#nText").value.trim(); if(!text){ $("#nText").focus(); return; } S.notes.push({id:uid(),text,task:$("#nTask").value||null,createdAt:Date.now()}); showNoteForm(false); commit(); toast("Nota guardada"); }
$("#newNoteBtn").addEventListener("click",()=>showNoteForm(true));
function setNotesCollapsed(c){ const b=$("#collapseNotes"); $("#notesPanel").classList.toggle("collapsed",c); b.setAttribute("aria-expanded",String(!c));
  b.title=c?"Mostrar notas":"Contraer notas"; b.setAttribute("aria-label",b.title); lsSet("pp-notes-collapsed",c); if(!c) fitNotes(); }
setNotesCollapsed(!!lsGet("pp-notes-collapsed"));
function setMusicCollapsed(c){ const b=$("#collapseMusic"); $("#musicPanel").classList.toggle("collapsed",c); b.setAttribute("aria-expanded",String(!c));
  b.title=c?"Mostrar música":"Contraer música"; b.setAttribute("aria-label",b.title); lsSet("pp-music-collapsed",c); }
setMusicCollapsed(!!lsGet("pp-music-collapsed"));
$("#collapseMusic").addEventListener("click",e=>{ e.stopPropagation(); setMusicCollapsed(!$("#musicPanel").classList.contains("collapsed")); });
$("#musicPanel").addEventListener("click",e=>{ if($("#musicPanel").classList.contains("collapsed")&&!e.target.closest("button")) setMusicCollapsed(false); });
$("#collapseNotes").addEventListener("click",e=>{ e.stopPropagation(); setNotesCollapsed(!$("#notesPanel").classList.contains("collapsed")); });
$("#notesPanel").addEventListener("click",e=>{ if($("#notesPanel").classList.contains("collapsed")&&!e.target.closest("button")) setNotesCollapsed(false); });
$("#cancelNote").addEventListener("click",()=>showNoteForm(false));
$("#addNote").addEventListener("submit",e=>{e.preventDefault();addNote();});
$("#nText").addEventListener("keydown",e=>{ if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();addNote();} else if(e.key==="Escape") showNoteForm(false); });
let noteT=null;
$("#notes").addEventListener("input",e=>{ if(e.target.tagName!=="TEXTAREA") return; e.target.style.height="auto"; e.target.style.height=e.target.scrollHeight+"px"; const li=e.target.closest(".note"); const n=S.notes.find(x=>x.id===li.dataset.id); if(!n) return; n.text=e.target.value; clearTimeout(noteT); noteT=setTimeout(()=>{S.updatedAt=Date.now(); lsSet(LS,S); schedule();},600); });
$("#notes").addEventListener("focusout",e=>{ setTimeout(()=>{ if(!document.activeElement.closest("#notes")){ S.notes=S.notes.filter(n=>n.text.trim()); commit(); } },0); });
$("#notes").addEventListener("click",e=>{ const b=e.target.closest("[data-nact]"); if(!b) return; const id=b.closest(".note").dataset.id; const n=S.notes.find(x=>x.id===id);
  if(b.dataset.nact==="go"){ b.blur(); if(n&&n.task) goToTask(n.task,{notes:true}); return; }
  if(b.dataset.nact==="del"){ b.blur(); const pv=n?n.text.trim().slice(0,60)+(n.text.trim().length>60?"…":""):"";
    confirmDel(`¿Eliminar la nota "${pv}"? No se puede deshacer.`,()=>{ S.notes=S.notes.filter(x=>x.id!==id); commit(); toast("Nota eliminada"); }); return; }
  if(b.dataset.nact==="done"&&n){ b.blur(); n.done=true; n.doneAt=Date.now(); commit(); toast("Nota movida a Listas"); return; }
  if(b.dataset.nact==="undo"&&n){ b.blur(); n.done=false; n.doneAt=null; commit(); toast("Nota devuelta a la lista principal"); return; }
  if(n) n.pin=!n.pin; b.blur(); commit(); });
$("#notes").addEventListener("change",e=>{ if(!e.target.matches("[data-nsel]")) return; const n=S.notes.find(x=>x.id===e.target.closest(".note").dataset.id); if(!n) return;
  n.task=e.target.value||null; e.target.blur(); commit(); toast("Tarea de la nota actualizada"); });

// ---------- controls ----------
$("#toggle").addEventListener("click",()=>T.running?pause():start());
$("#reset").addEventListener("click",reset);
$("#skip").addEventListener("click",()=>finish(true));
document.querySelectorAll(".modes button").forEach(b=>b.addEventListener("click",()=>{ if(b.dataset.mode==="focus"&&T.mode!=="focus"){} setMode(b.dataset.mode,false); }));
function interruption(){ if(T.mode!=="focus") return; S.log.push({t:Date.now(),k:"int",task:S.activeTaskId}); commit(); toast("Interrupción registrada"); }
document.addEventListener("keydown",e=>{
  if(e.target.closest("input,textarea,select,dialog,[contenteditable]")||e.ctrlKey||e.metaKey||e.altKey) return;
  if(e.code==="Space"){e.preventDefault(); T.running?pause():start();}
  else if(e.key==="r"||e.key==="R") reset();
  else if(e.key==="s"||e.key==="S") finish(true);
  else if(e.key==="i"||e.key==="I") interruption();
  else if(e.key==="c"||e.key==="C"){ e.preventDefault(); calOpen(); }
});

// settings
const dlg=$("#settings");
// theme and layout: applied at once, saved in settings
var HOST_THEME=document.documentElement.getAttribute("data-theme");
function applyLook(){ if(HOST_THEME===undefined) return; const st=S.settings, th=st.theme==="light"||st.theme==="dark"?st.theme:"system", de=document.documentElement;
  if(th==="system"){ if(HOST_THEME) de.setAttribute("data-theme",HOST_THEME); else de.removeAttribute("data-theme"); } else de.setAttribute("data-theme",th);
  document.body.classList.toggle("lay-below",st.layout==="below");
  document.querySelectorAll("[data-theme-opt]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.themeOpt===th)));
  document.querySelectorAll("[data-lay-opt]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.layOpt===(st.layout==="below"?"below":"side")))); }
$("#themeSeg").addEventListener("click",e=>{ const b=e.target.closest("[data-theme-opt]"); if(!b) return; S.settings.theme=b.dataset.themeOpt; applyLook(); commit(); });
$("#laySeg").addEventListener("click",e=>{ const b=e.target.closest("[data-lay-opt]"); if(!b) return; S.settings.layout=b.dataset.layOpt; applyLook(); commit(); });
$("#cFocusMode").addEventListener("change",()=>{ S.settings.focusMode=$("#cFocusMode").checked; commit(); });
applyLook();
document.querySelectorAll("#setNav [data-ic],#setForm .seg [data-ic]").forEach(b=>b.insertAdjacentHTML("afterbegin",ic(b.dataset.ic)));
function setSec(id){ const btns=[...document.querySelectorAll("#setNav [data-sec]")]; if(!btns.some(b=>b.dataset.sec===id)) id="timer";
  btns.forEach(b=>{ const on=b.dataset.sec===id; b.setAttribute("aria-selected",String(on)); b.tabIndex=on?0:-1; });
  document.querySelectorAll("#setForm .setsec").forEach(x=>x.hidden=x.id!=="set-"+id); $("#setForm .setpanes").scrollTop=0; lsSet("pp-setsec",id); }
$("#setNav").addEventListener("click",e=>{ const b=e.target.closest("[data-sec]"); if(b) setSec(b.dataset.sec); });
$("#setNav").addEventListener("keydown",e=>{ const k=e.key; if(!["ArrowDown","ArrowUp","ArrowLeft","ArrowRight"].includes(k)) return; e.preventDefault();
  const btns=[...document.querySelectorAll("#setNav [data-sec]")], i=btns.findIndex(b=>b.getAttribute("aria-selected")==="true"), n=btns[(i+((k==="ArrowDown"||k==="ArrowRight")?1:-1)+btns.length)%btns.length];
  setSec(n.dataset.sec); n.focus(); });
$("#setClose").addEventListener("click",()=>dlg.close("cancel"));
$("#openSettings").addEventListener("click",()=>{ const s=S.settings;
  $("#cFocus").value=s.focus;$("#cShort").value=s.short;$("#cLong").value=s.long;$("#cEvery").value=s.longEvery;$("#cGoal").value=s.goal;
  $("#cAutoB").checked=s.autoBreaks;$("#cAutoF").checked=s.autoFocus;$("#cSound").checked=s.sound;$("#cFocusMode").checked=s.focusMode!==false; $("#cAlSound").checked=s.alertSound!==false; alPermUI(); renderBgPick(); setSec(lsGet("pp-setsec")||"timer"); dlg.returnValue=""; dlg.showModal(); });
dlg.addEventListener("close",()=>{ if(dlg.returnValue!=="ok") return;
  const n=(id,min,max,d)=>{const v=Math.round(+$(id).value);return v>=min&&v<=max?v:d};
  const s=S.settings, old={...s};
  s.focus=n("#cFocus",1,120,s.focus);s.short=n("#cShort",1,60,s.short);s.long=n("#cLong",1,90,s.long);s.longEvery=n("#cEvery",2,10,s.longEvery);s.goal=n("#cGoal",1,30,s.goal);
  s.autoBreaks=$("#cAutoB").checked;s.autoFocus=$("#cAutoF").checked;s.sound=$("#cSound").checked;s.focusMode=$("#cFocusMode").checked;
  const k={focus:"focus",short:"short",long:"long"}[T.mode]; if(!T.running&&old[k]!==s[k]){T.remaining=durMs(T.mode);saveT();}
  commit(); toast("Ajustes guardados"); });
$("#clearDone").addEventListener("click",()=>{ const n=S.tasks.filter(t=>t.completed).length; dlg.close(); if(!n){ toast("No había tareas hechas"); return; }
  confirmDel(`¿Borrar ${n} tarea${n>1?"s":""} hecha${n>1?"s":""}? No se puede deshacer.`,()=>{ const ids=new Set(S.tasks.filter(t=>t.completed).map(t=>t.id)); S.tasks=S.tasks.filter(t=>!t.completed); S.notes.forEach(x=>{ if(ids.has(x.task)) x.task=null; }); commit(); toast(`${n} tarea${n>1?"s":""} borrada${n>1?"s":""}`); }); });
// ---------- music: ambient sound (generated here) + Spotify links ----------
const AMB={scene:null,gain:null,kind:null,playing:false,want:false};
const AMB_NAME={lofi:"Lo-fi",rain:"Lluvia",cafe:"Cafetería",white:"Ruido blanco"};
function noiseBuffer(kind){
  const len=AC.sampleRate*4, buf=AC.createBuffer(2,len,AC.sampleRate);
  for(let c=0;c<2;c++){ const d=buf.getChannelData(c); let last=0,b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    for(let i=0;i<len;i++){ const w=Math.random()*2-1;
      if(kind==="white") d[i]=w*.35;
      else if(kind==="brown"){ last=(last+.02*w)/1.02; d[i]=last*3.2; }
      else { b0=.99886*b0+w*.0555179;b1=.99332*b1+w*.0750759;b2=.969*b2+w*.153852;b3=.8665*b3+w*.3104856;b4=.55*b4+w*.5329522;b5=-.7616*b5-w*.016898;
        let v=(b0+b1+b2+b3+b4+b5+b6+w*.5362)*.11; b6=w*.115926; if(kind==="rain"&&Math.random()<.0009) v+=(Math.random()*2-1)*.6; d[i]=v; } } }
  return buf;
}
const NB={}; const nb=k=>NB[k]||(NB[k]=noiseBuffer(k));
// Builds one soundscape into `out` and returns its stopper. Events (thunder, steps, voices) are scheduled ahead on the audio clock.
function ambScene(kind,out){
  const nodes=[], timers=[]; let alive=true;
  const R=(a,b)=>a+Math.random()*(b-a);
  const later=(fn,ms)=>{ timers.push(setTimeout(()=>{ if(alive) fn(); },ms)); };
  const gn=v=>{ const g=AC.createGain(); g.gain.value=v; return g; };
  const filt=(type,f,q=.7)=>{ const b=AC.createBiquadFilter(); b.type=type; b.frequency.value=f; b.Q.value=q; return b; };
  const pan=v=>{ if(!AC.createStereoPanner) return gn(1); const p=AC.createStereoPanner(); p.pan.value=Math.max(-1,Math.min(1,v)); return p; };
  const loop=(k,dest,rate=1)=>{ const s=AC.createBufferSource(); s.buffer=nb(k); s.loop=true; s.playbackRate.value=rate; s.connect(dest); s.start(0,R(0,3.5)); nodes.push(s); return s; };
  if(kind==="white") loop("white",out);
  else if(kind==="lofi"){
    // generated lo-fi hip hop: dusty Rhodes chords, round bass, swung drums, vinyl crackle, all through a soft "tape" filter
    const bus=gn(.7), tape=filt("lowpass",3200,.5); bus.connect(tape).connect(out);
    const wob=AC.createOscillator(), wobG=gn(500); wob.frequency.value=.13; wob.connect(wobG).connect(tape.frequency); wob.start(); nodes.push(wob);
    const rv=AC.createConvolver(), L=Math.floor(AC.sampleRate*2.2), ir=AC.createBuffer(2,L,AC.sampleRate);
    for(let c=0;c<2;c++){ const d=ir.getChannelData(c); for(let i=0;i<L;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/L,2.5); }
    rv.buffer=ir; rv.connect(gn(.35)).connect(bus);
    // vinyl: hiss + random crackles
    const vb=AC.createBuffer(1,AC.sampleRate*6,AC.sampleRate), vd=vb.getChannelData(0);
    for(let i=0;i<vd.length;i++){ vd[i]=(Math.random()*2-1)*.012; if(Math.random()<.0004) vd[i]+=(Math.random()*2-1)*R(.15,.5); }
    const vs=AC.createBufferSource(); vs.buffer=vb; vs.loop=true; const vf=filt("bandpass",2500,.4); vs.connect(vf).connect(gn(.9)).connect(out); vs.start(); nodes.push(vs);
    const BPM=R(72,80), beat=60/BPM, bar=beat*4, sw=beat*.62; // swung 8ths
    const mtof=m=>440*Math.pow(2,(m-69)/12);
    const PROGS=[[[50,53,57,60,64],[43,53,55,59,64],[48,52,55,59,62],[45,48,52,55,59]],  // Dm9 G13 Cmaj9 Am9
                 [[53,57,60,64,67],[52,55,59,62,65],[50,53,57,60,64],[48,52,55,59,62]],  // Fmaj9 Em9 Dm9 Cmaj9
                 [[45,48,52,55,59],[50,53,57,60,64],[43,47,50,53,57],[48,52,55,59,64]]]; // Am9 Dm9 G9 Cmaj7
    let prog=PROGS[Math.floor(Math.random()*PROGS.length)], barN=0;
    const keys=(m,t,d,v)=>{ const f=mtof(m), g=gn(0), lp=filt("lowpass",1600,.3), p=pan(R(-.25,.25));
      [[1,"sine",1],[2,"sine",.18],[3,"triangle",.05]].forEach(([h,ty,a])=>{ const o=AC.createOscillator(); o.type=ty; o.frequency.value=f*h; o.detune.value=R(-6,6); o.connect(gn(a)).connect(g); o.start(t); o.stop(t+d+1.2); });
      const trem=AC.createOscillator(), tg=gn(.12*v); trem.frequency.value=4.5; trem.connect(tg).connect(g.gain); trem.start(t); trem.stop(t+d+1.2);
      g.connect(lp).connect(p); p.connect(bus); p.connect(rv);
      g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(.16*v,t+.02); g.gain.setTargetAtTime(.09*v,t+.05,.4); g.gain.setTargetAtTime(0,t+d,.35); };
    const bass=(m,t,d)=>{ const o=AC.createOscillator(), g=gn(0); o.type="sine"; o.frequency.value=mtof(m); o.connect(g).connect(bus);
      g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(.42,t+.015); g.gain.setTargetAtTime(.25,t+.05,.2); g.gain.setTargetAtTime(0,t+d,.06); o.start(t); o.stop(t+d+.4); };
    const kick=t=>{ const o=AC.createOscillator(), g=gn(0); o.frequency.setValueAtTime(115,t); o.frequency.exponentialRampToValueAtTime(42,t+.12); o.connect(g).connect(bus);
      g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(.85,t+.004); g.gain.exponentialRampToValueAtTime(.001,t+.32); o.start(t); o.stop(t+.35); };
    const snare=t=>{ const s=AC.createBufferSource(); s.buffer=nb("white"); const bp=filt("bandpass",1700,.8), g=gn(0); s.connect(bp).connect(g); g.connect(bus); g.connect(rv);
      g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(.42,t+.003); g.gain.exponentialRampToValueAtTime(.001,t+.2); s.start(t,R(0,3)); s.stop(t+.25);
      const o=AC.createOscillator(), og=gn(0); o.frequency.value=190; o.connect(og).connect(bus); og.gain.setValueAtTime(.18,t); og.gain.exponentialRampToValueAtTime(.001,t+.08); o.start(t); o.stop(t+.1); };
    const hat=(t,a)=>{ const s=AC.createBufferSource(); s.buffer=nb("white"); const hp=filt("highpass",7000), g=gn(0); s.connect(hp).connect(g).connect(pan(.25)).connect(bus);
      g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(a,t+.002); g.gain.exponentialRampToValueAtTime(.001,t+.05); s.start(t,R(0,3)); s.stop(t+.07); };
    const bell=(m,t)=>{ const o=AC.createOscillator(), g=gn(0); o.type="triangle"; o.frequency.value=mtof(m); const p=pan(R(-.5,.5)); o.connect(g).connect(p); p.connect(bus); p.connect(rv);
      g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(.07,t+.01); g.gain.exponentialRampToValueAtTime(.001,t+1.4); o.start(t); o.stop(t+1.5); };
    const PENTA=[72,74,76,79,81,84];
    const schedBar=t0=>{
      const ch=prog[barN%4], drop=barN%8===7&&Math.random()<.5;
      // chords: a lazy strum on 1, sometimes a push on the "and" of 2
      ch.forEach((m,i)=>keys(m+12,t0+i*.018+R(0,.01),bar*.55,R(.8,1)));
      if(Math.random()<.45) ch.slice(1).forEach((m,i)=>keys(m+12,t0+beat*1.5+i*.015,beat*1.4,R(.5,.7)));
      bass(ch[0]-12,t0,beat*1.6); bass(ch[0]-12+(Math.random()<.5?7:0),t0+beat*2.5,beat*1.2);
      if(!drop){ kick(t0); kick(t0+beat*2.5); if(Math.random()<.4) kick(t0+beat*1.75); snare(t0+beat); snare(t0+beat*3);
        for(let k=0;k<8;k++) hat(t0+Math.floor(k/2)*beat+(k%2?sw:0),k%2?.05:.09); }
      if(Math.random()<.55){ let tt=t0+beat*R(.5,2); for(let k=0;k<Math.round(R(2,5));k++){ bell(PENTA[Math.floor(Math.random()*PENTA.length)],tt); tt+=beat*(Math.random()<.5?.5:1); } }
      barN++; if(barN%16===0) prog=PROGS[Math.floor(Math.random()*PROGS.length)];
    };
    let next=AC.currentTime+.15;
    const pump=()=>{ while(next<AC.currentTime+bar*1.5){ schedBar(next); next+=bar; } later(pump,bar*500); };
    pump();
  }
  else if(kind==="rain"){
    // steady rain: bright patter plus a darker body
    const hp=filt("highpass",400), lp=filt("lowpass",8000); hp.connect(lp).connect(gn(.8)).connect(out); loop("rain",hp);
    const body=filt("lowpass",700); body.connect(gn(.35)).connect(out); loop("brown",body);
    // wind: band of noise whose level and pitch drift in gusts
    const wbp=filt("bandpass",400,.9), wg=gn(.3), wp=pan(0); wbp.connect(wg).connect(wp).connect(out); loop("pink",wbp,.6);
    const gust=()=>{ const t=AC.currentTime, d=R(2,6); wg.gain.setTargetAtTime(R(.25,1.6),t,d/3); wbp.frequency.setTargetAtTime(R(220,750),t,d/3); if(wp.pan) wp.pan.setTargetAtTime(R(-.6,.6),t,d/2); later(gust,d*1000); };
    gust();
    // thunder: a crack (when near) and a rumble that rolls and fades
    const thunder=()=>{ const t=AC.currentTime+.05, near=Math.random()<.35, dur=R(4,9), f0=near?1400:500;
      const lp2=filt("lowpass",f0), g=gn(0); lp2.connect(g).connect(pan(R(-.6,.6))).connect(out);
      const s=AC.createBufferSource(); s.buffer=nb("brown"); s.loop=true; s.connect(lp2); s.start(t,R(0,3)); s.stop(t+dur+.6); nodes.push(s);
      const peak=near?R(1.4,2):R(.7,1.2), rise=near?.04:R(.5,1); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(peak,t+rise);
      let x=t+rise; while(x<t+dur){ x+=R(.15,.6); g.gain.linearRampToValueAtTime(Math.max(0,peak*(1-(x-t)/dur)*R(.35,1)),x); }
      g.gain.linearRampToValueAtTime(0,x+.4);
      lp2.frequency.setValueAtTime(f0,t); lp2.frequency.exponentialRampToValueAtTime(near?160:110,t+dur*.6);
      later(thunder,R(20000,60000)); };
    later(thunder,R(5000,14000));
  }
  else if(kind==="cafe"){
    // room: a little reverb so everything sits in one space
    const room=gn(1); room.connect(out);
    const conv=AC.createConvolver(), L=Math.floor(AC.sampleRate*1.6), ir=AC.createBuffer(2,L,AC.sampleRate);
    for(let c=0;c<2;c++){ const d=ir.getChannelData(c); for(let i=0;i<L;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/L,3); }
    conv.buffer=ir; conv.connect(gn(.5)).connect(room);
    const tone=filt("lowpass",500); tone.connect(gn(.18)).connect(room); loop("pink",tone);
    // voices: pitched sources through moving formants, talking in phrases; kept soft so no words come through
    const vbus=filt("lowpass",2400); vbus.connect(conv); vbus.connect(gn(.4)).connect(room);
    const voice=()=>{ const o=AC.createOscillator(); o.type="sawtooth"; const f0=Math.random()<.5?R(170,240):R(95,140); o.frequency.value=f0;
      const env=gn(0), f1=filt("bandpass",500,6), f2=filt("bandpass",1500,9);
      o.connect(f1).connect(env); o.connect(f2).connect(gn(.5)).connect(env); env.connect(gn(R(1.4,3.6))).connect(pan(R(-.85,.85))).connect(vbus);
      o.start(); nodes.push(o); let next=AC.currentTime+R(0,2.5);
      const phrase=()=>{ let t=Math.max(next,AC.currentTime+.05); const end=t+R(1.2,4);
        while(t<end){ const syl=R(.09,.22);
          env.gain.setTargetAtTime(R(.5,1),t,.02); env.gain.setTargetAtTime(0,t+syl*.7,.03);
          f1.frequency.setTargetAtTime(R(300,850),t,.03); f2.frequency.setTargetAtTime(R(900,2300),t,.03); o.frequency.setTargetAtTime(f0*R(.85,1.2),t,.05);
          t+=syl+(Math.random()<.15?R(.1,.3):R(.01,.05)); }
        next=t+R(.6,3.5); later(phrase,Math.max(50,(next-AC.currentTime-.6)*1000)); };
      phrase(); };
    for(let i=0;i<7;i++) voice();
    // footsteps: someone crossing the room, left to right or back
    const step=(t,pv,g0)=>{ const s=AC.createBufferSource(); s.buffer=nb("white"); const p=pan(pv); p.connect(room);
      const bp=filt("bandpass",R(160,320),1.2), g=gn(0); s.connect(bp).connect(g).connect(p);
      g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(g0,t+.004); g.gain.exponentialRampToValueAtTime(.001,t+R(.06,.11));
      const ck=filt("bandpass",R(1800,3500),2), cg=gn(0); s.connect(ck).connect(cg).connect(p);
      cg.gain.setValueAtTime(0,t+.02); cg.gain.linearRampToValueAtTime(g0*.35,t+.024); cg.gain.exponentialRampToValueAtTime(.001,t+.07);
      s.start(t,R(0,3)); s.stop(t+.16); };
    const walker=()=>{ const n=Math.round(R(6,14)), iv=R(.42,.6), dir=Math.random()<.5?-1:1, g0=R(4,8), t=AC.currentTime+.1;
      for(let k=0;k<n;k++){ const u=k/(n-1); step(t+k*iv+R(-.02,.02),dir*(-.9+1.8*u),g0*(.4+Math.sin(Math.PI*u)*.6)); }
      later(walker,R(2500,9000)); };
    later(walker,R(500,3000));
    // cups and spoons now and then
    const clink=()=>{ const t=AC.currentTime+.05, g=gn(0); g.connect(pan(R(-.7,.7))).connect(room);
      [[R(2400,3200),.5],[R(4200,5600),.3],[R(6500,7600),.15]].forEach(([f,a])=>{ const o=AC.createOscillator(); o.frequency.value=f; o.connect(gn(a)).connect(g); o.start(t); o.stop(t+.6); });
      g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(R(.08,.2),t+.002); g.gain.exponentialRampToValueAtTime(.001,t+R(.25,.5));
      later(clink,Math.random()<.35?R(150,400):R(5000,16000)); };
    later(clink,R(3000,8000));
  }
  return ()=>{ alive=false; timers.forEach(clearTimeout); nodes.forEach(n=>{ try{n.stop()}catch{} }); };
}
function ambStart(){
  ensureAudio(); if(!AC) return; if(S.settings.ambKind==="brown") S.settings.ambKind="cafe"; const kind=S.settings.ambKind||"rain";
  if(AMB.playing&&AMB.kind===kind) return; ambStop(true);
  const g=AC.createGain(); g.gain.value=0;
  const lim=AC.createDynamicsCompressor(); lim.threshold.value=-10; lim.knee.value=6; lim.ratio.value=12; lim.attack.value=.003; lim.release.value=.25;
  g.connect(lim).connect(AC.destination);
  const scene=ambScene(kind,g);
  g.gain.linearRampToValueAtTime(+S.settings.ambVol,AC.currentTime+1.2);
  Object.assign(AMB,{scene,gain:g,kind,playing:true}); ambUI();
}
function ambStop(quick){
  if(!AMB.playing) return; const {scene,gain}=AMB; const t=AC.currentTime;
  gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(gain.gain.value,t); gain.gain.linearRampToValueAtTime(0,t+(quick?.15:.8));
  setTimeout(()=>{ scene(); gain.disconnect(); },quick?200:900); AMB.playing=false; AMB.scene=null; ambUI();
}
function ambUI(){
  const on=AMB.playing, st=S.settings;
  $("#ambPlay").innerHTML=on?ICON_STOP:ICON_PLAY; $("#ambPlay").classList.toggle("on",on||AMB.want);
  $("#ambPlay").title=on?"Detener":"Reproducir"; $("#ambPlay").setAttribute("aria-label",on?"Detener sonido ambiente":"Reproducir sonido ambiente");
  document.querySelectorAll("[data-amb]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.amb===(st.ambKind==="brown"?"cafe":st.ambKind)));
  $("#ambVol").value=st.ambVol; $("#ambSync").checked=!!st.ambSync;
  const name=AMB_NAME[st.ambKind]||"Cafetería";
  $("#ambState").textContent=on?`Sonando: ${name}`:radNowName?`Radio: ${radNowName}`:AMB.want&&st.ambSync?"Espera el enfoque":"Detenido";
}
function syncAmbient(){ if(!AMB.want||!S.settings.ambSync) return; const should=T.running&&T.mode==="focus"; if(should&&!AMB.playing) ambStart(); else if(!should&&AMB.playing) ambStop(); }
$("#ambPlay").addEventListener("click",()=>{ if(AMB.playing||AMB.want&&S.settings.ambSync){ AMB.want=false; ambStop(); ambUI(); } else { AMB.want=true; if(S.settings.ambSync) syncAmbient(); else ambStart(); ambUI(); } });
document.querySelectorAll("[data-amb]").forEach(b=>b.addEventListener("click",()=>{ S.settings.ambKind=b.dataset.amb; commit(); if(AMB.playing){ ambStart(); } ambUI(); }));
$("#ambVol").addEventListener("input",e=>{ S.settings.ambVol=+e.target.value; if(AMB.playing) AMB.gain.gain.setTargetAtTime(+e.target.value,AC.currentTime,.05); });
$("#ambVol").addEventListener("change",()=>commit());
$("#ambSync").addEventListener("change",e=>{ S.settings.ambSync=e.target.checked; commit(); if(e.target.checked) { if(AMB.playing) AMB.want=true; syncAmbient(); } ambUI(); });

// In the published panel embeds are blocked, so items open in a new tab; the standalone copy flips EMBED and plays them here.
const EMBED=true;
function parseSpotify(u){
  u=u.trim(); let m=u.match(/^spotify:(track|album|playlist|artist|show|episode):([A-Za-z0-9]+)$/);
  if(!m) m=u.match(/^https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|album|playlist|artist|show|episode)\/([A-Za-z0-9]+)/);
  return m?{src:"sp",kind:m[1],sid:m[2],url:`https://open.spotify.com/${m[1]}/${m[2]}`}:null;
}
function parseYouTube(u){
  u=u.trim(); let x; try{ x=new URL(/^https?:/.test(u)?u:"https://"+u); }catch{ return null; }
  const h=x.hostname.replace(/^www\.|^m\.|^music\./,""), list=x.searchParams.get("list");
  let v=null;
  if(h==="youtu.be") v=x.pathname.slice(1).split("/")[0];
  else if(h==="youtube.com"||h==="youtube-nocookie.com"){ if(x.pathname==="/watch") v=x.searchParams.get("v"); else { const m=x.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{6,})/); if(m) v=m[1]; } }
  else return null;
  if(v&&!/^[\w-]{6,}$/.test(v)) v=null; const L=list&&/^[\w-]+$/.test(list)?list:null;
  if(!v&&!L) return null;
  return {src:"yt",kind:v?(L?"video+list":"video"):"playlist",vid:v,list:L,url:v?`https://www.youtube.com/watch?v=${v}${L?`&list=${L}`:""}`:`https://www.youtube.com/playlist?list=${L}`};
}
const SPK={track:"Canción",album:"Álbum",playlist:"Playlist",artist:"Artista",show:"Podcast",episode:"Episodio"};
const YTK={video:"Video","video+list":"Video de una lista",playlist:"Lista de YouTube"};
const ICON_SP='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 5.6c3-1 6.4-.8 9 .7M4.2 8.3c2.4-.7 5-.5 7.2.7M4.8 10.9c1.9-.5 3.8-.3 5.5.5"/></svg>';
const ICON_YT='<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z"/></svg>';
document.querySelectorAll(".srcbtn .blogo").forEach(b=>{ b.innerHTML=b.classList.contains("yt-l")?ICON_YT:ICON_SP; });
const isYT=m=>m.src==="yt";
const mName=m=>m.name||(isYT(m)?YTK[m.kind]||"YouTube":`${SPK[m.kind]||"Link"} de Spotify`);
let addSrc=null, shownKey=null;
function showAdd(src){ addSrc=addSrc===src?null:src; const f=$("#spAdd"); f.hidden=!addSrc; $("#spErr").hidden=true;
  document.querySelectorAll(".srcbtn").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.src===addSrc)));
  if(addSrc){ $("#spUrl").placeholder=addSrc==="yt"?"Pega un link de YouTube (video o lista)":"Pega un link de Spotify"; $("#spUrl").setAttribute("aria-label",$("#spUrl").placeholder); $("#ytMode").hidden=addSrc!=="yt"; $("#spUrl").focus(); } }
document.querySelectorAll(".srcbtn").forEach(b=>b.addEventListener("click",()=>showAdd(b.dataset.src)));
$("#spCancel").addEventListener("click",()=>{ $("#spUrl").value=""; $("#spName").value=""; showAdd(addSrc); });
function ytSrc(m,audio){ const q=`enablejsapi=1&autoplay=1&rel=0&playsinline=1${m.list?`&list=${m.list}`:""}`;
  return m.vid?`https://www.youtube-nocookie.com/embed/${m.vid}?${q}`:`https://www.youtube-nocookie.com/embed/videoseries?${q}`; }
function ytCmd(fn){ const f=$("#spPlayer iframe"); if(f&&f.contentWindow) f.contentWindow.postMessage(JSON.stringify({event:"command",func:fn,args:[]}),"*"); }
let ytPaused=false, ytWin=null;
// A page opened from disk sends no referrer, and YouTube refuses to embed without one (error 153),
// so the local copy plays YouTube in a small window of its own instead.
const YT_POP=EMBED&&location.protocol==="file:";
const ytUrl=m=>m.vid?`https://www.youtube.com/watch?v=${m.vid}${m.list?`&list=${m.list}`:""}`:`https://www.youtube.com/playlist?list=${m.list}`;
const ytOpen=()=>{ try{ return !!ytWin&&!ytWin.closed; }catch{ return false; } };
function ytPop(m){ const a=m.mode!=="video", w=a?400:760, h=a?280:470;
  if(ytOpen()) try{ ytWin.close(); }catch{}
  ytWin=window.open(ytUrl(m),"pp-yt",`popup,width=${w},height=${h},left=${Math.max(0,screen.availWidth-w-24)},top=${Math.max(0,screen.availHeight-h-48)}`);
  if(!ytWin){ toast("Tu navegador bloqueó la ventana de YouTube. Permite ventanas emergentes para este archivo."); return false; }
  return true; }
function ytClose(){ if(ytOpen()) try{ ytWin.close(); }catch{} ytWin=null; }
if(YT_POP) setInterval(()=>{ const cur=S.music.find(m=>m.id===S.settings.musCur); if(cur&&isYT(cur)&&!ytOpen()){ S.settings.musCur=null; commit(); } },1500);
function renderPlayer(){
  const pl=$("#spPlayer"); if(!EMBED){ pl.hidden=true; return; }
  const cur=S.music.find(m=>m.id===S.settings.musCur);
  if(!cur){ pl.hidden=true; pl.innerHTML=""; shownKey=null; return; }
  const audio=isYT(cur)&&cur.mode!=="video", key=cur.id+"|"+(isYT(cur)?(audio?"a":"v"):"");
  if(shownKey===key) return; shownKey=key; pl.hidden=false; ytPaused=false; pl.classList.toggle("audio",audio);
  if(!isYT(cur)){ const tall=!(cur.kind==="track"||cur.kind==="episode");
    pl.innerHTML=`<iframe title="Reproductor de Spotify" src="https://open.spotify.com/embed/${cur.kind}/${cur.url.split("/").pop()}?utm_source=generator&theme=0" height="${tall?352:152}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`; return; }
  if(YT_POP){ pl.classList.add("audio");
    pl.innerHTML=`<div class="ytbar"><span class="blogo yt-l">${ICON_YT}</span><span class="nm" title="${esc(mName(cur))}">${ic(audio?"head":"tv")} ${esc(mName(cur))} <span class="meta" style="margin:0">Sonando en una ventana de YouTube</span></span>
      <button class="btn sm" type="button" data-yt="show">Mostrar</button><button class="btn sm" type="button" data-yt="${audio?"video":"audio"}">${audio?ic("tv")+" Ver video":ic("head")+" Solo escuchar"}</button></div>`; return; }
  const fr=`<iframe title="Reproductor de YouTube" class="${audio?"ythide":"ytv"}" src="${ytSrc(cur)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
  pl.innerHTML=audio?`<div class="ytbar"><span class="blogo yt-l">${ICON_YT}</span><span class="nm" title="${esc(mName(cur))}">${ic("head")} ${esc(mName(cur))}</span>
      <button class="btn sm" type="button" data-yt="toggle">Pausar</button><button class="btn sm" type="button" data-yt="video">Ver video</button></div>${fr}`
    :fr+`<div style="display:flex;justify-content:flex-end;margin-top:6px"><button class="btn sm" type="button" data-yt="audio">${ic("head")} Solo escuchar</button></div>`;
}
$("#spPlayer").addEventListener("click",e=>{ const b=e.target.closest("[data-yt]"); if(!b) return; const cur=S.music.find(m=>m.id===S.settings.musCur); if(!cur) return;
  if(b.dataset.yt==="show"){ if(ytOpen()) ytWin.focus(); else ytPop(cur); return; }
  if(b.dataset.yt==="toggle"){ ytPaused=!ytPaused; ytCmd(ytPaused?"pauseVideo":"playVideo"); b.textContent=ytPaused?"Reanudar":"Pausar"; return; }
  cur.mode=b.dataset.yt; if(YT_POP) ytPop(cur); commit(); });
function renderMusic(){
  if(EMBED&&S.settings.musCur&&!S.music.some(m=>m.id===S.settings.musCur)) S.settings.musCur=null;
  if(YT_POP){ const c=S.music.find(m=>m.id===S.settings.musCur); if(c&&isYT(c)&&!ytOpen()) S.settings.musCur=null; if(!c||!isYT(c)) ytWin&&ytClose(); }
  const curId=EMBED?S.settings.musCur:null;
  $("#spList").innerHTML=S.music.length?S.music.map(m=>{ const yt=isYT(m), on=curId===m.id;
    const play=EMBED?(on?`<button class="btn sm" type="button" data-mstop>Detener</button>`:`<button class="btn sm" type="button" data-mplay>${ICON_PLAY_TXT} Reproducir</button>`)
      :`<a class="btn sm" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">Abrir en ${yt?"YouTube":"Spotify"}</a>`;
    return `<li class="sp ${yt?"yt":""} ${on?"cur":""}" data-id="${m.id}"><span class="blogo ${yt?"yt-l":"sp-l"}">${yt?ICON_YT:ICON_SP}</span>
    <div style="min-width:0"><div class="nm">${esc(mName(m))}</div><div class="meta" style="margin:0">${yt?(m.mode==="video"?"YouTube · ver video":"YouTube · solo audio"):("Spotify"+(m.name?` · ${SPK[m.kind]||""}`:""))}</div></div>
    <div class="acts">${play}<button class="icon" type="button" data-spdel aria-label="Quitar" title="Quitar">${ic("x")}</button></div></li>`; }).join("")
    :`<li class="empty">Toca Spotify o YouTube para agregar una playlist, álbum o video.</li>`;
  renderPlayer();
}
const ICON_PLAY_TXT="▶";
$("#spAdd").addEventListener("submit",e=>{ e.preventDefault(); const r=addSrc==="yt"?parseYouTube($("#spUrl").value):parseSpotify($("#spUrl").value);
  if(!r){ $("#spErr").textContent=addSrc==="yt"?"Ese link no parece de YouTube. Copia el link del video o de la lista.":"Ese link no parece de Spotify. Cópialo desde Compartir, Copiar enlace."; $("#spErr").hidden=false; return; }
  $("#spErr").hidden=true; const it={id:uid(),...r,name:$("#spName").value.trim()}; delete it.sid;
  if(r.src==="yt") it.mode=(document.querySelector('input[name="ytm"]:checked')||{}).value||"audio";
  S.music.push(it); if(EMBED&&(!YT_POP||!isYT(it)||ytPop(it))) S.settings.musCur=it.id;
  $("#spUrl").value=""; $("#spName").value=""; showAdd(addSrc); commit(); toast(EMBED?"Agregado y sonando":"Link agregado"); });
$("#spList").addEventListener("click",e=>{ const li=e.target.closest(".sp"); if(!li) return; const id=li.dataset.id, m=S.music.find(x=>x.id===id); if(!m) return;
  if(e.target.closest("[data-mplay]")){ if(YT_POP&&isYT(m)&&!ytPop(m)) return; S.settings.musCur=id; commit(); return; }
  if(e.target.closest("[data-mstop]")){ S.settings.musCur=null; commit(); return; }
  if(e.target.closest("[data-spdel]")){ const i=S.music.indexOf(m); S.music.splice(i,1); if(S.settings.musCur===id) S.settings.musCur=null; commit(); toast(`"${mName(m)}" quitado`); }
});

// ---------- floating window: always-on-top mini timer ----------
// Document Picture-in-Picture (Chrome/Edge, top-level pages) gives a live mini panel;
// elsewhere fall back to video Picture-in-Picture drawn from a canvas.
let pipWin=null, pipVideo=null, pipCanvas=null;
const PIP_AC={focus:"#e8664c",short:"#5fb38c",long:"#6c9bd6"};
const PIP_NAME={focus:"Concentración",short:"Pausa corta",long:"Pausa larga"};
const PIP_CSS=`*{box-sizing:border-box}html,body{margin:0;height:100%}
body{font-family:"IBM Plex Sans",system-ui,sans-serif;background:#1d2024;color:#eef2ef;overflow:hidden;--ac:#e8664c;display:flex;align-items:center}
body[data-mode=short]{--ac:#5fb38c}body[data-mode=long]{--ac:#6c9bd6}
.m{display:flex;align-items:center;gap:14px;width:100%;padding:0 14px}
.ring{position:relative;flex:none;width:56px;height:56px}
.ring svg{position:absolute;inset:0;transform:rotate(-90deg)}
.ring circle{fill:none;stroke-width:4}.ring .bg{stroke:#363b41}.ring .fg{stroke:var(--ac);stroke-linecap:round;transition:stroke-dashoffset .25s linear}
.ring button{position:absolute;inset:8px;border-radius:50%;border:0;background:transparent;color:var(--ac);display:grid;place-items:center;cursor:pointer}
.ring button:hover{background:#2a2f35}
.ring button svg{position:static;transform:none;width:20px;height:20px;fill:currentColor}
.c{flex:1;min-width:0}
.time{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:40px;font-weight:500;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.task{margin-top:6px;font-size:13px;color:#aeb6b1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.task i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ac);margin-right:6px;vertical-align:1px}
.task b{color:#d9dfdb;font-weight:500}
.next{margin-top:3px;padding-left:14px;font-size:11.5px;color:#838c87;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.next:empty{display:none}
.stop{flex:none;width:40px;height:40px;border-radius:10px;border:1px solid #3a4047;background:#262a2f;color:#cfd5d1;display:grid;place-items:center;cursor:pointer}
.stop:hover{background:#30353b}.stop svg{width:14px;height:14px;fill:currentColor}`;
const PIP_PLAY=`<svg viewBox="0 0 16 16"><path d="M5 3.2v9.6L12.6 8z"/></svg>`, PIP_PAUSE=`<svg viewBox="0 0 16 16"><rect x="4" y="3" width="3" height="10" rx=".8"/><rect x="9" y="3" width="3" height="10" rx=".8"/></svg>`;
// the task in progress, or the last one started when the timer is paused
function floatTask(){ const t=(T.track&&taskById(T.track.id))||(S.activeTaskId&&taskById(S.activeTaskId)); return t&&!t.completed?t.title:null; }
function floatNext(){ if(T.mode!=="focus") return null; const t=(T.track&&taskById(T.track.id))||(S.activeTaskId&&taskById(S.activeTaskId)); const x=t&&!t.completed?(t.todos||[]).find(y=>!y.done):null; return x?x.text:null; }
function floatLine(){ const tk=floatTask(); return T.mode==="focus"?(tk||"Sin tarea"):PIP_NAME[T.mode]+(T.running?"":" · En pausa"); }
async function openFloat(){
  if(pipWin){ pipWin.close(); return; }
  if(pipVideo&&document.pictureInPictureElement){ document.exitPictureInPicture().catch(()=>{}); return; }
  ensureAudio();
  if("documentPictureInPicture" in window && window.top===window){
    try{
      pipWin=await documentPictureInPicture.requestWindow({width:340,height:124});
      const d=pipWin.document; const st=d.createElement("style"); st.textContent=PIP_CSS; d.head.appendChild(st); d.title="Pomodoro";
      d.body.innerHTML=`<div class="m"><div class="ring"><svg viewBox="0 0 56 56"><circle class="bg" cx="28" cy="28" r="25"/><circle class="fg" id="pr" cx="28" cy="28" r="25" stroke-dasharray="157.08"/></svg>
        <button id="pp" type="button"></button></div><div class="c"><div class="time" id="pt"></div><div class="task" id="pk"></div><div class="next" id="pn"></div></div>
        <button class="stop" id="ps" type="button" title="Detener y reiniciar" aria-label="Detener y reiniciar"><svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="2"/></svg></button></div>`;
      d.getElementById("pp").onclick=()=>T.running?pause():start();
      d.getElementById("ps").onclick=()=>reset();
      pipWin.addEventListener("pagehide",()=>{ pipWin=null; $("#floatBtn").classList.remove("on"); });
      $("#floatBtn").classList.add("on"); tick(); return;
    }catch(e){ pipWin=null; }
  }
  if(document.pictureInPictureEnabled){
    try{
      if(!pipVideo){ pipCanvas=document.createElement("canvas"); pipCanvas.width=680; pipCanvas.height=220;
        pipVideo=document.createElement("video"); pipVideo.muted=true; pipVideo.playsInline=true;
        pipVideo.style.cssText="position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;left:0";
        document.body.appendChild(pipVideo); pipVideo.srcObject=pipCanvas.captureStream(4);
        pipVideo.addEventListener("leavepictureinpicture",()=>$("#floatBtn").classList.remove("on"));
        if("mediaSession" in navigator){ try{ navigator.mediaSession.setActionHandler("play",()=>start()); navigator.mediaSession.setActionHandler("pause",()=>pause()); }catch{} } }
      drawFloat(); await pipVideo.play(); await pipVideo.requestPictureInPicture(); $("#floatBtn").classList.add("on"); tick(); return;
    }catch(e){}
  }
  toast("Este navegador no permite ventanas flotantes aquí. Prueba la copia local en Chrome o Edge.");
}
function drawFloat(txt,frac){
  if(txt===undefined){ const s=Math.ceil(left()/1000); txt=String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0"); frac=1-left()/durMs(T.mode); }
  const c=pipCanvas.getContext("2d"), W=680, H=220, ac=PIP_AC[T.mode], f=Math.min(1,Math.max(0,frac)), cx=110, cy=H/2;
  c.fillStyle="#1d2024"; c.fillRect(0,0,W,H);
  c.lineWidth=9; c.lineCap="round"; c.strokeStyle="#363b41"; c.beginPath(); c.arc(cx,cy,62,0,Math.PI*2); c.stroke();
  if(f>0){ c.strokeStyle=ac; c.beginPath(); c.arc(cx,cy,62,-Math.PI/2,-Math.PI/2+Math.PI*2*f); c.stroke(); }
  c.fillStyle=ac;
  if(T.running){ c.fillRect(cx-17,cy-24,12,48); c.fillRect(cx+5,cy-24,12,48); }
  else{ c.beginPath(); c.moveTo(cx-14,cy-26); c.lineTo(cx-14,cy+26); c.lineTo(cx+24,cy); c.closePath(); c.fill(); }
  const nx=floatNext(), dy=nx?-14:0, fit=(l,w)=>{ let cut=false; while(c.measureText(l+(cut?"…":"")).width>w&&l.length>4){ l=l.slice(0,-1); cut=true; } return l+(cut?"…":""); };
  c.textAlign="left"; c.textBaseline="alphabetic"; c.fillStyle="#eef2ef"; c.font="500 92px ui-monospace,Menlo,monospace"; c.fillText(txt,206,118+dy);
  c.fillStyle=ac; c.beginPath(); c.arc(214,160+dy,8,0,Math.PI*2); c.fill();
  c.fillStyle="#aeb6b1"; c.font="28px system-ui,sans-serif"; c.fillText(fit(floatLine(),W-250),232,170+dy);
  if(nx){ c.fillStyle="#838c87"; c.font="23px system-ui,sans-serif"; c.fillText(fit(nx,W-250),232,198); }
  if("mediaSession" in navigator) try{ navigator.mediaSession.playbackState=T.running?"playing":"paused"; }catch{}
}
function updateFloat(txt,label,frac){
  if(pipWin){ const d=pipWin.document, g=id=>d.getElementById(id); if(!g("pt")) return;
    d.body.dataset.mode=T.mode; g("pt").textContent=txt; d.title=txt+" · Pomodoro";
    g("pr").style.strokeDashoffset=157.08*(1-Math.min(1,Math.max(0,frac)));
    const tk=floatTask(); g("pk").innerHTML=`<i></i>`+(T.mode==="focus"&&tk?`<b>${esc(tk)}</b>`:esc(floatLine()));
    const nx=floatNext(); g("pn").textContent=nx||""; g("pn").title=nx||"";
    g("pp").innerHTML=T.running?PIP_PAUSE:PIP_PLAY; g("pp").setAttribute("aria-label",T.running?"Pausar":"Iniciar"); }
  if(pipCanvas&&document.pictureInPictureElement===pipVideo) drawFloat(txt,frac);
}
$("#floatBtn").addEventListener("click",openFloat);

// ---------- bitácora: one rich-text page per day ----------
// Days live in this browser and, when the account db is available, one private doc per day
// (data/users/<id>/journal/days/<YYYY-MM-DD>) so the panel doc stays small. Newest updatedAt wins;
// deleted days stay as tombstones so another device does not bring them back.
const LJ="pomodoro-journal-v1", JDAY=/^\d{4}-\d{2}-\d{2}$/;
const MESES=["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
function normJ(x){ const d=x&&typeof x==="object"&&x.days&&typeof x.days==="object"?x.days:{}, out={};
  for(const k in d){ const v=d[k]; if(JDAY.test(k)&&v&&typeof v.html==="string") out[k]={html:v.html,updatedAt:+v.updatedAt||0,...(v.deleted?{deleted:true}:{})}; }
  return {days:out}; }
let J=normJ(lsGet(LJ));
const jLive=k=>{ const d=J.days[k]; return !!d&&!d.deleted; };
const jDays=(j=J)=>Object.keys(j.days).filter(k=>!j.days[k].deleted).sort();
const jToday=()=>dayKey(Date.now());
let jCur=jToday(), jCol=null, jDirty=new Set(), jFlushT=null, jLsT=null, jEdited=false;
const jEd=$("#jEd");
const jSet=t=>{ $("#jState").textContent=t; };

// highlighter and text colors: only these palette values survive cleaning
const jRgb=v=>{ if(!v) return ""; const m=String(v).match(/^#([0-9a-f]{6})$/i); if(m){ const n=parseInt(m[1],16); return `rgb(${n>>16}, ${n>>8&255}, ${n&255})`; } return String(v).replace(/\s+/g,"").replace(/,/g,", "); };
const J_HL=new Set(["#ffe066","#a9f0a0","#ffc2d4","#a5d8ff","#ffd8a8"].map(jRgb)), J_TC=new Set(["#e03131","#e8590c","#2f9e44","#1c7ed6","#9c36b5"].map(jRgb));
// tags: #chips inside the text; projects come from the tasks, other tags live in settings.jtags
const jTagName=t=>String(t||"").replace(/[<>"#\/]/g,"").replace(/\s+/g," ").trim().slice(0,40);
const jHue=t=>{ let h=0; for(const ch of fold(t)) h=(h*31+ch.charCodeAt(0))%360; return h; };
function jTagEl(t,el){ el=el||document.createElement("span"); el.className="jtag"; el.setAttribute("data-tag",t); el.setAttribute("contenteditable","false");
  el.setAttribute("style","--th:"+jHue(t)); el.title="Clic para ver todo lo marcado con este tag"; el.textContent="#"+t; return el; }
// stored HTML is cleaned to a few formatting tags before it reaches the editor
const J_TAGS=new Set(["B","STRONG","I","EM","U","S","STRIKE","DIV","P","BR","UL","OL","LI","SPAN","FONT","A","PRE","TABLE","THEAD","TBODY","TR","TH","TD"]);
// code block text: line breaks kept, formatting dropped
function jPreText(n){ let o=""; (function w(x){ x.childNodes.forEach(c=>{ if(c.nodeType===3){ o+=c.data; return; } if(c.nodeType!==1) return; if(c.tagName==="BR"){ o+="\n"; return; } const blk=/^(DIV|P|LI|PRE)$/.test(c.tagName); if(blk&&o&&!o.endsWith("\n")) o+="\n"; w(c); if(blk&&!o.endsWith("\n")) o+="\n"; }); })(n); return o; }
function jClean(html){
  const doc=new DOMParser().parseFromString("<body>"+String(html||"")+"</body>","text/html");
  (function walk(n){ [...n.childNodes].forEach(c=>{
    if(c.nodeType===3) return; if(c.nodeType!==1){ c.remove(); return; }
    if(c.tagName==="PRE"){ let t=jPreText(c); [...c.attributes].forEach(a=>c.removeAttribute(a.name)); c.className="jcode"; c.textContent=t; if(!t) c.innerHTML="<br>"; else if(t.endsWith("\n")) c.appendChild(document.createElement("br")); return; }
    walk(c);
    if(/^(SCRIPT|STYLE|TEMPLATE|IFRAME|OBJECT|EMBED|NOSCRIPT|TITLE|HEAD)$/.test(c.tagName)){ c.remove(); return; }
    if(!J_TAGS.has(c.tagName)){ c.replaceWith(...c.childNodes); return; }
    if(c.tagName==="SPAN"&&c.classList.contains("jtask")){ const id=String(c.getAttribute("data-task")||"").replace(/[^a-z0-9]/gi,"");
      [...c.attributes].forEach(a=>c.removeAttribute(a.name)); if(!id){ c.remove(); return; }
      c.className="jtask"; c.setAttribute("data-task",id); c.setAttribute("contenteditable","false"); c.textContent="↗ tarea"; return; }
    if(c.tagName==="SPAN"&&c.classList.contains("jtag")){ const t=jTagName(c.getAttribute("data-tag")||c.textContent.replace(/^#/,""));
      [...c.attributes].forEach(a=>c.removeAttribute(a.name)); if(!t){ c.replaceWith(...c.childNodes); return; }
      jTagEl(t,c); return; }
    if(c.tagName==="UL"&&c.classList.contains("jchk")){ [...c.attributes].forEach(a=>c.removeAttribute(a.name)); c.className="jchk"; return; }
    if(c.tagName==="LI"&&c.classList.contains("ok")&&c.parentElement&&c.parentElement.classList.contains("jchk")){ [...c.attributes].forEach(a=>c.removeAttribute(a.name)); c.className="ok"; return; }
    if(/^(TABLE|THEAD|TBODY|TR|TH|TD)$/.test(c.tagName)){ const wide=c.classList.contains("wide"); [...c.attributes].forEach(a=>c.removeAttribute(a.name)); if(c.tagName==="TABLE") c.className="jtable"+(wide?" wide":""); if((c.tagName==="TD"||c.tagName==="TH")&&!c.childNodes.length) c.appendChild(document.createElement("br")); return; }
    if(c.tagName==="A"&&c.classList.contains("jlink")){ const u=normUrl(c.getAttribute("href")), nm=c.textContent.replace(/^📎\s*/,"").trim(); [...c.attributes].forEach(a=>c.removeAttribute(a.name)); if(!u){ c.replaceWith(document.createTextNode(nm)); return; }
      c.className="jlink"; c.setAttribute("href",u); c.setAttribute("target","_blank"); c.setAttribute("rel","noopener noreferrer"); c.setAttribute("contenteditable","false"); c.setAttribute("title",u); c.textContent="📎 "+(nm||linkName(u)); return; }
    const sz=c.tagName==="FONT"&&/^[235]$/.test(c.getAttribute("size")||"")?c.getAttribute("size"):null;
    const href=c.tagName==="A"&&/^https?:\/\//i.test(c.getAttribute("href")||"")?c.getAttribute("href"):null;
    const bg=J_HL.has(jRgb(c.style.backgroundColor))?c.style.backgroundColor:"", fg=J_TC.has(jRgb(c.style.color||c.getAttribute("color")||""))?(c.style.color||c.getAttribute("color")):"";
    [...c.attributes].forEach(a=>c.removeAttribute(a.name));
    if(sz) c.setAttribute("size",sz);
    if(bg) c.style.backgroundColor=bg; if(fg) c.style.color=fg;
    if(c.tagName==="SPAN"&&!c.attributes.length){ c.replaceWith(...c.childNodes); return; }
    if(href){ c.setAttribute("href",href); c.setAttribute("target","_blank"); c.setAttribute("rel","noopener noreferrer"); c.setAttribute("title","Ctrl + clic para abrir"); }
  }); })(doc.body);
  return doc.body.innerHTML;
}
// plain text with line breaks and tabs, as Notepad++ would show it
function jText(src){
  let root=src; if(typeof src==="string"){ root=document.createElement("div"); root.innerHTML=jClean(src); }
  let out="";
  const nl=()=>{ if(out&&!out.endsWith("\n")) out+="\n"; };
  (function walk(n){ n.childNodes.forEach(c=>{
    if(c.nodeType===3){ out+=c.data; return; } if(c.nodeType!==1||(c.classList&&c.classList.contains("jtask"))) return;
    const tg=c.tagName;
    if(tg==="BR"){ out+="\n"; return; }
    if(tg==="PRE"){ nl(); out+=jPreText(c).replace(/\n$/,""); nl(); return; }
    if(tg==="TABLE"){ nl(); c.querySelectorAll("tr").forEach(tr=>{ out+=[...tr.children].map(td=>jPreText(td).replace(/\s*\n\s*/g," ").trim()).join("\t")+"\n"; }); return; }
    const block=tg==="DIV"||tg==="P"||tg==="LI"||tg==="UL"||tg==="OL";
    if(block) nl();
    if(tg==="LI"){ const p=c.parentElement; out+=p&&p.tagName==="OL"?([...p.children].indexOf(c)+1)+". ":p&&p.classList.contains("jchk")?(c.classList.contains("ok")?"[x] ":"[ ] "):"• "; }
    walk(c);
    if(block) nl();
  }); })(root);
  return out.replace(/\n{3,}/g,"\n\n").replace(/\n$/,"");
}
function jLinkify(root){
  const re=/https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]]/g, nodes=[];
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  while(w.nextNode()){ const t=w.currentNode; if(!t.parentElement.closest("a,pre")&&re.test(t.data)) nodes.push(t); re.lastIndex=0; }
  nodes.forEach(t=>{ const f=document.createDocumentFragment(); let last=0; t.data.replace(re,(m,i)=>{
      if(i>last) f.append(t.data.slice(last,i));
      const a=document.createElement("a"); a.href=m; a.target="_blank"; a.rel="noopener noreferrer"; a.title="Ctrl + clic para abrir"; a.textContent=m; f.append(a); last=i+m.length; return m; });
    if(last<t.data.length) f.append(t.data.slice(last)); t.replaceWith(f); });
  return nodes.length>0;
}
function jLabel(k,long){ const [y,m,d]=k.split("-").map(Number), dt=new Date(y,m-1,d);
  const s=dt.toLocaleDateString("es",long?{weekday:"long",day:"numeric",month:"long"}:{weekday:"short",day:"numeric",month:"short"});
  return (k===jToday()?"Hoy · ":"")+s+(y!==new Date().getFullYear()?" "+y:""); }
function jTitle(k,prefix){ const [,m,d]=k.split("-").map(Number); const ms=MESES[m-1]; return `${prefix} ${d} de ${ms[0].toUpperCase()+ms.slice(1)}`; }
function jPrevDay(k){ return jDays().filter(x=>x<k&&J.days[x].html.trim()).pop()||null; }
function jTemplate(k,heads){
  const pk=jPrevDay(k); let prefix="MODIFICACIONES", hs=[];
  if(pk){ const lines=jText(J.days[pk].html).split("\n"), first=lines.find(l=>l.trim());
    const m=first&&first.trim().match(/^(.*?)\s*\b\d{1,2}\s+de\s+\S+/i); if(m&&m[1].trim()) prefix=m[1].trim();
    if(heads) hs=lines.filter(l=>/^\d+\s*[.)-]\s*\S/.test(l)).map(l=>l.trim()); }
  return `<div><font size="5"><b>${esc(jTitle(k,prefix))}</b></font></div><div>------------------------------------------------------------</div><div><br></div>`
    +(hs.length?hs.map(h=>`<div><b>${esc(h)}</b></div><div>\t</div><div><br></div>`).join(""):"<div><br></div>");
}

// ---- persistence ----
function jStore(k){ if(!jEdited||k!==jCur) return; jEdited=false;
  const html=jEd.innerHTML, empty=!jEd.textContent.trim();
  J.days[k]=empty&&!jEd.querySelector("li")?{html:"",updatedAt:Date.now(),deleted:true}:{html,updatedAt:Date.now()};
  if(html.length>200000) toast("Este día está muy largo; considera seguir en un día nuevo.");
  lsSet(LJ,J); jDirty.add(k); jFlushSoon(); }
function jSaveNow(){ clearTimeout(jLsT); jStore(jCur); }
function jFlushSoon(){ if(!jCol){ jSet("Guardado en este navegador"); return; } jSet("Guardando…"); clearTimeout(jFlushT); jFlushT=setTimeout(jFlush,1200); }
async function jFlush(){ if(!jCol) return; const ks=[...jDirty]; jDirty.clear(); let ok=true;
  for(const k of ks){ const d=J.days[k]; if(!d) continue;
    try{ await jCol.doc(k).set(d.deleted?{html:"",updatedAt:d.updatedAt,deleted:true}:{html:d.html,updatedAt:d.updatedAt}); }
    catch(e){ ok=false; jDirty.add(k); } }
  jSet(ok?"Guardado en tu cuenta":"Guardado solo en este navegador"); if(!ok){ clearTimeout(jFlushT); jFlushT=setTimeout(jFlush,8000); } }
function jImport(jx){ const now=Date.now();
  for(const k in J.days) if(!jx.days[k]){ J.days[k]={html:"",updatedAt:now,deleted:true}; jDirty.add(k); }
  for(const k in jx.days){ J.days[k]={...jx.days[k],updatedAt:now}; jDirty.add(k); }
  lsSet(LJ,J); jEdited=false; jOpen(jCur); jFlushSoon(); }

// ---- view ----
function jDayList(){ const ks=[...new Set([...jDays(),jToday(),jCur,...S.tasks.filter(t=>t.completed&&t.completedAt).map(t=>dayKey(t.completedAt))])].sort().reverse();
  $("#jDay").innerHTML=ks.map(k=>`<option value="${k}" ${k===jCur?"selected":""}>${esc(jLabel(k))}${jLive(k)||k===jCur?"":""}</option>`).join("");
  const asc=ks.slice().reverse(), i=asc.indexOf(jCur); $("#jPrev").disabled=i<=0; $("#jNext").disabled=i<0||i>=asc.length-1; }
function jOpen(k){ jSaveNow(); jCur=k; const live=jLive(k);
  jEd.hidden=!live; $("#jTools").hidden=!live; $("#jEmpty").hidden=live;
  if(live){ jEd.innerHTML=jClean(J.days[k].html); jLinkify(jEd); }
  else { jEd.innerHTML=""; const pk=jPrevDay(k); $("#jStartHeads").hidden=!pk; $("#jEmptyMsg").textContent=k===jToday()?"Aún no empiezas la bitácora de hoy.":`No hay bitácora para el ${jLabel(k,true)}.`;
    $("#jStartHeads").textContent=pk?`Empezar con los encabezados del ${jLabel(pk,true).replace("Hoy · ","")}`:""; }
  jDayList(); jClosedRender(); }
function jStart(heads){ J.days[jCur]={html:jTemplate(jCur,heads),updatedAt:Date.now()}; lsSet(LJ,J); jDirty.add(jCur); jFlushSoon(); jOpen(jCur);
  // caret at the end of the first section, ready to type
  const tabs=[...jEd.querySelectorAll("div")].filter(d=>d.textContent==="\t"); const tgt=tabs[0]||jEd.lastElementChild||jEd;
  jEd.focus(); const r=document.createRange(); r.selectNodeContents(tgt); r.collapse(false); const sl=getSelection(); sl.removeAllRanges(); sl.addRange(r); }
$("#jStartHeads").addEventListener("click",()=>jStart(true));
$("#jStartBlank").addEventListener("click",()=>jStart(false));
$("#jDay").addEventListener("change",e=>jOpen(e.target.value));
$("#jToday").addEventListener("click",()=>jOpen(jToday()));
$("#jPick").addEventListener("click",e=>{ const i=e.target; i.max=jToday(); i.value=jCur; try{ i.showPicker(); }catch{} });
$("#jPick").addEventListener("change",e=>{ const v=e.target.value; if(!JDAY.test(v)) return; if(v>jToday()){ toast("Elige hoy o un día anterior."); return; } jOpen(v); });
function jStep(d){ const asc=[...new Set([...jDays(),jToday(),jCur,...S.tasks.filter(t=>t.completed&&t.completedAt).map(t=>dayKey(t.completedAt))])].sort(), i=asc.indexOf(jCur)+d; if(i>=0&&i<asc.length) jOpen(asc[i]); }
$("#jPrev").addEventListener("click",()=>jStep(-1));
$("#jNext").addEventListener("click",()=>jStep(1));

// ---- editing ----
jEd.addEventListener("input",()=>{ jEdited=true; jSet("Escribiendo…"); clearTimeout(jLsT); jLsT=setTimeout(()=>jStore(jCur),500); });
jEd.addEventListener("blur",()=>{ if(jLinkify(jEd)) jEdited=true; jSaveNow(); });
jEd.addEventListener("paste",e=>{ const t=e.clipboardData&&e.clipboardData.getData("text/plain"); if(t==null) return; e.preventDefault(); document.execCommand("insertText",false,t); });
jEd.addEventListener("keydown",e=>{
  if(e.key==="Tab"){ e.preventDefault(); const sel=getSelection(), n=sel.anchorNode, li=n&&(n.nodeType===1?n:n.parentElement).closest("li");
    if(li&&jEd.contains(li)) document.execCommand(e.shiftKey?"outdent":"indent");
    else if(!e.shiftKey) document.execCommand("insertText",false,"\t");
    else { // shift+tab removes one leading tab from the current line
      const r=sel.rangeCount&&sel.getRangeAt(0); const t=r&&r.startContainer.nodeType===3?r.startContainer:null;
      if(t){ const ls=t.data.lastIndexOf("\n",r.startOffset-1)+1; if(t.data[ls]==="\t"){ t.deleteData(ls,1); jEdited=true; jEd.dispatchEvent(new Event("input")); } } }
    return; }
  if((e.ctrlKey||e.metaKey)&&e.shiftKey&&(e.key==="H"||e.key==="h")){ e.preventDefault(); jColor("hiliteColor","#ffe066"); return; }
  if(e.key==="Escape"&&!$("#jHlPop").hidden){ e.preventDefault(); jHlShow(false); return; }
  if(e.key==="Escape"&&$("#journal").classList.contains("side")){ e.preventDefault(); jEd.blur(); jSideClose(); }
});
// ---------- code blocks ----------
const jPreOf=n=>{ const el=n&&(n.nodeType===1?n:n.parentElement); const p=el&&el.closest("pre"); return p&&jEd.contains(p)?p:null; };
function jCaretIn(el,atEnd){ const r=document.createRange(); r.selectNodeContents(el); r.collapse(!atEnd); const sel=getSelection(); sel.removeAllRanges(); sel.addRange(r); }
function jNewLineAfter(el){ const d=document.createElement("div"); d.appendChild(document.createElement("br")); el.after(d); jCaretIn(d,false); return d; }
function jCode(){
  if(document.activeElement!==jEd) jEd.focus();
  const sel=getSelection(); if(!sel.rangeCount||!jEd.contains(sel.anchorNode)){ jCaretIn(jEd,true); }
  const r=getSelection().getRangeAt(0); if(jPreOf(r.startContainer)){ toast("Ya estás dentro de un bloque de código."); return; }
  const pre=document.createElement("pre"); pre.className="jcode";
  // top-level line holding the cursor
  let blk=r.startContainer.nodeType===1?r.startContainer:r.startContainer.parentElement;
  while(blk&&blk!==jEd&&blk.parentElement!==jEd) blk=blk.parentElement;
  if(!r.collapsed){ const d=document.createElement("div"); d.appendChild(r.cloneContents()); const t=jText(d); r.deleteContents(); pre.textContent=t||""; }
  if(!pre.textContent) pre.appendChild(document.createElement("br"));
  if(!blk||blk===jEd){ jEd.appendChild(pre); }
  else if(r.collapsed&&!blk.textContent.trim()&&!blk.querySelector(".jtask,.jtag")) blk.replaceWith(pre);
  else blk.after(pre);
  if(!pre.nextSibling) { const d=document.createElement("div"); d.appendChild(document.createElement("br")); pre.after(d); }
  jCaretIn(pre,!!pre.textContent);
  jEdited=true; jEd.dispatchEvent(new Event("input"));
}
$("#jCodeBtn").addEventListener("click",jCode);
jEd.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.shiftKey&&(e.key==="K"||e.key==="k")){ e.preventDefault(); e.stopPropagation(); jCode(); return; }
  const sel=getSelection(); if(!sel.rangeCount) return; const r=sel.getRangeAt(0), pre=jPreOf(r.startContainer);
  if(e.key==="Enter"&&!pre&&!e.shiftKey){ // ``` + Enter starts a code block
    let blk=r.startContainer.nodeType===1?r.startContainer:r.startContainer.parentElement;
    while(blk&&blk!==jEd&&blk.parentElement!==jEd) blk=blk.parentElement;
    const line=blk&&blk!==jEd?blk.textContent:(r.startContainer.nodeType===3?r.startContainer.data.split("\n").pop():"");
    if(/^\s*```\s*$/.test(line)){ e.preventDefault();
      if(blk&&blk!==jEd){ blk.textContent=""; blk.appendChild(document.createElement("br")); jCaretIn(blk,false); }
      else if(r.startContainer.nodeType===3){ const t=r.startContainer, i=t.data.lastIndexOf("```"); t.deleteData(i,3); }
      jCode(); }
    return; }
  if(!pre) return;
  if(e.key==="Enter"){ e.preventDefault();
    const txt=jPreText(pre), atEnd=(()=>{ const t=document.createRange(); t.selectNodeContents(pre); t.setStart(r.endContainer,r.endOffset); return !t.toString().replace(/\n$/,"").length; })();
    // Enter on an empty last line leaves the block
    if(atEnd&&/\n\n?$/.test(txt)&&txt.trim()){ while(pre.lastChild&&(pre.lastChild.nodeName==="BR"||(pre.lastChild.nodeType===3&&!pre.lastChild.data.replace(/\n+$/,"")))) pre.lastChild.remove();
      const last=pre.lastChild; if(last&&last.nodeType===3) last.data=last.data.replace(/\n+$/,"");
      const nx=pre.nextElementSibling; if(nx&&!nx.textContent.trim()&&nx.tagName==="DIV") jCaretIn(nx,false); else jNewLineAfter(pre);
      jEdited=true; jEd.dispatchEvent(new Event("input")); return; }
    document.execCommand("insertLineBreak"); return; }
  if(e.key==="Backspace"&&!jPreText(pre).trim()&&r.collapsed){ e.preventDefault(); const d=document.createElement("div"); d.appendChild(document.createElement("br")); pre.replaceWith(d); jCaretIn(d,false); jEdited=true; jEd.dispatchEvent(new Event("input")); return; }
  if(e.key==="ArrowDown"&&!pre.nextElementSibling){ const t=document.createRange(); t.selectNodeContents(pre); t.setStart(r.endContainer,r.endOffset); if(!t.toString().replace(/\n$/,"").includes("\n")){ e.preventDefault(); jNewLineAfter(pre); } }
},true);
// fixed elements inside a blurred panel are placed relative to that panel, not the window:
// set the position, measure where it landed and correct by the difference
function placeAt(el,x,y){ el.style.left=x+"px"; el.style.top=y+"px"; const r=el.getBoundingClientRect(); el.style.left=(x+(x-r.left))+"px"; el.style.top=(y+(y-r.top))+"px"; }
// ---------- tables ----------
const jCellOf=n=>{ const el=n&&(n.nodeType===1?n:n.parentElement); const c=el&&el.closest("td,th"); return c&&jEd.contains(c)?c:null; };
function jTopBlock(r){ let blk=r.startContainer.nodeType===1?r.startContainer:r.startContainer.parentElement; while(blk&&blk!==jEd&&blk.parentElement!==jEd) blk=blk.parentElement; return blk&&blk!==jEd?blk:null; }
function jTable(){
  if(document.activeElement!==jEd) jEd.focus();
  const sel=getSelection(); if(!sel.rangeCount||!jEd.contains(sel.anchorNode)) jCaretIn(jEd,true);
  const r=getSelection().getRangeAt(0); if(jCellOf(r.startContainer)||jPreOf(r.startContainer)){ toast("Pon el cursor fuera de la tabla o del bloque de código."); return; }
  const cell=t=>{ const c=document.createElement(t); c.appendChild(document.createElement("br")); return c; };
  const tb=document.createElement("table"); tb.className="jtable"; const th=tb.createTHead().insertRow(), body=tb.createTBody();
  for(let i=0;i<3;i++) th.appendChild(cell("th")); for(let k=0;k<2;k++){ const tr=body.insertRow(); for(let i=0;i<3;i++) tr.appendChild(cell("td")); }
  const blk=jTopBlock(r);
  if(!blk) jEd.appendChild(tb); else if(!blk.textContent.trim()&&!blk.querySelector(".jtask,.jtag,.jlink,table,pre")) blk.replaceWith(tb); else blk.after(tb);
  if(!tb.nextSibling||tb.nextSibling.nodeName==="TABLE"){ const d=document.createElement("div"); d.appendChild(document.createElement("br")); tb.after(d); }
  jCaretIn(th.cells[0],false); jEdited=true; jEd.dispatchEvent(new Event("input")); jTblPlace();
}
$("#jTblBtn").addEventListener("click",jTable);
function jTblOp(op){
  const sel=getSelection(), c=sel.rangeCount&&jCellOf(sel.anchorNode)||jTblCell; if(!c) return;
  const tb=c.closest("table"), tr=c.parentElement, col=c.cellIndex, rows=[...tb.rows], ncol=tr.cells.length;
  const mk=t=>{ const x=document.createElement(t); x.appendChild(document.createElement("br")); return x; };
  let focus=c;
  if(op==="col+"){ rows.forEach(row=>{ const ref=row.cells[col]; const n=mk(row.parentElement.tagName==="THEAD"?"th":"td"); ref?ref.after(n):row.appendChild(n); if(row===tr) focus=n; }); }
  else if(op==="col-"){ if(ncol<=1){ toast("La tabla necesita al menos una columna."); return; } rows.forEach(row=>{ row.cells[col]&&row.cells[col].remove(); }); focus=tr.cells[Math.min(col,tr.cells.length-1)]; }
  else if(op==="row+"){ const body=tb.tBodies[0]||tb.createTBody(), n=document.createElement("tr"); for(let i=0;i<ncol;i++) n.appendChild(mk("td"));
    if(tr.parentElement.tagName==="THEAD") body.insertBefore(n,body.firstChild); else tr.after(n); focus=n.cells[Math.min(col,ncol-1)]; }
  else if(op==="row-"){ if(tr.parentElement.tagName==="THEAD"){ toast("El encabezado no se puede quitar. Puedes quitar la tabla completa."); return; }
    const body=tr.parentElement; if(body.rows.length<=1){ toast("La tabla necesita al menos una fila además del encabezado."); return; }
    const nx=tr.nextElementSibling||tr.previousElementSibling; tr.remove(); focus=nx.cells[Math.min(col,nx.cells.length-1)]; }
  else if(op==="wide"){ tb.classList.toggle("wide"); jCaretIn(c,true); jEdited=true; jEd.dispatchEvent(new Event("input")); jTblPlace(); return; }
  else if(op==="del"){ const d=document.createElement("div"); d.appendChild(document.createElement("br")); tb.replaceWith(d); jCaretIn(d,false); jTblCell=null; jEdited=true; jEd.dispatchEvent(new Event("input")); jTblPlace(); return; }
  jCaretIn(focus,true); jEdited=true; jEd.dispatchEvent(new Event("input")); jTblPlace();
}
let jTblCell=null;
function jTblPlace(){ const bar=$("#jTblBar"), sel=getSelection(), c=sel.rangeCount&&jCellOf(sel.anchorNode);
  if(c) jTblCell=c; const tb=c&&c.closest("table");
  if(!tb||jEd.hidden){ if(!bar.matches(":hover")) bar.hidden=true; return; }
  const r=tb.getBoundingClientRect(), er=jEd.getBoundingClientRect(); bar.hidden=false;
  const wide=tb.classList.contains("wide"); $("#jTblWide").setAttribute("aria-pressed",String(wide)); $("#jTblWide").textContent=wide?"Ancho normal":"Ancho completo";
  // right under the table; if that is off the editor, pin it to the editor's bottom edge
  const top=Math.max(er.top+4,Math.min(r.bottom+3,er.bottom-bar.offsetHeight-4)), left=Math.max(er.left+4,Math.min(r.left,er.right-bar.offsetWidth-4));
  placeAt(bar,left,top); }
jEd.addEventListener("input",()=>{ if(!$("#jTblBar").hidden) requestAnimationFrame(jTblPlace); });
document.addEventListener("selectionchange",()=>{ if(document.activeElement===jEd||!$("#jTblBar").hidden) jTblPlace(); });
jEd.addEventListener("scroll",jTblPlace); addEventListener("resize",jTblPlace);
jEd.addEventListener("blur",()=>setTimeout(()=>{ if(!$("#jTblBar").contains(document.activeElement)&&!$("#jTblBar").matches(":hover")) $("#jTblBar").hidden=true; },150));
$("#jTblBar").addEventListener("mousedown",e=>e.preventDefault());
$("#jTblBar").addEventListener("click",e=>{ const b=e.target.closest("[data-tb]"); if(b){ jEd.focus(); if(jTblCell&&!jCellOf(getSelection().anchorNode)) jCaretIn(jTblCell,true); jTblOp(b.dataset.tb); } });
jEd.addEventListener("keydown",e=>{ const sel=getSelection(); if(!sel.rangeCount) return; const c=jCellOf(sel.anchorNode); if(!c) return;
  if(e.key==="Tab"){ e.preventDefault(); e.stopImmediatePropagation(); const tb=c.closest("table"), cells=[...tb.querySelectorAll("th,td")], i=cells.indexOf(c);
    if(e.shiftKey){ if(i>0) jCaretIn(cells[i-1],true); return; }
    if(i<cells.length-1) jCaretIn(cells[i+1],true); else jTblOp("row+"); return; }
  if(e.key==="Enter"){ e.preventDefault(); e.stopImmediatePropagation(); document.execCommand("insertLineBreak"); }
},true);
// ---------- journal links ----------
let jLinkRange=null;
function jLinkOpen(){ if(document.activeElement!==jEd) jEd.focus(); const sel=getSelection(); if(!sel.rangeCount||!jEd.contains(sel.anchorNode)) jCaretIn(jEd,true);
  jLinkRange=getSelection().getRangeAt(0).cloneRange(); const p=$("#jLinkPop"), b=$("#jLinkBtn").getBoundingClientRect();
  $("#jLinkUrl").value=""; $("#jLinkName").value=jLinkRange.collapsed?"":jLinkRange.toString().trim().slice(0,80);
  p.hidden=false; placeAt(p,Math.max(8,Math.min(b.left,innerWidth-p.offsetWidth-8)),b.bottom+6); $("#jLinkUrl").focus(); }
function jLinkClose(){ $("#jLinkPop").hidden=true; }
$("#jLinkBtn").addEventListener("click",()=>{ $("#jLinkPop").hidden?jLinkOpen():jLinkClose(); });
$("#jLinkCancel").addEventListener("click",()=>{ jLinkClose(); jEd.focus(); });
$("#jLinkPop").addEventListener("keydown",e=>{ if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); jLinkClose(); jEd.focus(); } });
$("#jLinkPop").addEventListener("submit",e=>{ e.preventDefault(); const url=normUrl($("#jLinkUrl").value); if(!url){ toast("Ese link no es válido. Copia la dirección completa."); $("#jLinkUrl").focus(); return; }
  const a=document.createElement("a"); a.className="jlink"; a.href=url; a.target="_blank"; a.rel="noopener noreferrer"; a.setAttribute("contenteditable","false"); a.title=url; a.textContent="📎 "+linkName(url,$("#jLinkName").value.trim());
  jLinkClose(); jEd.focus(); const sel=getSelection(); sel.removeAllRanges();
  let r=jLinkRange&&jEd.contains(jLinkRange.startContainer)?jLinkRange:null; if(!r){ r=document.createRange(); r.selectNodeContents(jEd); r.collapse(false); }
  if(!r.collapsed) r.deleteContents(); r.insertNode(a); const sp=document.createTextNode(" "); a.after(sp);
  const after=document.createRange(); after.setStartAfter(sp); after.collapse(true); sel.addRange(after);
  jEdited=true; jEd.dispatchEvent(new Event("input")); toast("Link adjuntado"); });
document.addEventListener("mousedown",e=>{ if(!$("#jLinkPop").hidden&&!e.target.closest("#jLinkPop,#jLinkBtn")) jLinkClose(); });
jEd.addEventListener("click",e=>{ const a=e.target.closest("a.jlink"); if(!a) return; e.preventDefault(); e.stopImmediatePropagation(); window.open(a.href,"_blank","noopener"); },true);
// floating Copiar button over the hovered code block
let jCopyPre=null;
function jCopyPlace(){ const b=$("#jCodeCopy"); if(!jCopyPre||!jEd.contains(jCopyPre)||jEd.hidden){ b.hidden=true; jCopyPre=null; return; }
  const pr=jCopyPre.getBoundingClientRect(), er=jEd.getBoundingClientRect(); if(pr.top<er.top-4||pr.top>er.bottom-24){ b.hidden=true; return; }
  b.hidden=false; placeAt(b,Math.min(pr.right,er.right-14)-b.offsetWidth-6,pr.top+6); }
jEd.addEventListener("mouseover",e=>{ const p=jPreOf(e.target); if(p!==jCopyPre){ jCopyPre=p; $("#jCodeCopy").textContent="Copiar"; } jCopyPlace(); });
jEd.addEventListener("mouseleave",e=>{ if(e.relatedTarget&&e.relatedTarget.id==="jCodeCopy") return; jCopyPre=null; jCopyPlace(); });
jEd.addEventListener("scroll",jCopyPlace);
$("#jCodeCopy").addEventListener("mousedown",e=>e.preventDefault());
$("#jCodeCopy").addEventListener("click",async()=>{ if(!jCopyPre) return; const t=jPreText(jCopyPre).replace(/\n$/,"");
  try{ await navigator.clipboard.writeText(t); }catch{ const ta=document.createElement("textarea"); ta.value=t; document.body.appendChild(ta); ta.select(); try{ document.execCommand("copy"); }catch{} ta.remove(); }
  $("#jCodeCopy").textContent="Copiado"; setTimeout(()=>{ $("#jCodeCopy").textContent="Copiar"; },1200); });
jEd.addEventListener("click",e=>{ const a=e.target.closest("a"); if(a&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); window.open(a.href,"_blank","noopener"); } });
document.execCommand&&(()=>{ try{ document.execCommand("styleWithCSS",false,false); }catch{} })();
$("#jTools").addEventListener("mousedown",e=>{ if(e.target.closest("button")) e.preventDefault(); }); // keep the selection in the editor
$("#jTools").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
  if(b.id==="jHlBtn"){ jHlShow($("#jHlPop").hidden); return; }
  if(b.dataset.hl!==undefined||b.dataset.tc!==undefined){ jColor(b.dataset.hl!==undefined?"hiliteColor":"foreColor",b.dataset.hl??b.dataset.tc); jHlShow(false); return; }
  if(b.id==="jFont"){ const mono=b.getAttribute("aria-pressed")!=="true"; jMono(mono); lsSet("pp-jmono",mono); return; }
  if(document.activeElement!==jEd) jEd.focus();
  if(b.dataset.cmd) document.execCommand(b.dataset.cmd,false,null);
  else if(b.dataset.size) document.execCommand("fontSize",false,b.dataset.size);
  jEdited=true; jEd.dispatchEvent(new Event("input")); jToolState(); });
function jHlShow(on){ $("#jHlPop").hidden=!on; $("#jHlBtn").setAttribute("aria-expanded",String(on)); }
document.addEventListener("click",e=>{ if(!e.target.closest(".jhl")) jHlShow(false); });
// Chrome understands inline styles when splitting runs, so colors are applied in CSS mode and the
// "no color" choice uses a sentinel that is stripped right after.
function jColor(cmd,val){ if(document.activeElement!==jEd) jEd.focus();
  const NONE=cmd==="hiliteColor"?"#010203":"#010204";
  try{ document.execCommand("styleWithCSS",false,true); document.execCommand(cmd,false,val||NONE); }finally{ document.execCommand("styleWithCSS",false,false); }
  const nr=jRgb(NONE); jEd.querySelectorAll("[style],font[color]").forEach(el=>{
    if(cmd==="hiliteColor"&&jRgb(el.style.backgroundColor)===nr) el.style.backgroundColor="";
    if(cmd==="foreColor"&&(jRgb(el.style.color)===nr||jRgb(el.getAttribute("color")||"")===nr)){ el.style.color=""; el.removeAttribute("color"); }
    if(el.getAttribute("style")==="") el.removeAttribute("style");
    if((el.tagName==="SPAN"||el.tagName==="FONT")&&!el.attributes.length) el.replaceWith(...el.childNodes); });
  jEdited=true; jEd.dispatchEvent(new Event("input")); }
function jToolState(){ ["bold","italic","underline","strikeThrough","insertUnorderedList","insertOrderedList"].forEach(c=>{ const b=$(`#jTools [data-cmd="${c}"]`); let on=false; try{ on=document.queryCommandState(c); }catch{} b&&b.setAttribute("aria-pressed",String(!!on)); });
  const td=!!jTodoUl(); $("#jTodoBtn").setAttribute("aria-pressed",String(td)); if(td) $('#jTools [data-cmd="insertUnorderedList"]').setAttribute("aria-pressed","false"); }
// ---------- to-do lists: ul.jchk, checked items carry class ok ----------
const jElOf=n=>n&&(n.nodeType===1?n:n.parentElement);
function jTodoUl(){ const sel=getSelection(); if(!sel.rangeCount) return null; const u=jElOf(sel.anchorNode); const ul=u&&u.closest("ul.jchk"); return ul&&jEd.contains(ul)?ul:null; }
function jTodo(){
  if(document.activeElement!==jEd) jEd.focus();
  const sel=getSelection(); if(!sel.rangeCount||!jEd.contains(sel.anchorNode)) jCaretIn(jEd,true);
  const r=getSelection().getRangeAt(0); if(jPreOf(r.startContainer)||jCellOf(r.startContainer)){ toast("Pon el cursor fuera de la tabla o del bloque de código."); return; }
  const near=jElOf(r.startContainer).closest("ul,ol"), list=near&&jEd.contains(near)?near:null;
  if(list&&list.tagName==="UL"&&list.classList.contains("jchk")) document.execCommand("insertUnorderedList");
  else { if(!list||list.tagName!=="UL") document.execCommand("insertUnorderedList");
    const u=jElOf(getSelection().anchorNode), ul=u&&u.closest("ul"); if(ul&&jEd.contains(ul)) ul.classList.add("jchk"); }
  jSpanFix(); jEdited=true; jEd.dispatchEvent(new Event("input")); jToolState(); }
// Chrome leaves inline font-size/color spans when it unwraps a list; keep only palette colors
function jSpanFix(){ jEd.querySelectorAll("span[style]").forEach(sp=>{ const bg=J_HL.has(jRgb(sp.style.backgroundColor))?sp.style.backgroundColor:"", fg=J_TC.has(jRgb(sp.style.color))?sp.style.color:"";
  sp.removeAttribute("style"); if(bg) sp.style.backgroundColor=bg; if(fg) sp.style.color=fg; if(!sp.attributes.length) sp.replaceWith(...sp.childNodes); }); }
$("#jTodoBtn").addEventListener("click",jTodo);
// a click on the box (left of the item) checks or unchecks it
jEd.addEventListener("mousedown",e=>{ const li=e.target.closest&&e.target.closest("ul.jchk>li"); if(!li||!jEd.contains(li)) return;
  if(e.clientX>=li.getBoundingClientRect().left) return; e.preventDefault(); li.classList.toggle("ok"); jEdited=true; jEd.dispatchEvent(new Event("input")); });
jEd.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.shiftKey&&(e.key==="X"||e.key==="x")){ e.preventDefault(); document.execCommand("strikeThrough"); jToolState(); return; }
  const sel=getSelection(); if(!sel.rangeCount||!sel.isCollapsed) return; const r=sel.getRangeAt(0);
  if(e.key===" "&&!e.ctrlKey&&!e.metaKey&&!jPreOf(r.startContainer)&&!jCellOf(r.startContainer)&&!jElOf(r.startContainer).closest("li")){ // [] + space starts a to-do list
    const t=r.startContainer; if(t.nodeType!==3) return; const before=t.data.slice(0,r.startOffset), ls=before.lastIndexOf("\n")+1;
    if(!/^\s*\[ ?\]$/.test(before.slice(ls))) return;
    const blk=jElOf(t), lineOnly=blk!==jEd&&blk.textContent===before;
    e.preventDefault(); t.deleteData(ls,r.startOffset-ls);
    if(lineOnly&&!blk.textContent){ blk.textContent=""; blk.appendChild(document.createElement("br")); jCaretIn(blk,false); }
    else { const rr=document.createRange(); rr.setStart(t,ls); rr.collapse(true); sel.removeAllRanges(); sel.addRange(rr); }
    jTodo(); return; }
  if(e.key==="Tab") setTimeout(()=>jEd.querySelectorAll("ul.jchk ul").forEach(u=>u.classList.add("jchk")),0);
  const li=jElOf(r.startContainer).closest("ul.jchk>li"); if(!li||!jEd.contains(li)) return;
  if(e.key==="Enter"&&!e.shiftKey) setTimeout(()=>{ const n=jElOf(getSelection().anchorNode), x=n&&n.closest("li"); if(x&&x!==li&&x.parentElement.classList.contains("jchk")) x.classList.remove("ok"); },0);
});
document.addEventListener("selectionchange",()=>{ if(document.activeElement===jEd) jToolState(); });
function jMono(on){ jEd.classList.toggle("sans",!on); $("#jFont").setAttribute("aria-pressed",String(on)); $("#jFont").textContent=on?"Mono":"Normal"; $("#jFont").title=on?"Letra monoespaciada, como Notepad++ (toca para letra normal)":"Letra normal (toca para monoespaciada)"; }
jMono(lsGet("pp-jmono")!==false);

// ---- tags with "/" ----
const jPop=document.createElement("div"); jPop.className="jtagpop"; jPop.hidden=true; jPop.setAttribute("role","listbox"); jPop.setAttribute("aria-label","Tags"); document.body.appendChild(jPop);
let jTQ=null; // {node, start} of the "/" being completed
let jTSel=0, jTItems=[];
function jTagSets(){ const proj=[...new Set(S.tasks.map(t=>jTagName(t.tag)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es"));
  const pf=new Set(proj.map(fold)), used=new Set();
  jDays().forEach(k=>{ const h=J.days[k].html; if(h.includes("jtag")) h.replace(/data-tag="([^"]+)"/g,(m,t)=>{ used.add(t.replace(/&amp;/g,"&")); return m; }); });
  const own=[...new Set([...(S.settings.jtags||[]),...used].map(jTagName).filter(t=>t&&!pf.has(fold(t))))].sort((a,b)=>a.localeCompare(b,"es"));
  return {proj,own}; }
function jTagOpen(node,start){ jTQ={node,start}; jTSel=0; jTagRender(); }
function jTagClose(){ jTQ=null; jPop.hidden=true; jPop.innerHTML=""; }
function jTagQuery(){ if(!jTQ) return null; const sel=getSelection(); if(!sel.rangeCount) return null; const r=sel.getRangeAt(0);
  if(r.startContainer!==jTQ.node||r.startOffset<=jTQ.start||!jTQ.node.isConnected||jTQ.node.data[jTQ.start]!=="/") return null;
  const q=jTQ.node.data.slice(jTQ.start+1,r.startOffset); return q.length>40||/\//.test(q)||/^[\s ]/.test(q)||/[\s ]{2}/.test(q)?null:q.replace(/ /g," "); }
function jTagRender(){ const q=jTagQuery(); if(q==null){ jTagClose(); return; }
  const fq=fold(q.trim()), {proj,own}=jTagSets(), m=L=>L.filter(t=>!fq||fold(t).includes(fq));
  const P=m(proj), O=m(own), exact=[...proj,...own].some(t=>fold(t)===fq), nm=jTagName(q);
  jTItems=[...P.map(t=>({t})),...O.map(t=>({t,own:(S.settings.jtags||[]).some(x=>fold(x)===fold(t))})),...(nm&&!exact?[{t:nm,create:true}]:[])];
  if(!jTItems.length){ jPop.innerHTML=`<div class="hint">Escribe el nombre del tag nuevo.</div>`; } else {
  if(jTSel>=jTItems.length) jTSel=jTItems.length-1;
  let i=0; const row=x=>{ const ix=i++; return `<div class="it" role="option" data-ix="${ix}" aria-selected="${ix===jTSel}">${x.create?`<span>Crear tag</span> `:""}${jTagEl(x.t).outerHTML}${x.own?`<button type="button" class="x" data-del="${esc(x.t)}" title="Quitar de la lista" aria-label="Quitar ${esc(x.t)} de la lista">✕</button>`:""}</div>`; };
  jPop.innerHTML=(P.length?`<div class="gh">Proyectos</div>`+P.map(t=>row({t})).join(""):"")
    +(O.length?`<div class="gh">Otros tags</div>`+jTItems.filter((x,k)=>k>=P.length&&!x.create).map(row).join(""):"")
    +(nm&&!exact?row({t:nm,create:true}):"")
    +`<div class="hint">↑↓ para elegir · Enter para agregar · Esc para cerrar</div>`; }
  const r=getSelection().getRangeAt(0).cloneRange(); let rc=r.getBoundingClientRect(); if(!rc.height){ const t=jTQ.node.parentElement; rc=t.getBoundingClientRect(); }
  jPop.hidden=false; const w=jPop.offsetWidth, h=jPop.offsetHeight;
  jPop.style.left=Math.max(8,Math.min(innerWidth-w-8,rc.left))+"px"; jPop.style.top=(rc.bottom+h+8>innerHeight?Math.max(8,rc.top-h-6):rc.bottom+6)+"px";
  const cur=jPop.querySelector('[aria-selected="true"]'); cur&&cur.scrollIntoView({block:"nearest"}); }
function jTagPick(ix){ const x=jTItems[ix]; if(!x||!jTQ) return; const q=jTagQuery(); if(q==null){ jTagClose(); return; }
  if(x.create&&!(S.settings.jtags||[]).some(t=>fold(t)===fold(x.t))){ S.settings.jtags=[...(S.settings.jtags||[]),x.t]; commit(); }
  const {node,start}=jTQ, end=start+1+q.length; jTagClose();
  const r=document.createRange(); r.setStart(node,start); r.setEnd(node,end); r.deleteContents();
  const chip=jTagEl(x.t), sp=document.createTextNode(" "); r.insertNode(sp); r.insertNode(chip);
  const c=document.createRange(); c.setStart(sp,1); c.collapse(true); const s2=getSelection(); s2.removeAllRanges(); s2.addRange(c);
  jEdited=true; jEd.dispatchEvent(new Event("input")); }
jEd.addEventListener("input",e=>{ if(e.isTrusted===false&&!jTQ) return;
  const sel=getSelection(); if(!sel.rangeCount) return; const r=sel.getRangeAt(0), n=r.startContainer;
  if(e.inputType==="insertText"&&e.data==="/"&&n.nodeType===3&&!jPreOf(n)){ const i=r.startOffset-1, prev=i>0?n.data[i-1]:"";
    if(n.data[i]==="/"&&(!prev||/[\s (]/.test(prev))){ jTagOpen(n,i); return; } }
  if(jTQ) jTagRender(); });
jEd.addEventListener("keydown",e=>{ if(!jTQ||jPop.hidden) return;
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){ e.preventDefault(); e.stopImmediatePropagation(); if(jTItems.length){ jTSel=(jTSel+(e.key==="ArrowDown"?1:-1)+jTItems.length)%jTItems.length; jTagRender(); } }
  else if(e.key==="Enter"||e.key==="Tab"){ if(!jTItems.length) return; e.preventDefault(); e.stopImmediatePropagation(); jTagPick(jTSel); }
  else if(e.key==="Escape"){ e.preventDefault(); e.stopImmediatePropagation(); jTagClose(); } },true);
jEd.addEventListener("blur",()=>setTimeout(()=>{ if(!jPop.matches(":hover")) jTagClose(); },120));
jPop.addEventListener("mousedown",e=>e.preventDefault());
jPop.addEventListener("click",e=>{ const d=e.target.closest("[data-del]"); if(d){ e.stopPropagation(); const t=d.dataset.del; S.settings.jtags=(S.settings.jtags||[]).filter(x=>fold(x)!==fold(t)); commit(); toast(`Tag "${t}" quitado de la lista`); jTagRender(); return; }
  const it=e.target.closest("[data-ix]"); if(it) jTagPick(+it.dataset.ix); });
document.addEventListener("scroll",()=>{ if(jTQ) jTagRender(); },true);
$("#jTagBtn").addEventListener("click",()=>{ if(document.activeElement!==jEd) jEd.focus(); document.execCommand("insertText",false,(()=>{ const s=getSelection(), r=s.rangeCount&&s.getRangeAt(0), n=r&&r.startContainer;
  const prev=n&&n.nodeType===3&&r.startOffset>0?n.data[r.startOffset-1]:""; return prev&&!/[\s ]/.test(prev)?" /":"/"; })()); });
// clicking a tag lists every line marked with it, across all days
jEd.addEventListener("click",e=>{ const t=e.target.closest(".jtag"); if(!t) return; e.preventDefault(); $("#jSearch").value="#"+t.dataset.tag; jSearch(); $("#jSearch").focus(); });

// ---- search across days ----
let jsT=null;
$("#jSearch").addEventListener("input",()=>{ clearTimeout(jsT); jsT=setTimeout(jSearch,150); });
$("#jSearch").addEventListener("keydown",e=>{ if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); e.target.value=""; jSearch(); } });
function jSearch(){ jSaveNow(); const q=fold($("#jSearch").value.trim()), box=$("#jResults"); if(!q){ box.hidden=true; box.innerHTML=""; return; }
  const res=[]; jDays().slice().reverse().forEach(k=>{ const txt=jText(J.days[k].html), f=fold(txt); let i=f.indexOf(q), n=0;
    while(i>=0&&n<3&&res.length<40){ const ls=txt.lastIndexOf("\n",i-1)+1, le=txt.indexOf("\n",i); const line=txt.slice(ls,le<0?undefined:le).replace(/\t/g," ").trim();
      const ff=fold(line), j=ff.indexOf(q); res.push({k,line,j}); n++; i=f.indexOf(q,le<0?f.length:le); } });
  box.hidden=false;
  box.innerHTML=res.length?res.map((r,ix)=>`<button type="button" data-k="${r.k}" data-ix="${ix}"><span class="d">${esc(jLabel(r.k))}</span><span class="t">${r.j>=0?esc(r.line.slice(0,r.j))+"<mark>"+esc(r.line.slice(r.j,r.j+q.length))+"</mark>"+esc(r.line.slice(r.j+q.length)):esc(r.line)}</span></button>`).join("")
    :`<div class="none">Nada en la bitácora coincide con «${esc($("#jSearch").value.trim())}».</div>`; }
$("#jResults").addEventListener("click",e=>{ const b=e.target.closest("button[data-k]"); if(!b) return; const q=fold($("#jSearch").value.trim());
  const nth=[...$("#jResults").querySelectorAll(`button[data-k="${b.dataset.k}"]`)].indexOf(b);
  jOpen(b.dataset.k); jReveal(q,nth); });
function jReveal(q,nth){ if(!q) return; const w=document.createTreeWalker(jEd,NodeFilter.SHOW_TEXT); let c=0;
  while(w.nextNode()){ const t=w.currentNode, f=fold(t.data); if(f.length!==t.data.length) continue; let i=f.indexOf(q);
    while(i>=0){ if(c===nth){ jEd.focus(); const r=document.createRange(); r.setStart(t,i); r.setEnd(t,i+q.length); const s=getSelection(); s.removeAllRanges(); s.addRange(r);
        t.parentElement.scrollIntoView({block:"center",behavior:"smooth"}); return; } c++; i=f.indexOf(q,i+1); } } }

// ---- copy, downloads, delete ----
$("#jCopy").addEventListener("click",async()=>{ jSaveNow(); if(!jLive(jCur)){ toast("Este día está vacío."); return; }
  const txt=jText(J.days[jCur].html), html=jClean(J.days[jCur].html);
  try{ if(window.ClipboardItem&&navigator.clipboard.write) await navigator.clipboard.write([new ClipboardItem({"text/plain":new Blob([txt],{type:"text/plain"}),"text/html":new Blob([html],{type:"text/html"})})]);
       else await navigator.clipboard.writeText(txt); toast("Día copiado"); return; }catch{}
  const ta=document.createElement("textarea"); ta.value=txt; ta.style.cssText="position:fixed;opacity:0"; document.body.appendChild(ta); ta.select();
  let ok=false; try{ ok=document.execCommand("copy"); }catch{} ta.remove(); toast(ok?"Día copiado":"No se pudo copiar; selecciona el texto y usa Ctrl+C."); });
// journal-only backup: html keeps the formatting, text is there to read it anywhere; Importar merges it back by day
function jJson(ks){ const days={}; ks.forEach(k=>{ const d=J.days[k]; days[k]={html:d.html,text:jText(d.html),updatedAt:d.updatedAt}; });
  return JSON.stringify({app:"panel-pomodoro-bitacora",version:1,exportedAt:new Date().toISOString(),journal:{days}},null,2); }
function jMerge(jx){ const now=Date.now(); for(const k in jx.days){ J.days[k]={...jx.days[k],updatedAt:now}; jDirty.add(k); } lsSet(LJ,J); jEdited=false; jOpen(jCur); jFlushSoon(); }
function jPopShow(on){ $("#jPop").hidden=!on; $("#jMore").setAttribute("aria-expanded",String(on)); }
$("#jMore").addEventListener("click",e=>{ e.stopPropagation(); $("#jSideItem").textContent=$("#journal").classList.contains("side")?"Acoplar como pestaña":"Abrir al costado"; jPopShow($("#jPop").hidden); });
document.addEventListener("click",e=>{ if(!e.target.closest(".jmenu")) jPopShow(false); });
$("#jPop").addEventListener("click",e=>{ const b=e.target.closest("[data-j]"); if(!b) return; jPopShow(false); jSaveNow(); const a=b.dataset.j;
  if(a==="dl-day"){ if(!jLive(jCur)){ toast("Este día está vacío."); return; } saveFile(`bitacora-${jCur}.json`,jJson([jCur]),"application/json","Día"); }
  else if(a==="dl-all"){ const ks=jDays(); if(!ks.length){ toast("La bitácora está vacía."); return; } saveFile(`bitacora-completa-${jToday()}.json`,jJson(ks),"application/json","Bitácora"); }
  else if(a==="side"){ $("#journal").classList.contains("side")?jDock():jSideOpen(); }
  else if(a==="del"){ if(!jLive(jCur)){ toast("Este día ya está vacío."); return; }
    confirmDel(`¿Eliminar la bitácora del ${jLabel(jCur,true).replace("Hoy · ","")}? No se puede deshacer.`,()=>{ J.days[jCur]={html:"",updatedAt:Date.now(),deleted:true}; lsSet(LJ,J); jDirty.add(jCur); jFlushSoon(); jOpen(jCur); toast("Día eliminado"); }); } });

// ---- tasks closed on the open day (Hecha or Cancelada, by completedAt) ----
function jClosedRender(){ const box=$("#jClosed"); if(!box||$("#journal").hidden) return;
  const L=S.tasks.filter(t=>t.completed&&t.completedAt&&dayKey(t.completedAt)===jCur).sort((a,b)=>a.completedAt-b.completedAt);
  const tot=L.reduce((a,t)=>a+liveSpent(t),0), min=!!lsGet("pp-jclosed-min");
  box.classList.toggle("min",min);
  const head=`<div class="jch"><button class="jcol" type="button" data-jc="toggle" aria-expanded="${!min}" title="${min?"Mostrar":"Contraer"}" aria-label="${min?"Mostrar tareas cerradas":"Contraer tareas cerradas"}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg></button>
    <h3>Tareas cerradas ${jCur===jToday()?"hoy":"este día"} · ${L.length}</h3>${L.length?`<span class="tot">Tiempo total <b>${clock(tot)}</b></span>`:""}</div>`;
  if(!L.length){ box.innerHTML=head+`<div class="jcempty">Aún no hay tareas cerradas ${jCur===jToday()?"hoy":"este día"}. Cuando marques una como Hecha aparecerá aquí.</div>`; return; }
  const EYE='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  box.innerHTML=head+`<ul class="jclist">${L.map(t=>{ const nn=S.notes.filter(n=>n.task===t.id&&String(n.text||"").trim()).length;
    return `<li data-id="${t.id}"><span class="nm" title="${esc(t.title)}">${esc(t.title)}</span>${t.status==="cancelled"?`<span class="cx">Cancelada</span>`:""}${t.tag?`<span class="tag">${esc(t.tag)}</span>`:""}
      ${nn?`<button class="ib nt" type="button" data-jc="notes" title="Ver ${nn===1?"la nota":`las ${nn} notas`}" aria-label="Ver notas de la tarea">${ICON_NOTE}</button>`:""}
      <span class="tm">${clock(liveSpent(t))}</span><button class="ib" type="button" data-jc="go" title="Ver la tarea" aria-label="Ver la tarea">${EYE}</button></li>`; }).join("")}</ul>`; }
$("#jClosed").addEventListener("click",e=>{ const b=e.target.closest("[data-jc]"); if(!b) return;
  if(b.dataset.jc==="toggle"){ lsSet("pp-jclosed-min",!lsGet("pp-jclosed-min")); jClosedRender(); return; }
  if(b.dataset.jc==="go"||b.dataset.jc==="notes"){ const id=b.closest("li").dataset.id; if($("#journal").classList.contains("side")) jSideClose(); jSetTab("tasks"); goToTask(id,{notes:b.dataset.jc==="notes"}); } });

// ---- tabs and side panel ----
let jTab=lsGet("pp-tab")==="journal"?"journal":"tasks";
const jHome=$("#journal").parentElement, jAnchor=$("#journal").nextSibling;
function jSetTab(t){ jTab=t; lsSet("pp-tab",t); const side=$("#journal").classList.contains("side");
  document.querySelectorAll(".ptabs [data-tab]").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.tab===t)));
  $(".tasks-panel").classList.toggle("jtab",t==="journal"&&!side); if(!side) $("#journal").hidden=t!=="journal"; jClosedRender(); }
document.querySelectorAll(".ptabs [data-tab]").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); if($("#grid").classList.contains("collapsed")) setCollapsed(false);
  if(b.dataset.tab==="journal"&&$("#journal").classList.contains("side")){ jDock(); return; } jSetTab(b.dataset.tab); }));
function jSideOpen(){ if($(".tasks-panel").classList.contains("side")) tSideClose(); const j=$("#journal"); j.classList.add("side"); j.hidden=false; jClosedRender(); document.body.appendChild(j); lsSet("pp-jside",true);
  $(".tasks-panel").classList.remove("jtab"); if(jTab==="journal") jSetTab("tasks"); $("#jHeadBtn").setAttribute("aria-pressed","true"); }
function jSideClose(){ const j=$("#journal"); jSaveNow(); j.classList.remove("side"); jHome.insertBefore(j,jAnchor); lsSet("pp-jside",false); $("#jHeadBtn").setAttribute("aria-pressed","false"); jSetTab(jTab); }
function jDock(){ jSideClose(); jSetTab("journal"); $(".tasks-panel").scrollIntoView({block:"start",behavior:"smooth"}); }
$("#jHeadBtn").addEventListener("click",()=>{ $("#journal").classList.contains("side")?jSideClose():jSideOpen(); });
$("#jClose").addEventListener("click",jSideClose);
$("#jDock").addEventListener("click",jDock);
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&$("#journal").classList.contains("side")&&!e.target.closest("dialog,input,textarea,[contenteditable]")) jSideClose(); });
window.addEventListener("pagehide",jSaveNow);
document.addEventListener("visibilitychange",()=>{ if(document.hidden) jSaveNow(); });
// a new day starts at midnight: if the page stays open, "Hoy" follows the clock
setInterval(()=>{ if(document.activeElement!==jEd) jDayList(); },60000);
// tasks panel as a side drawer too (only one drawer at a time)
const tHome=$(".tasks-panel").parentElement, tAnchor=$(".tasks-panel").nextSibling;
function tSideOpen(){ if($("#journal").classList.contains("side")) jSideClose(); const tp=$(".tasks-panel"); setCollapsed(false);
  tp.classList.add("side"); document.body.appendChild(tp); lsSet("pp-tside",true); $("#tHeadBtn").setAttribute("aria-pressed","true"); render(); }
function tSideClose(){ const tp=$(".tasks-panel"); if(!tp.classList.contains("side")) return; tp.classList.remove("side"); tHome.insertBefore(tp,tAnchor);
  lsSet("pp-tside",false); $("#tHeadBtn").setAttribute("aria-pressed","false"); render(); }
$("#tHeadBtn").addEventListener("click",()=>{ $(".tasks-panel").classList.contains("side")?tSideClose():tSideOpen(); });
$("#tSideClose").addEventListener("click",e=>{ e.stopPropagation(); tSideClose(); });
$("#tDock").addEventListener("click",e=>{ e.stopPropagation(); tSideClose(); $(".tasks-panel").scrollIntoView({block:"start",behavior:"smooth"}); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&$(".tasks-panel").classList.contains("side")&&!e.target.closest("dialog,input,textarea,select,[contenteditable]")&&!document.querySelector("dialog[open]")) tSideClose(); });
jReady=true; jOpen(jCur); jSetTab(jTab); if(lsGet("pp-jside")) jSideOpen(); else if(lsGet("pp-tside")) tSideOpen();
jSet(jCol?"":"Guardado en este navegador");

// ---------- export / import (JSON backup) ----------
function backupJSON(){ jSaveNow(); return JSON.stringify({app:"panel-pomodoro",version:1,exportedAt:new Date().toISOString(),data:S,journal:J},null,2); }
async function doBackup(){ if(await saveFile(`tareas-respaldo-${dayKey(Date.now())}.json`,backupJSON(),"application/json","Respaldo")){ bakSet({last:Date.now()}); bakCheck(); } }
async function saveFile(filename,data,type,what){
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([data],{type})); a.download=filename;
  document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },500); toast(what+" descargado"); return true;
}
$("#importBtn").addEventListener("click",()=>{ $("#importFile").value=""; $("#importFile").click(); });
$("#importFile").addEventListener("change",()=>{ const d=$("#settings"); if(d.open) d.close(); });
$("#importFile").addEventListener("change",async e=>{
  const f=e.target.files&&e.target.files[0]; if(!f) return; let x;
  try{ x=JSON.parse(await f.text()); }catch{ toast("Ese archivo no es un respaldo válido."); return; }
  if(x&&x.app==="panel-pomodoro-bitacora"&&x.journal){ const jx=normJ(x.journal), ks=jDays(jx), n=ks.length; if(!n){ toast("Ese archivo no trae días de bitácora."); return; }
    const over=ks.filter(k=>jLive(k)).length;
    confirmDel(`El archivo trae ${n} día${n!==1?"s":""} de bitácora${over?`; ${over} ya existe${over!==1?"n":""} y se reemplazará${over!==1?"n":""}`:""}. Tus tareas y notas no se tocan. ¿Continuar?`,()=>{ jMerge(jx); toast("Bitácora importada"); },{title:"Importar bitácora",yes:"Importar"}); return; }
  const d=x&&x.data&&Array.isArray(x.data.tasks)?x.data:(x&&Array.isArray(x.tasks)?x:null);
  if(!d){ toast("Ese archivo no es un respaldo del panel."); return; }
  const nT=d.tasks.length, nN=Array.isArray(d.notes)?d.notes.length:0, jx=x&&x.journal?normJ(x.journal):null, nJ=jx?jDays(jx).length:0;
  confirmDel(`El archivo trae ${nT} tarea${nT!==1?"s":""}${jx?",":" y"} ${nN} nota${nN!==1?"s":""}${jx?` y ${nJ} día${nJ!==1?"s":""} de bitácora`:""}. Reemplazará lo que tienes ahora en el panel${jx?"":" (la bitácora no se toca)"}. ¿Continuar?`,()=>{
    if(T.track) stopTrack(); S=normalize(d); commit(); if(jx) jImport(jx); toast("Respaldo importado"); },{title:"Importar respaldo",yes:"Importar"});
});

// ---------- backups: automatic (folder in Chrome/Edge, or a daily download) or a reminder ----------
const CAN_DIR=!!window.showDirectoryPicker&&window.isSecureContext&&window.top===window;
const bakGet=()=>{ const x=lsGet("pp-bak")||{}; if(x.auto===undefined&&x.dirName){ x.auto=true; x.mode="dir"; }
  return {auto:false,mode:CAN_DIR?"dir":"dl",every:7,last:0,snooze:0,dirName:"",dirAt:0,dlDay:"",...x}; };
const bakSet=o=>lsSet("pp-bak",{...bakGet(),...o});
const bakMode=b=>b.mode==="dir"&&CAN_DIR?"dir":"dl";
const idbKV=(mode,fn)=>new Promise((res,rej)=>{ let r; try{ r=indexedDB.open("pp-backup",1); }catch(e){ rej(e); return; }
  r.onupgradeneeded=()=>r.result.createObjectStore("kv");
  r.onsuccess=()=>{ try{ const tx=r.result.transaction("kv",mode), q=fn(tx.objectStore("kv")); tx.oncomplete=()=>res(q&&q.result); tx.onerror=()=>rej(tx.error); }catch(e){ rej(e); } };
  r.onerror=()=>rej(r.error); });
let bakDirH=null, bakAct=null;
const ago=ms=>{ const d=Math.floor(ms/864e5); return d<=0?"hoy":d===1?"ayer":`hace ${d} días`; };
async function bakDirWrite(){
  const h=bakDirH, today=dayKey(Date.now());
  const fh=await h.getFileHandle(`panel-respaldo-${today}.json`,{create:true}), w=await fh.createWritable();
  await w.write(backupJSON()); await w.close();
  bakSet({dirAt:Date.now(),last:Date.now()});
  try{ const old=dayKey(Date.now()-30*864e5); // keep one file per day for 30 days
    for await (const [n] of h.entries()){ const m=/^panel-respaldo-(\d{4}-\d{2}-\d{2})\.json$/.exec(n); if(m&&m[1]<old) await h.removeEntry(n); } }catch{}
}
async function bakPick(){
  try{ const h=await window.showDirectoryPicker({id:"pp-backup",mode:"readwrite"});
    bakDirH=h; bakSet({dirName:h.name,dirAt:0}); try{ await idbKV("readwrite",st=>st.put(h,"dir")); }catch{}
    await bakDirWrite(); toast(`Respaldo guardado en «${h.name}»`); }
  catch(e){ if(!e||e.name!=="AbortError") toast("No se pudo usar esa carpeta."); }
  bakCheck();
}
async function bakCheck(){
  const b=bakGet(), now=Date.now(), today=dayKey(now), has=S.tasks.length||jDays().length; let msg="", go="Respaldar ahora";
  bakAct=null;
  if(b.auto&&bakMode(b)==="dir"){
    if(!bakDirH){ msg="El respaldo automático está activado, pero falta elegir la carpeta donde guardarlo."; go="Elegir carpeta"; bakAct="pick"; }
    else { let perm="denied"; try{ perm=await bakDirH.queryPermission({mode:"readwrite"}); }catch{}
      if(perm==="granted"){ if(now-b.dirAt>30*60000){ try{ await bakDirWrite(); }catch{ msg=`No se pudo escribir el respaldo en «${b.dirName}».`; go="Elegir otra carpeta"; bakAct="pick"; } } }
      else { msg=`El respaldo automático en «${b.dirName}» necesita tu permiso para seguir.`; go="Continuar respaldo"; bakAct="perm"; } }
  } else if(b.auto){
    if(has&&b.dlDay!==today){ bakSet({dlDay:today}); if(await saveFile(`tareas-respaldo-${today}.json`,backupJSON(),"application/json","Respaldo diario")) bakSet({last:Date.now()}); }
  } else if(has&&now-b.last>=b.every*864e5&&now>b.snooze)
    msg=b.last?`Tu último respaldo fue ${ago(now-b.last)}. Descarga uno nuevo para no perder tus tareas y tu bitácora.`:"Aún no tienes un respaldo de tus tareas y tu bitácora. Descarga uno para no perderlas.";
  $("#bakMsg").textContent=msg; $("#bakGo").textContent=go; $("#bakLater").hidden=!!bakAct; $("#bakBar").hidden=!msg;
  bakInfo();
}
function bakInfo(){
  const b=bakGet(), m=bakMode(b), el=$("#bakInfo"); if(!el) return;
  const last=b.last?` Último respaldo: ${new Date(b.last).toLocaleString("es",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}.`:" Aún no hay respaldos en este navegador.";
  el.textContent=(!b.auto?`Te avisaremos si pasa ${b.every===1?"un día":"una semana"} sin respaldar.`
    :m==="dir"?(bakDirH?`Se guarda un archivo por día en la carpeta «${b.dirName}», mientras el panel esté abierto. Se conservan los últimos 30 días.`:"Elige la carpeta. Puede ser una de OneDrive o Google Drive para que el respaldo quede en la nube.")
    :"La primera vez que abras el panel cada día se descarga un respaldo en la carpeta de descargas del navegador.")+last;
  $("#cBakAuto").value=b.auto?"1":"0"; $("#cBakMode").value=m; $("#cBakEvery").value=String(b.every===1?1:7);
  $("#bakModeRow").hidden=!b.auto; $("#bakEveryRow").hidden=b.auto;
  const o=$("#cBakMode option[value='dir']"); o.disabled=!CAN_DIR; o.textContent=CAN_DIR?"En una carpeta que elijo":"En una carpeta (solo Chrome y Edge)";
  $("#bakDir").hidden=!(b.auto&&m==="dir"); $("#bakDir").textContent=bakDirH?"Cambiar carpeta…":"Elegir carpeta…";
}
$("#bakGo").addEventListener("click",async()=>{
  if(bakAct==="pick"){ bakPick(); return; }
  if(bakAct==="perm"&&bakDirH){ try{ if(await bakDirH.requestPermission({mode:"readwrite"})==="granted"){ await bakDirWrite(); toast("Respaldo guardado en la carpeta"); } }catch{ toast("No se pudo usar la carpeta."); } bakCheck(); return; }
  doBackup();
});
$("#bakLater").addEventListener("click",()=>{ bakSet({snooze:Date.now()+864e5}); $("#bakBar").hidden=true; });
$("#bakNow").addEventListener("click",doBackup);
$("#bakDir").addEventListener("click",bakPick);
$("#cBakEvery").addEventListener("change",e=>{ bakSet({every:+e.target.value,snooze:0}); bakCheck(); });
const bakModeChange=()=>{ const auto=$("#cBakAuto").value==="1", mode=$("#cBakMode").value; bakSet({auto,mode});
  if(auto&&bakMode(bakGet())==="dir"&&!bakDirH){ bakInfo(); bakPick(); } else bakCheck(); };
$("#cBakAuto").addEventListener("change",bakModeChange); $("#cBakMode").addEventListener("change",bakModeChange);
$("#openSettings").addEventListener("click",bakInfo);
(async()=>{ if(CAN_DIR){ try{ bakDirH=(await idbKV("readonly",st=>st.get("dir")))||null; }catch{} } setTimeout(bakCheck,1500); setInterval(bakCheck,30*60000); })();

// ---------- weekly summary ----------
let wkOff=0;
const fmtDur=ms=>{ const m=Math.round(ms/60000), h=Math.floor(m/60); return h?`${h} h ${String(m%60).padStart(2,"0")} min`:`${m} min`; };
const stLabel=k=>(STATUS.find(x=>x[0]===k)||[,k])[1];
function wkData(){
  const ws=new Date(); ws.setHours(0,0,0,0); ws.setDate(ws.getDate()-((ws.getDay()+6)%7)+wkOff*7);
  const days=[...Array(7)].map((_,i)=>{ const d=new Date(ws); d.setDate(ws.getDate()+i); return dayKey(d); });
  const inWk=k=>k>=days[0]&&k<=days[6];
  const tt={}; // task id -> ms
  days.forEach(k=>{
    if(S.tlog[k]) Object.entries(S.tlog[k]).forEach(([id,v])=>tt[id]=(tt[id]||0)+v);
    else S.log.filter(e=>e.k==="focus"&&dayKey(e.t)===k).forEach(e=>(e.tasks||(e.task?[{id:e.task,min:e.min}]:[])).forEach(x=>tt[x.id]=(tt[x.id]||0)+x.min*60000));
  });
  if(T.track&&T.track.since&&inWk(dayKey(Date.now()))){ const live=liveSpent(taskById(T.track.id)||{})-(taskById(T.track.id)?.spent||0); if(live>0) tt[T.track.id]=(tt[T.track.id]||0)+live; }
  const closed=S.tasks.filter(t=>t.completed&&t.completedAt&&inWk(dayKey(t.completedAt))).sort((a,b)=>a.completedAt-b.completedAt);
  const worked=Object.keys(tt).map(taskById).filter(t=>t&&!closed.includes(t)).sort((a,b)=>tt[b.id]-tt[a.id]);
  const proj={}; const P=t=>t.tag||"Sin proyecto";
  Object.entries(tt).forEach(([id,v])=>{ const t=taskById(id); const k=t?P(t):"Tareas borradas"; (proj[k]=proj[k]||{ms:0,n:0}).ms+=v; });
  closed.forEach(t=>(proj[P(t)]=proj[P(t)]||{ms:0,n:0}).n++);
  const total=Object.values(tt).reduce((a,b)=>a+b,0);
  const pomos=S.log.filter(e=>e.k==="focus"&&!e.partial&&inWk(dayKey(e.t))).length;
  const jd=days.filter(jLive), tags={};
  jd.forEach(k=>{ const d=document.createElement("div"); d.innerHTML=J.days[k].html||""; d.querySelectorAll(".jtag[data-tag]").forEach(c=>tags[c.dataset.tag]=(tags[c.dataset.tag]||0)+1); });
  const late=wkOff===0?S.tasks.filter(isLate).sort((a,b)=>a.due<b.due?-1:1):[];
  return {days,ws,tt,closed,worked,proj:Object.entries(proj).sort((a,b)=>b[1].ms-a[1].ms||b[1].n-a[1].n),total,pomos,jd,tags:Object.entries(tags).sort((a,b)=>b[1]-a[1]),late};
}
const wkRange=w=>{ const a=new Date(w.ws), b=new Date(w.ws); b.setDate(a.getDate()+6);
  const f=(d,o)=>d.toLocaleDateString("es",o); return a.getMonth()===b.getMonth()?`${a.getDate()} – ${f(b,{day:"numeric",month:"short",year:"numeric"})}`:`${f(a,{day:"numeric",month:"short"})} – ${f(b,{day:"numeric",month:"short",year:"numeric"})}`; };
const wkDay=t=>new Date(t).toLocaleDateString("es",{weekday:"short",day:"numeric"});
function wkRender(){
  const w=wkData(), tag=t=>t.tag?`<span class="tag">${esc(t.tag)}</span>`:"";
  $("#wkRange").textContent=wkRange(w); $("#wkNow").hidden=wkOff===0; $("[data-wk='1']").disabled=wkOff>=0;
  const max=Math.max(1,...w.proj.map(p=>p[1].ms));
  $("#wkBody").innerHTML=`<div class="wkkpi"><div><b>${fmtDur(w.total)}</b><span>Tiempo en tareas</span></div><div><b>${w.closed.length}</b><span>Tareas cerradas</span></div><div><b>${w.pomos}</b><span>Pomodoros completos</span></div><div><b>${w.jd.length}</b><span>Días con bitácora</span></div></div>
  <div class="wksec"><h3>Por proyecto</h3>${w.proj.length?`<div class="wkproj">${w.proj.map(([k,v])=>`<div class="wkp"><span>${esc(k)}</span><div class="bar"><i style="width:${Math.round(v.ms/max*100)}%"></i></div><span class="v">${fmtDur(v.ms)}${v.n?` · ${v.n} cerrada${v.n!==1?"s":""}`:""}</span></div>`).join("")}</div>`:`<div class="wkempty">Sin tiempo registrado ni tareas cerradas esta semana.</div>`}</div>
  ${w.late.length?`<div class="wksec"><h3>Atrasadas ahora · ${w.late.length}</h3><ul class="wklist">${w.late.map(t=>`<li>${esc(t.title)} ${tag(t)}<span class="v late">${dueInfo(t.due).txt}</span></li>`).join("")}</ul></div>`:""}
  <div class="wksec"><h3>Tareas cerradas · ${w.closed.length}</h3>${w.closed.length?`<ul class="wklist">${w.closed.map(t=>`<li>${ic("check")} ${esc(t.title)} ${tag(t)}<span class="v">${wkDay(t.completedAt)}${w.tt[t.id]?" · "+fmtDur(w.tt[t.id]):""}</span></li>`).join("")}</ul>`:`<div class="wkempty">Ninguna tarea cerrada esta semana.</div>`}</div>
  ${w.worked.length?`<div class="wksec"><h3>Trabajadas sin cerrar · ${w.worked.length}</h3><ul class="wklist">${w.worked.map(t=>`<li>${esc(t.title)} ${tag(t)}<span class="v">${stLabel(t.status||"todo")} · ${fmtDur(w.tt[t.id])}</span></li>`).join("")}</ul></div>`:""}
  <div class="wksec"><h3>Bitácora</h3>${w.jd.length?`<div class="wkempty" style="margin-bottom:6px">${w.jd.length} día${w.jd.length!==1?"s":""} escrito${w.jd.length!==1?"s":""}: ${w.jd.map(k=>wkDay(new Date(k+"T12:00"))).join(", ")}.</div>${w.tags.length?`<div class="wktags">${w.tags.map(([k,n])=>`<span class="jtag" style="cursor:default;--th:${jHue(k)}">#${esc(k)} <b>${n}</b></span>`).join("")}</div>`:""}`:`<div class="wkempty">No hay días de bitácora esta semana.</div>`}</div>`;
}
function wkText(){
  const w=wkData(), L=[], tg=t=>t.tag?`[${t.tag}] `:"";
  L.push(`Resumen semanal · ${wkRange(w)}`,`Tiempo en tareas: ${fmtDur(w.total)} · Tareas cerradas: ${w.closed.length} · Pomodoros: ${w.pomos} · Días con bitácora: ${w.jd.length}`,"");
  if(w.proj.length){ L.push("Por proyecto"); w.proj.forEach(([k,v])=>L.push(`- ${k}: ${fmtDur(v.ms)}${v.n?` · ${v.n} cerrada${v.n!==1?"s":""}`:""}`)); L.push(""); }
  if(w.closed.length){ L.push("Tareas cerradas"); w.closed.forEach(t=>L.push(`- ${tg(t)}${t.title} (${wkDay(t.completedAt)})`)); L.push(""); }
  if(w.worked.length){ L.push("Trabajadas sin cerrar"); w.worked.forEach(t=>L.push(`- ${tg(t)}${t.title} · ${stLabel(t.status||"todo")} · ${fmtDur(w.tt[t.id])}`)); L.push(""); }
  if(w.late.length){ L.push("Atrasadas"); w.late.forEach(t=>L.push(`- ${tg(t)}${t.title} · ${dueInfo(t.due).txt}`)); L.push(""); }
  if(w.tags.length) L.push("Temas de la bitácora: "+w.tags.map(([k,n])=>`#${k} (${n})`).join(", "),"");
  if($("#wkJ").checked&&w.jd.length){ L.push("Bitácora"); w.jd.forEach(k=>{ L.push("",new Date(k+"T12:00").toLocaleDateString("es",{weekday:"long",day:"numeric",month:"long"}),jText(J.days[k].html||"").trim()); }); }
  return L.join("\n").trim()+"\n";
}
$("#wkBtn").addEventListener("click",()=>{ jSaveNow(); wkOff=0; wkRender(); $("#weekDlg").showModal(); });
$("#wkClose").addEventListener("click",()=>$("#weekDlg").close());
document.querySelectorAll("[data-wk]").forEach(b=>b.addEventListener("click",()=>{ const v=+b.dataset.wk; wkOff=v?Math.min(0,wkOff+v):0; wkRender(); }));
$("#wkJ").checked=!!lsGet("pp-wkj"); $("#wkJ").addEventListener("change",e=>lsSet("pp-wkj",e.target.checked));
$("#wkCopy").addEventListener("click",async()=>{ const t=wkText(); try{ await navigator.clipboard.writeText(t); toast("Resumen copiado"); }catch{ const a=document.createElement("textarea"); a.value=t; document.body.appendChild(a); a.select(); try{ document.execCommand("copy"); toast("Resumen copiado"); }catch{ toast("No se pudo copiar"); } a.remove(); } });
$("#wkDl").addEventListener("click",()=>{ const w=wkData(); saveFile(`resumen-semana-${w.days[0]}.txt`,wkText(),"text/plain","Resumen"); });

// ---------- bitácora <-> tasks ----------
// open the journal where it is visible: the tab when the panel shows it, otherwise the side drawer
function jShow(k){ const side=$("#journal").classList.contains("side"), inTab=jTab==="journal"&&!$("#grid").classList.contains("collapsed")&&!$(".tasks-panel").classList.contains("side");
  if(!side&&!inTab) jSideOpen(); jOpen(k); }
function showTask(id,opt){ if($("#journal").classList.contains("side")) jSideClose(); jSetTab("tasks"); goToTask(id,opt); }
function jGoTask(t){ if(!t.jday) return; jShow(t.jday);
  const c=jEd.querySelector(`.jtask[data-task="${t.id}"]`); if(c){ c.scrollIntoView({block:"center",behavior:"smooth"}); c.classList.remove("jflash"); void c.offsetWidth; c.classList.add("jflash"); } }
function jToTask(){
  const sel=getSelection(); if(!sel.rangeCount||!jEd.contains(sel.anchorNode)){ toast("Pon el cursor en una línea de la bitácora o selecciona texto."); return; }
  const r=sel.getRangeAt(0);
  // the line = the top-level block (or list item) holding the cursor
  let blk=sel.anchorNode.nodeType===1?sel.anchorNode:sel.anchorNode.parentElement;
  while(blk&&blk!==jEd&&!(blk.tagName==="LI"||blk.parentElement===jEd)) blk=blk.parentElement;
  if(!blk||blk===jEd){ blk=null; }
  const chipless=n=>{ const c=n.cloneNode(true); c.querySelectorAll&&c.querySelectorAll(".jtask,.jtag").forEach(x=>x.remove()); return c.textContent; };
  let text=r.collapsed?(blk?chipless(blk):""):(()=>{ const d=document.createElement("div"); d.appendChild(r.cloneContents()); return chipless(d); })();
  text=text.replace(/\s+/g," ").trim().replace(/^(\d+[.)]|[-•*])\s+/,"").trim();
  if(!text){ toast("Esa línea está vacía. Escribe algo o selecciona texto."); return; }
  if(text.length>200) text=text.slice(0,200)+"…";
  const projects=new Set(S.tasks.map(x=>x.tag).filter(Boolean)), src=blk||jEd;
  const tg=[...src.querySelectorAll(".jtag[data-tag]")].map(x=>x.dataset.tag), tag=tg.find(x=>projects.has(x))||tg[0]||"";
  const t={id:uid(),title:text,tag,status:"todo",crit:"media",due:null,jday:jCur,est:1,pomos:0,spent:0,completed:false,createdAt:Date.now(),order:Date.now()};
  S.tasks.push(t); if(!S.activeTaskId) S.activeTaskId=t.id;
  const chip=document.createElement("span"); chip.className="jtask"; chip.setAttribute("data-task",t.id); chip.setAttribute("contenteditable","false"); chip.textContent="↗ tarea"; chip.title="Ir a la tarea";
  const at=document.createRange();
  if(!r.collapsed){ at.setStart(r.endContainer,r.endOffset); }
  else if(blk){ at.selectNodeContents(blk); at.collapse(false); if(blk.lastChild&&blk.lastChild.nodeName==="BR") at.setStartBefore(blk.lastChild); }
  else { at.setStart(r.startContainer,r.startOffset); }
  at.collapse(true); at.insertNode(chip); chip.before(document.createTextNode(" "));
  jEdited=true; jStore(jCur); jMarkTasks(); commit();
  toast(`Tarea creada: ${text.length>40?text.slice(0,40)+"…":text}`);
}
// strike chips whose task is closed, drop the ones whose task was deleted
function jMarkTasks(){ jEd.querySelectorAll(".jtask[data-task]").forEach(c=>{ const t=taskById(c.dataset.task);
  c.classList.toggle("done",!!(t&&t.completed)); c.title=t?`Ir a la tarea: ${t.title}${t.completed?" (cerrada)":""}`:"La tarea ya no existe"; c.classList.toggle("gone",!t); }); }
$("#jToTask").addEventListener("mousedown",e=>e.preventDefault()); // keep the editor selection
$("#jToTask").addEventListener("click",jToTask);
jEd.addEventListener("keydown",e=>{ if((e.ctrlKey||e.metaKey)&&e.shiftKey&&(e.key==="E"||e.key==="e")){ e.preventDefault(); jToTask(); } });
jEd.addEventListener("click",e=>{ const c=e.target.closest(".jtask[data-task]"); if(!c) return; e.preventDefault(); if(taskById(c.dataset.task)) showTask(c.dataset.task); else toast("Esa tarea ya no existe."); });
new MutationObserver(()=>{ if(jEd.querySelector(".jtask:not([title])")) jMarkTasks(); }).observe(jEd,{childList:true});

// ---------- quick finder (Ctrl+K) ----------
const ck=$("#cmdk"); let ckItems=[], ckSel=0;
const CK_CMDS=[
  ["plus","Nueva tarea",()=>{ showTask(null); setCollapsed(false); showTaskForm(true); }],
  ["zap","Ingreso rápido",()=>{ showTask(null); setCollapsed(false); showQuick(true); $("#qaText").focus(); }],
  ["play","Iniciar o pausar el temporizador",()=>{ T.running?pause():start(); },"Espacio"],
  ["book","Bitácora de hoy",()=>jShow(jToday())],
  ["side","Abrir tareas al costado",()=>tSideOpen()],
  ["board","Tablero Kanban",()=>{ $("#kanban").showModal(); renderKanban(); }],
  ["cal","Calendario",()=>calOpen(),"C"],
  ["sum","Resumen semanal",()=>$("#wkBtn").click()],
  ["alert","Ver tareas atrasadas",()=>{ filter="late"; lsSet("pp-filter",filter); showTask(null); render(); }],
  ["star","Ver tareas de hoy",()=>{ filter="star"; lsSet("pp-filter",filter); showTask(null); render(); }],
  ["gear","Ajustes",()=>$("#openSettings").click()],
  ["down","Descargar respaldo",()=>doBackup()],
  ["upl","Importar respaldo",()=>$("#importBtn").click()],
];
function ckHl(txt,q){ if(!q) return esc(txt); const f=fold(txt), i=f.indexOf(q); if(i<0||f.length!==txt.length) return esc(txt); return esc(txt.slice(0,i))+"<mark>"+esc(txt.slice(i,i+q.length))+"</mark>"+esc(txt.slice(i+q.length)); }
function ckBuild(){
  const raw=$("#ckIn").value.trim(), q=fold(raw), qw=q?q.split(/\s+/):[], has=h=>qw.every(w=>h.includes(w));
  const out=[];
  const cmds=CK_CMDS.filter(c=>!q||has(fold(c[1])));
  if(cmds.length) out.push({h:"Comandos"},...cmds.map(c=>({i:ic(c[0]),l:ckHl(c[1],q),s:c[3]||"",run:c[2]})));
  const tasks=(q?S.tasks.filter(t=>has(fold(t.title+" "+(t.tag||"")))):S.tasks.filter(t=>!t.completed&&(t.star||t.status==="doing")))
    .sort((a,b)=>(a.completed-b.completed)||((b.status==="doing")-(a.status==="doing"))||(b.createdAt-a.createdAt)).slice(0,q?8:6);
  if(tasks.length) out.push({h:q?"Tareas":"Hoy y en curso"},...tasks.map(t=>({i:ic(t.completed?"check":"circle"),l:ckHl(t.title,q)+(t.tag?` <span class="tag">${esc(t.tag)}</span>`:""),s:t.completed?"Cerrada":STL[t.status||"todo"],run:()=>showTask(t.id)})));
  if(q){ const res=[], days=jDays().slice().reverse();
    days.forEach(k=>{ if(res.length>=6) return; const lab=jLabel(k,true);
      if(has(fold(lab+" "+k))){ res.push({i:ic("book"),l:ckHl(lab,q),s:"Día",run:()=>jShow(k)}); return; }
      const txt=jText(J.days[k].html||""), f=fold(txt), i=f.indexOf(qw[0]); if(i<0||!has(f)) return;
      const ls=txt.lastIndexOf("\n",i-1)+1, le=txt.indexOf("\n",i), line=txt.slice(ls,le<0?undefined:le).replace(/\t/g," ").trim();
      res.push({i:ic("book"),l:ckHl(line.slice(0,140),qw[0]),s:jLabel(k),run:()=>{ jShow(k); jReveal(qw[0],0); }}); });
    if(res.length) out.push({h:"Bitácora"},...res); }
  ckItems=out.filter(x=>!x.h); ckSel=Math.min(ckSel,Math.max(0,ckItems.length-1));
  let ix=0;
  $("#ckList").innerHTML=out.length?out.map(x=>x.h?`<div class="h">${x.h}</div>`:`<button type="button" role="option" data-ix="${ix}" aria-selected="${ix++===ckSel}"><span class="i">${x.i}</span><span class="l">${x.l}</span><span class="s">${esc(x.s)}</span></button>`).join("")
    :`<div class="none">Nada coincide con «${esc(raw)}».</div>`;
}
function ckMove(d){ if(!ckItems.length) return; ckSel=(ckSel+d+ckItems.length)%ckItems.length;
  $("#ckList").querySelectorAll("button").forEach(b=>b.setAttribute("aria-selected",String(+b.dataset.ix===ckSel)));
  const b=$(`#ckList button[data-ix="${ckSel}"]`); b&&b.scrollIntoView({block:"nearest"}); }
function ckRun(i){ const it=ckItems[i]; if(!it) return; ck.close(); setTimeout(()=>it.run(),0); }
function ckOpen(){ if(ck.open){ $("#ckIn").select(); return; } document.querySelectorAll("dialog[open]").forEach(d=>d.close()); jSaveNow(); $("#ckIn").value=""; ckSel=0; ckBuild(); ck.showModal(); $("#ckIn").focus(); }
$("#ckIn").addEventListener("input",()=>{ ckSel=0; ckBuild(); });
$("#ckIn").addEventListener("keydown",e=>{ if(e.key==="ArrowDown"){ e.preventDefault(); ckMove(1); } else if(e.key==="ArrowUp"){ e.preventDefault(); ckMove(-1); } else if(e.key==="Enter"){ e.preventDefault(); ckRun(ckSel); } });
$("#ckList").addEventListener("click",e=>{ const b=e.target.closest("button[data-ix]"); if(b) ckRun(+b.dataset.ix); });
$("#ckList").addEventListener("mousemove",e=>{ const b=e.target.closest("button[data-ix]"); if(b&&+b.dataset.ix!==ckSel){ ckSel=+b.dataset.ix; ckMove(0); } });
ck.addEventListener("click",e=>{ if(e.target===ck) ck.close(); });
$("#ckBtn").addEventListener("click",ckOpen);
document.addEventListener("keydown",e=>{ if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&!e.altKey&&(e.key==="k"||e.key==="K")){ e.preventDefault(); e.stopPropagation(); ckOpen(); } },true);

// ---------- calendar: tasks by due date (open) and by closing day (closed) ----------
let calView=lsGet("pp-calview")||"week", calDay=dayKey(Date.now()), calAdd=null;
const kParse=k=>{ const [y,m,d]=k.split("-").map(Number); return new Date(y,m-1,d); };
const kAdd=(k,n)=>{ const d=kParse(k); d.setDate(d.getDate()+n); return dayKey(d); };
const kMon=k=>{ const d=kParse(k); d.setDate(d.getDate()-((d.getDay()+6)%7)); return dayKey(d); };
function recStep(rec,k){ const dt=kParse(k);
  if(rec==="week") dt.setDate(dt.getDate()+7);
  else if(rec==="month"){ const dd=dt.getDate(); dt.setDate(1); dt.setMonth(dt.getMonth()+1); dt.setDate(Math.min(dd,new Date(dt.getFullYear(),dt.getMonth()+1,0).getDate())); }
  else { dt.setDate(dt.getDate()+1); if(rec==="weekday") while(dt.getDay()===0||dt.getDay()===6) dt.setDate(dt.getDate()+1); }
  return dayKey(dt); }
// everything that falls on each day of [from,to]
function calData(from,to){
  const M={}, at=k=>M[k]||(M[k]={due:[],rep:[],done:[],ms:0});
  S.tasks.forEach(t=>{
    if(t.completed){ if(t.completedAt){ const k=dayKey(t.completedAt); if(k>=from&&k<=to) at(k).done.push(t); } return; }
    if(t.due&&t.due>=from&&t.due<=to) at(t.due).due.push(t);
    if(t.due&&t.rec&&REC[t.rec]){ let k=t.due, g=0; while(g++<62){ k=recStep(t.rec,k); if(k>to) break; if(k>=from) at(k).rep.push(t); } }
  });
  for(let k=from;k<=to;k=kAdd(k,1)) if(S.tlog[k]) at(k).ms=Object.values(S.tlog[k]).reduce((a,b)=>a+b,0);
  const CR={alta:0,media:1,baja:2}; Object.values(M).forEach(d=>d.due.sort((a,b)=>(CR[a.crit||"media"]-CR[b.crit||"media"])||(a.order??a.createdAt)-(b.order??b.createdAt)));
  return M;
}
const calDayName=(k,o)=>kParse(k).toLocaleDateString("es",o||{weekday:"short",day:"numeric"});
function calCard(t,kind,k){
  const today=dayKey(Date.now()), late=kind==="due"&&k<today, trk=T.track&&T.track.id===t.id;
  return `<article class="calcard ${kind} ${late?"late":""} ${trk?"tracking":""}" ${kind==="due"?'draggable="true"':""} data-id="${t.id}" title="${esc(t.title)}${kind==="rep"?" · repetición prevista":kind==="done"?" · cerrada":""}">
    <div class="kt">${kind==="done"?`<span class="ci ok">${ic("check")}</span>`:kind==="rep"?`<span class="ci">${ic("rep")}</span>`:t.star?`<span class="ks">${ic("star","fill")}</span>`:""}${esc(t.title)}</div>
    ${kind==="rep"?"":`<div class="meta">${kind==="due"?sig(t.crit||"media"):""}${t.tag?`<span class="tag">${esc(t.tag)}</span>`:""}${kind==="due"&&t.status&&t.status!=="todo"?`<span>${STL[t.status]}</span>`:""}${late?`<span class="due over">Atrasada</span>`:""}</div>`}</article>`;
}
// days with something written in the bitácora get a book icon; it opens a read-only preview
const calJHas=k=>{ const d=J.days[k]; return !!(d&&!d.deleted&&d.html&&jText(d.html).trim()); };
const calJBtn=k=>calJHas(k)?`<button type="button" class="caljb" data-calj="${k}" title="Ver bitácora de este día" aria-label="Ver bitácora" aria-expanded="${calJDay===k}">${ic("book")}</button>`:"";
let calJDay=null;
function calJFill(el,k){ el.innerHTML=jClean(J.days[k].html||""); el.classList.toggle("sans",jEd.classList.contains("sans")); jLinkify(el);
  el.querySelectorAll(".jtask[data-task]").forEach(c=>{ const t=taskById(c.dataset.task); c.classList.toggle("done",!!(t&&t.completed)); c.classList.toggle("gone",!t); c.title=t?"Ir a la tarea: "+t.title:"La tarea ya no existe"; }); }
function calJShow(k){ const p=$("#calJ");
  if(!k||!calJHas(k)||calJDay===k){ calJDay=null; p.hidden=true; }
  else { calJDay=k; $("#calJTitle").innerHTML=ic("book")+esc(jLabel(k,true).replace(/^./,c=>c.toUpperCase())); calJFill($("#calJBody"),k); p.hidden=false; $("#calJBody").scrollTop=0; }
  document.querySelectorAll("#calBody [data-calj]").forEach(b=>b.setAttribute("aria-expanded",String(b.dataset.calj===calJDay))); }
function calJGo(k){ $("#cal").close(); jShow(k); }
// links and task chips inside a preview
function calJClick(e){ const a=e.target.closest("a[href]"); if(a){ e.preventDefault(); window.open(a.href,"_blank","noopener"); return true; }
  const c=e.target.closest(".jtask[data-task]"); if(c){ e.preventDefault(); if(taskById(c.dataset.task)){ $("#cal").close(); showTask(c.dataset.task); } else toast("Esa tarea ya no existe."); return true; }
  return !!e.target.closest(".calj-body"); }
$("#calJClose").addEventListener("click",()=>calJShow(null));
$("#calJOpen").addEventListener("click",()=>{ if(calJDay) calJGo(calJDay); });
$("#calJBody").addEventListener("click",calJClick);
$("#cal").addEventListener("cancel",e=>{ if(calJDay){ e.preventDefault(); calJShow(null); } });
$("#cal").addEventListener("close",()=>calJShow(null));
function calAddBox(k){ return calAdd===k?`<div class="caladd"><input type="text" data-caladd="${k}" placeholder="Nueva tarea y Enter" aria-label="Nueva tarea para ${esc(calDayName(k,{weekday:"long",day:"numeric",month:"long"}))}"></div>`
  :`<button class="calplus" type="button" data-calplus="${k}" title="Agregar una tarea que vence este día">+ Agregar</button>`; }
function calRender(){
  const dlg=$("#cal"); if(!dlg.open) return;
  const ae=document.activeElement; if(ae&&ae.matches&&ae.matches("[data-caladd]")) return;
  document.querySelectorAll("[data-calv]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.calv===calView)));
  const today=dayKey(Date.now()), box=$("#calBody"); box.className="calbody v-"+calView; $("#calHint").hidden=calView==="day";
  if(calView==="week"){
    const a=kMon(calDay), z=kAdd(a,6), M=calData(a,z), A=kParse(a), Z=kParse(z);
    $("#calRange").textContent=A.getMonth()===Z.getMonth()?`${A.getDate()} – ${Z.toLocaleDateString("es",{day:"numeric",month:"short",year:"numeric"})}`:`${A.toLocaleDateString("es",{day:"numeric",month:"short"})} – ${Z.toLocaleDateString("es",{day:"numeric",month:"short",year:"numeric"})}`;
    let h=""; for(let k=a;k<=z;k=kAdd(k,1)){ const d=M[k]||{due:[],rep:[],done:[],ms:0}, n=d.due.length+d.rep.length+d.done.length;
      h+=`<section class="calcol ${k===today?"today":""} ${k<today?"past":""}" data-day="${k}"><h3><button type="button" class="calday" data-calday="${k}" title="Ver este día">${calDayName(k)}</button>${calJBtn(k)}${d.ms?`<span class="ms" title="Tiempo trabajado">${fmtDur(d.ms)}</span>`:""}</h3>
        ${d.due.map(t=>calCard(t,"due",k)).join("")}${d.rep.map(t=>calCard(t,"rep",k)).join("")}${d.done.map(t=>calCard(t,"done",k)).join("")}
        ${n?"":`<div class="calempty">Sin tareas</div>`}${calAddBox(k)}</section>`; }
    box.innerHTML=h;
  } else if(calView==="month"){
    const d0=kParse(calDay); d0.setDate(1); const first=dayKey(d0), a=kMon(first), z=kAdd(a,41), M=calData(a,z), mon=d0.getMonth();
    $("#calRange").textContent=d0.toLocaleDateString("es",{month:"long",year:"numeric"}).replace(/^./,c=>c.toUpperCase());
    let h=["lun","mar","mié","jue","vie","sáb","dom"].map(x=>`<div class="calwd">${x}</div>`).join("");
    for(let k=a;k<=z;k=kAdd(k,1)){ const d=M[k]||{due:[],rep:[],done:[]}, items=[...d.due.map(t=>[t,"due"]),...d.rep.map(t=>[t,"rep"]),...d.done.map(t=>[t,"done"])];
      h+=`<section class="calcell ${kParse(k).getMonth()!==mon?"out":""} ${k===today?"today":""}" data-day="${k}"><div class="calctop"><button type="button" class="calday" data-calday="${k}" title="Ver este día">${kParse(k).getDate()}</button>${calJBtn(k)}</div>
        ${items.slice(0,3).map(([t,kind])=>`<div class="calchip ${kind} ${kind==="due"&&k<today?"late":""}" ${kind==="due"?'draggable="true"':""} data-id="${t.id}" title="${esc(t.title)}">${kind==="done"?ic("check")+" ":kind==="rep"?ic("rep")+" ":""}${esc(t.title)}</div>`).join("")}
        ${items.length>3?`<button type="button" class="calmore" data-calday="${k}">+${items.length-3} más</button>`:""}</section>`; }
    box.innerHTML=h;
  } else {
    const k=calDay, M=calData(k,k), d=M[k]||{due:[],rep:[],done:[],ms:0};
    $("#calRange").textContent=(k===today?"Hoy · ":"")+calDayName(k,{weekday:"long",day:"numeric",month:"long"});
    const late=k===today?S.tasks.filter(t=>!t.completed&&t.due&&t.due<k).sort((a,b)=>a.due<b.due?-1:1):[];
    const star=k===today?S.tasks.filter(t=>!t.completed&&t.star&&!(t.due&&t.due<=k)):[];
    const worked=S.tlog[k]?Object.entries(S.tlog[k]).map(([id,ms])=>[taskById(id),ms]).filter(x=>x[0]).sort((a,b)=>b[1]-a[1]):[];
    const sec=(title,list,kind)=>list.length?`<div class="calsec"><h3>${title} · ${list.length}</h3><div class="callist">${list.map(t=>calCard(t,kind,kind==="due"&&t.due?t.due:k)).join("")}</div></div>`:"";
    { const r=$("#calRange"); r.textContent=r.textContent.replace(/^./,c=>c.toUpperCase()); }
    box.innerHTML=`<section class="calcol calone ${k===today?"today":""}" data-day="${k}">
      ${sec("Atrasadas",late,"due")}${sec(k===today?"Vencen hoy":"Vencen este día",d.due,"due")}${sec(ic("star","fill")+" Marcadas para hoy",star,"due")}${sec("Repeticiones previstas",d.rep,"rep")}${sec("Cerradas",d.done,"done")}
      ${calJHas(k)?`<div class="calsec"><h3>${ic("book")} Bitácora <button class="btn sm" type="button" data-cajgo="${k}">Abrir en bitácora</button></h3><div class="jed calj-body" data-cajday="${k}"></div></div>`:""}
      ${worked.length?`<div class="calsec"><h3>Tiempo trabajado · ${fmtDur(d.ms)}</h3><ul class="wklist">${worked.map(([t,ms])=>`<li>${esc(t.title)} ${t.tag?`<span class="tag">${esc(t.tag)}</span>`:""}<span class="v">${fmtDur(ms)}</span></li>`).join("")}</ul></div>`:""}
      ${late.length+d.due.length+star.length+d.rep.length+d.done.length+worked.length+(calJHas(k)?1:0)?"":`<div class="calempty">Nada para este día.</div>`}
      ${calAddBox(k)}</section>`;
    const jb=box.querySelector("[data-cajday]"); if(jb) calJFill(jb,k);
  }
  if(calView==="day"&&calJDay) calJShow(null);
  if(calAdd){ const i=$(`[data-caladd="${calAdd}"]`); i&&i.focus(); }
}
function calOpen(){ jSaveNow(); calDay=dayKey(Date.now()); calAdd=null; calJDay=null; $("#cal").showModal(); calRender(); }
$("#calBtn").addEventListener("click",e=>{ e.stopPropagation(); calOpen(); });
$("#calClose").addEventListener("click",()=>$("#cal").close());
document.querySelectorAll("[data-calv]").forEach(b=>b.addEventListener("click",()=>{ calView=b.dataset.calv; lsSet("pp-calview",calView); calAdd=null; calRender(); }));
document.querySelectorAll("[data-caln]").forEach(b=>b.addEventListener("click",()=>{ const n=+b.dataset.caln; calAdd=null;
  if(!n) calDay=dayKey(Date.now());
  else if(calView==="month"){ const d=kParse(calDay); d.setDate(1); d.setMonth(d.getMonth()+n); calDay=dayKey(d); }
  else calDay=kAdd(calDay,n*(calView==="week"?7:1));
  calRender(); }));
$("#calBody").addEventListener("click",e=>{
  const jb=e.target.closest("[data-calj]"); if(jb){ e.stopPropagation(); calJShow(jb.dataset.calj); return; }
  const jg=e.target.closest("[data-cajgo]"); if(jg){ calJGo(jg.dataset.cajgo); return; }
  if(calJClick(e)) return;
  const dy=e.target.closest("[data-calday]"); if(dy){ calDay=dy.dataset.calday; calView="day"; lsSet("pp-calview",calView); calAdd=null; calRender(); return; }
  const pl=e.target.closest("[data-calplus]"); if(pl){ calAdd=pl.dataset.calplus; calRender(); return; }
  const c=e.target.closest("[data-id]"); if(c&&taskById(c.dataset.id)){ $("#cal").close(); showTask(c.dataset.id); }
});
$("#calBody").addEventListener("keydown",e=>{ const i=e.target.closest("[data-caladd]"); if(!i) return;
  if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); calAdd=null; i.blur(); calRender(); return; }
  if(e.key!=="Enter") return; e.preventDefault(); const title=i.value.trim(), k=i.dataset.caladd; if(!title) return;
  S.tasks.push({id:uid(),title,tag:tagF||"",status:"todo",crit:"media",due:k,est:1,pomos:0,spent:0,completed:false,createdAt:Date.now(),order:Date.now()});
  i.value=""; i.blur(); commit(); calRender(); toast("Tarea agregada"); });
$("#calBody").addEventListener("focusout",e=>{ if(e.target.matches("[data-caladd]")&&!e.target.value.trim()) setTimeout(()=>{ if(calAdd===e.target.dataset.caladd&&document.activeElement!==e.target){ calAdd=null; calRender(); } },150); });
// drag a pending task to another day to change its due date
$("#calBody").addEventListener("dragstart",e=>{ const c=e.target.closest("[draggable][data-id]"); if(!c) return; e.dataTransfer.setData("text/plain",c.dataset.id); e.dataTransfer.effectAllowed="move"; c.classList.add("dragging"); });
$("#calBody").addEventListener("dragend",e=>{ const c=e.target.closest&&e.target.closest("[data-id]"); c&&c.classList.remove("dragging"); document.querySelectorAll("#calBody .over").forEach(x=>x.classList.remove("over")); });
$("#calBody").addEventListener("dragover",e=>{ const d=e.target.closest("[data-day]"); if(!d||calView==="day") return; e.preventDefault(); e.dataTransfer.dropEffect="move";
  document.querySelectorAll("#calBody .over").forEach(x=>{ if(x!==d) x.classList.remove("over"); }); d.classList.add("over"); });
$("#calBody").addEventListener("drop",e=>{ const d=e.target.closest("[data-day]"); if(!d) return; e.preventDefault(); d.classList.remove("over");
  const t=taskById(e.dataTransfer.getData("text/plain")); if(!t||t.completed||t.due===d.dataset.day) return;
  t.due=d.dataset.day; commit(); calRender(); toast(`${t.title}: ${dueInfo(t.due).txt.toLowerCase()}`); });

// in-page confirmation (the viewer blocks native confirm())
function confirmDel(msg,onYes,opt={}){ const d=$("#confirmDlg"); $("#confirmMsg").textContent=msg;
  $("#confirmTitle").textContent=opt.title||"Confirmar eliminación"; $("#confirmYes").textContent=opt.yes||"Eliminar"; d.returnValue=""; d.onclose=()=>{ d.onclose=null; if(d.returnValue==="yes") onYes(); }; d.showModal(); $("#confirmNo").focus(); }

let toastT=null;
function toast(m){ const el=$("#toast"); el.textContent=m; el.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>el.hidden=true,2600); }

// ---------- radios: live stations from the open radio-browser.info directory ----------
// The Claude view cannot reach outside servers, so radios live only in the local copy and the installed app.
const RAD_ON=EMBED; var radNowName=""; // shown in the Música header
const RAD_C=[["CL","Chile"],["AR","Argentina"],["PE","Perú"],["MX","México"],["CO","Colombia"],["UY","Uruguay"],["BO","Bolivia"],["EC","Ecuador"],["PY","Paraguay"],["VE","Venezuela"],["ES","España"],["US","Estados Unidos"]];
const RAD_SRV=["de1","nl1","at1","de2","fi1"].map(x=>`https://${x}.api.radio-browser.info`);
const RAD={audio:null,cur:null,list:[],shown:30,state:"",q:"",seq:0,cache:{}};
const radCanHls=!!document.createElement("audio").canPlayType("application/vnd.apple.mpegurl");
const radSecure=location.protocol==="https:";
async function radApi(path){ let last; for(const base of RAD_SRV){ try{ const r=await fetch(base+path,{headers:{Accept:"application/json"}}); if(r.ok) return await r.json(); last=new Error(r.status); }catch(e){ last=e; } } throw last||new Error("sin servidor"); }
// stations this page can actually play: working, not HLS (except Safari), https when the page is https
function radUsable(x){ const u=x.url_resolved||x.url||""; return x.lastcheckok!==0&&u&&(!x.hls||radCanHls)&&(!radSecure||u.startsWith("https:")); }
const radStation=x=>({id:x.stationuuid,name:(x.name||"").trim()||"Sin nombre",url:x.url_resolved||x.url,logo:x.favicon&&(!radSecure||x.favicon.startsWith("https:"))?x.favicon:"",tags:(x.tags||"").split(",").map(t=>t.trim()).filter(Boolean).slice(0,2).join(", "),city:(x.state||"").trim(),br:x.bitrate||0});
async function radLoad(){
  const cc=S.settings.radCountry||radDefCountry(), q=RAD.q.trim(), key=cc+"|"+fold(q), my=++RAD.seq;
  if(RAD.cache[key]){ RAD.list=RAD.cache[key]; RAD.state=""; radRender(); return; }
  RAD.state="loading"; radRender();
  try{
    const qs=new URLSearchParams({countrycode:cc,hidebroken:"true",order:"clickcount",reverse:"true",limit:q?"120":"200"}); if(q) qs.set("name",q);
    const raw=await radApi("/json/stations/search?"+qs); if(my!==RAD.seq) return;
    const seen=new Set(), list=[];
    raw.filter(radUsable).forEach(x=>{ const st=radStation(x), k=fold(st.name).replace(/\s+/g," "); if(seen.has(k)) return; seen.add(k); list.push(st); });
    RAD.cache[key]=list; RAD.list=list; RAD.state="";
  }catch(e){ if(my!==RAD.seq) return; RAD.list=[]; RAD.state="error"; }
  RAD.shown=30; radRender();
}
function radDefCountry(){ const l=navigator.language||"", m=l.match(/^es-([A-Z]{2})$/i), c=m&&m[1].toUpperCase(); return RAD_C.some(x=>x[0]===c)?c:"CL"; }
const radFavs=()=>Array.isArray(S.settings.radFav)?S.settings.radFav:[];
// stations added by hand (a stream link plays here, a web page such as emisoras.cl opens in a small window)
const radMine=()=>Array.isArray(S.settings.radMine)?S.settings.radMine:[];
const radIsStream=u=>/\.(mp3|aac|aacp|ogg|opus|m3u8?|pls|flac)(\?|$)|\/(stream|live|listen|icecast|radio\.mp3)\b|;stream|:\d{2,5}\//i.test(u);
var radWin=null, radWinT=null;
function radPopup(st){ if(RAD.audio){ RAD.audio.pause(); RAD.audio.removeAttribute("src"); }
  radWin=window.open(st.page||st.url,"pp-radio","width=440,height=680");
  if(!radWin){ toast("El navegador bloqueó la ventana. Permite ventanas emergentes para este sitio."); return; }
  RAD.cur={...st,win:true}; radNowName=st.name; ambUI(); radRender();
  clearInterval(radWinT); radWinT=setInterval(()=>{ if(!radWin||radWin.closed){ clearInterval(radWinT); radWin=null; if(RAD.cur&&RAD.cur.win){ RAD.cur=null; radNowName=""; ambUI(); radRender(); } } },1000); }
const radIsFav=id=>radFavs().some(f=>f.id===id);
function radLogo(st){ return `<span class="lg">${st.logo?`<img src="${esc(st.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`:""}${ic("head")}</span>`; }
function radRow(st){ const on=RAD.cur&&RAD.cur.id===st.id, fav=radIsFav(st.id);
  if(st.mine) return `<li class="rad ${on?"cur":""}" data-rad="${esc(st.id)}" title="${on?"Sonando":"Escuchar"} ${esc(st.name)}">${radLogo(st)}
    <div style="min-width:0"><div class="nm">${esc(st.name)}</div><div class="meta">${radIsStream(st.url)?"Señal en vivo":"Se abre en ventana aparte"} · ${esc((()=>{ try{ return new URL(st.url).hostname.replace(/^www\./,""); }catch{ return ""; } })())}</div></div>
    <button class="x" type="button" data-radx aria-label="Quitar ${esc(st.name)}" title="Quitar de mis radios">${ic("x")}</button></li>`;
  return `<li class="rad ${on?"cur":""}" data-rad="${esc(st.id)}" title="${on?"Sonando":"Escuchar"} ${esc(st.name)}">${radLogo(st)}
    <div style="min-width:0"><div class="nm">${esc(st.name)}</div><div class="meta">${esc([st.city,st.tags].filter(Boolean).join(" · ")||"Radio en vivo")}</div></div>
    <button class="star ${fav?"on":""}" type="button" data-radfav aria-pressed="${fav}" aria-label="${fav?"Quitar de favoritas":"Agregar a favoritas"}" title="${fav?"Quitar de favoritas":"Agregar a favoritas"}">${ic("star",fav?"fill":"")}</button></li>`; }
function radRender(){
  if(!RAD_ON) return;
  const sel=$("#radCountry"), cc=S.settings.radCountry||radDefCountry();
  if(!sel.options.length) sel.innerHTML=RAD_C.map(([c,n])=>`<option value="${c}">${n}</option>`).join("");
  sel.value=cc;
  const favs=radFavs(), q=fold(RAD.q.trim()), favShow=q?favs.filter(f=>fold(f.name).includes(q)):favs, favIds=new Set(favs.map(f=>f.id));
  let h="";
  const mine=radMine().filter(m=>!q||fold(m.name).includes(q));
  if(mine.length) h+=`<li class="sub">Mis radios</li>`+mine.map(radRow).join("");
  if(favShow.length) h+=`<li class="sub">Favoritas</li>`+favShow.map(radRow).join("");
  const rest=RAD.list.filter(x=>!favIds.has(x.id));
  if(RAD.state==="loading") h+=`<li class="msg">Buscando emisoras…</li>`;
  else if(RAD.state==="error") h+=`<li class="msg">No se pudo cargar el directorio de radios. Puede que tu red bloquee radio-browser.info. Agrega tus emisoras con «+ Agregar radio», pegando el link de la emisora en emisoras.cl.<br><a class="btn sm" href="https://emisoras.cl" target="_blank" rel="noopener noreferrer">Abrir emisoras.cl</a></li>`;
  else if(!rest.length) h+=`<li class="msg">${q?`Ninguna emisora coincide con «${esc(RAD.q.trim())}».`:"No hay emisoras disponibles para este país."}</li>`;
  else h+=(favShow.length?`<li class="sub">${q?"Resultados":"Más escuchadas"}</li>`:"")+rest.slice(0,RAD.shown).map(radRow).join("");
  $("#radList").innerHTML=h;
  $("#radMore").hidden=RAD.state!==""||rest.length<=RAD.shown;
  const n=$("#radNow"), c=RAD.cur;
  n.hidden=!c;
  if(c&&c.win){ n.innerHTML=`<div class="nm">${esc(c.name)}<div class="st">Sonando en una ventana aparte</div></div><button class="btn sm" type="button" data-radshow>Mostrar</button><button class="btn sm" type="button" data-radstop>Cerrar</button>`; return; }
  if(c){ const st=RAD.audio&&RAD.audio.paused?"En pausa":RAD.audio&&RAD.audio.dataset.st==="wait"?"Conectando…":"En vivo";
    n.innerHTML=`<button class="btn track" type="button" data-radtoggle aria-label="${st==="En pausa"?"Reanudar":"Pausar"}" title="${st==="En pausa"?"Reanudar":"Pausar"}">${ic(st==="En pausa"?"play":"pause")}</button>
      <div class="nm">${esc(c.name)}<div class="st">${st}</div></div>
      <input type="range" min="0" max="1" step="0.05" value="${S.settings.radVol??.8}" data-radvol aria-label="Volumen de la radio">
      <button class="btn sm" type="button" data-radstop>Detener</button>`; }
}
function radPlay(st){
  if(AMB.playing||AMB.want){ AMB.want=false; ambStop(); ambUI(); }
  if(!RAD.audio){ const a=new Audio(); a.preload="none";
    a.addEventListener("playing",()=>{ a.dataset.st=""; radRender(); });
    a.addEventListener("waiting",()=>{ a.dataset.st="wait"; radRender(); });
    a.addEventListener("pause",radRender);
    a.addEventListener("error",()=>{ if(!RAD.cur||RAD.cur.win||!a.getAttribute("src")) return; const c=RAD.cur; if(c.mine){ toast(`${c.name} no se puede reproducir aquí; la abro en una ventana aparte.`); radPopup(c); return; } toast(`No se pudo reproducir ${c.name}. Prueba otra emisora.`); radStop(); });
    RAD.audio=a; }
  if(st.mine&&!radIsStream(st.url)){ radPopup(st); return; }
  if(radWin&&!radWin.closed) try{ radWin.close(); }catch{}
  const a=RAD.audio; RAD.cur=st; a.dataset.st="wait"; a.src=st.url; a.volume=S.settings.radVol??.8;
  a.play().catch(e=>{ if(e&&e.name==="AbortError") return; if(RAD.cur&&RAD.cur.win) return; if(st.mine){ toast(`${st.name} no se puede reproducir aquí; la abro en una ventana aparte.`); radPopup(st); return; } toast(`No se pudo reproducir ${st.name}.`); radStop(); });
  if("mediaSession" in navigator) try{ navigator.mediaSession.metadata=new MediaMetadata({title:st.name,artist:"Radio en vivo",artwork:st.logo?[{src:st.logo}]:[]}); }catch{}
  if(!st.mine) radApi("/json/url/"+encodeURIComponent(st.id)).catch(()=>{}); // counts the listen in the directory
  radNowName=st.name; ambUI(); radRender();
}
function radStop(){ if(radWin){ try{ radWin.close(); }catch{} radWin=null; clearInterval(radWinT); } if(RAD.audio){ RAD.audio.pause(); RAD.audio.removeAttribute("src"); RAD.audio.load(); } RAD.cur=null; radNowName=""; ambUI(); radRender(); }
if(!RAD_ON){ $("#radBox").hidden=true; $("#radOff").hidden=false; }
else {
  $("#radCountry").addEventListener("change",e=>{ S.settings.radCountry=e.target.value; commit(); radLoad(); });
  let radT=null; $("#radQ").addEventListener("input",e=>{ RAD.q=e.target.value; clearTimeout(radT); radRender(); radT=setTimeout(radLoad,450); });
  $("#radMore").addEventListener("click",()=>{ RAD.shown+=30; radRender(); });
  const radAddShow=on=>{ $("#radAdd").hidden=!on; $("#radAddBtn").hidden=on; if(on){ $("#radAddUrl").value=""; $("#radAddName").value=""; $("#radAddUrl").focus(); } };
  $("#radAddBtn").addEventListener("click",()=>radAddShow(true));
  $("#radAddCancel").addEventListener("click",()=>radAddShow(false));
  $("#radAdd").addEventListener("keydown",e=>{ if(e.key==="Escape"){ e.preventDefault(); radAddShow(false); } });
  $("#radAddUrl").addEventListener("change",()=>{ const u=normUrl($("#radAddUrl").value); if(u&&!$("#radAddName").value.trim()){ const m=u.match(/emisoras\.cl\/([^/?#]+)/i); if(m) $("#radAddName").value=decodeURIComponent(m[1]).replace(/[-_]+/g," ").replace(/\b\w/g,c=>c.toUpperCase()); } });
  $("#radAdd").addEventListener("submit",e=>{ e.preventDefault(); const u=normUrl($("#radAddUrl").value); if(!u){ toast("Ese link no es válido. Copia la dirección completa."); $("#radAddUrl").focus(); return; }
    const name=$("#radAddName").value.trim()||linkName(u); S.settings.radMine=[...radMine(),{id:"m-"+uid(),name,url:u,mine:true}]; radAddShow(false); commit(); radRender(); toast(`${name} agregada a Mis radios`); });
  $("#radList").addEventListener("click",e=>{ const li=e.target.closest("[data-rad]"); if(!li) return; const id=li.dataset.rad, st=RAD.list.find(x=>x.id===id)||radFavs().find(x=>x.id===id)||radMine().find(x=>x.id===id); if(!st) return;
    if(e.target.closest("[data-radx]")){ if(RAD.cur&&RAD.cur.id===id) radStop(); S.settings.radMine=radMine().filter(x=>x.id!==id); commit(); radRender(); toast(`${st.name} quitada de Mis radios`); return; }
    if(st.mine&&RAD.cur&&RAD.cur.id===id&&RAD.cur.win){ try{ radWin&&radWin.focus(); }catch{} return; }
    if(e.target.closest("[data-radfav]")){ const f=radFavs(); S.settings.radFav=radIsFav(id)?f.filter(x=>x.id!==id):[...f,{id:st.id,name:st.name,url:st.url,logo:st.logo,tags:st.tags,city:st.city}]; commit(); radRender(); toast(radIsFav(id)?`${st.name} en favoritas`:`${st.name} quitada de favoritas`); return; }
    if(RAD.cur&&RAD.cur.id===id){ RAD.audio.paused?RAD.audio.play().catch(()=>{}):RAD.audio.pause(); return; }
    radPlay(st); });
  $("#radNow").addEventListener("click",e=>{ if(e.target.closest("[data-radshow]")){ try{ radWin&&radWin.focus(); }catch{} return; } if(e.target.closest("[data-radstop]")) radStop(); else if(e.target.closest("[data-radtoggle]")&&RAD.audio){ RAD.audio.paused?RAD.audio.play().catch(()=>{}):RAD.audio.pause(); } });
  $("#radNow").addEventListener("input",e=>{ if(!e.target.matches("[data-radvol]")) return; const v=+e.target.value; S.settings.radVol=v; if(RAD.audio) RAD.audio.volume=v; clearTimeout(RAD.volT); RAD.volT=setTimeout(commit,400); });
  // starting the ambient sound stops the radio
  $("#ambPlay").addEventListener("click",()=>{ if(AMB.want&&RAD.cur) radStop(); });
  document.querySelectorAll("[data-amb]").forEach(b=>b.addEventListener("click",()=>{ if(AMB.want&&RAD.cur) radStop(); }));
  radLoad();
}

// ---------- background photos (pick one in Ajustes; add new ones to BGS) ----------
const BGS=[
  {id:"montana-retro",name:"Montaña retro",src:"img/fondos/montana-retro.jpg"},
  {id:"ciudad-pixel",name:"Ciudad pixel",src:"img/fondos/ciudad-pixel.jpg"},
  {id:"bosque-rio",name:"Bosque y río",src:"img/fondos/bosque-rio.jpg"},
  {id:"lago-nevado",name:"Lago nevado",src:"img/fondos/lago-nevado.jpg"},
  {id:"lago-bosque",name:"Lago y bosque",src:"img/fondos/lago-bosque.jpg"},
  {id:"playa-aerea",name:"Playa aérea",src:"img/fondos/playa-aerea.jpg"},
];
const BG_DEF="montana-retro";
(()=>{
  const cv=$("#scene"), ctx=cv.getContext("2d"); if(!ctx) return;
  let img=null, cur=null;
  const isDark=()=>{ const th=document.documentElement.dataset.theme; return th?th==="dark":matchMedia("(prefers-color-scheme: dark)").matches; };
  function paint(){
    const dpr=Math.min(2,window.devicePixelRatio||1), W=innerWidth, H=innerHeight;
    cv.width=W*dpr; cv.height=H*dpr; ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle=isDark()?"#15182a":"#6b7aa8"; ctx.fillRect(0,0,W,H);
    if(img&&img.complete&&img.naturalWidth){ const k=Math.max(W/img.naturalWidth,H/img.naturalHeight), w=img.naturalWidth*k, h=img.naturalHeight*k;
      ctx.imageSmoothingQuality="high"; ctx.drawImage(img,(W-w)/2,(H-h)/2,w,h); }
    if(isDark()){ ctx.fillStyle="rgba(8,10,24,.5)"; ctx.fillRect(0,0,W,H); }
  }
  applyBg=()=>{ const id=(S.settings&&S.settings.bg)||BG_DEF, b=BGS.find(x=>x.id===id)||BGS[0]; if(b.id===cur) return;
    cur=b.id; const im=new Image(); im.onload=()=>{ if(cur===b.id){ img=im; paint(); } }; im.src=b.src; };
  let rt=null; const repaint=()=>{ clearTimeout(rt); rt=setTimeout(paint,150); };
  addEventListener("resize",repaint);
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",repaint);
  new MutationObserver(repaint).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
  paint(); applyBg();
})();
function renderBgPick(){ const id0=S.settings.bg||BG_DEF, id=BGS.some(b=>b.id===id0)?id0:BGS[0].id;
  $("#bgPick").innerHTML=BGS.map(b=>`<button type="button" class="bgopt" data-bg="${b.id}" aria-pressed="${b.id===id}" title="${esc(b.name)}"><img src="${b.src}" alt=""><span>${esc(b.name)}</span></button>`).join(""); }
$("#bgPick").addEventListener("click",e=>{ const b=e.target.closest("[data-bg]"); if(!b) return; S.settings.bg=b.dataset.bg; renderBgPick(); commit(); });

// ---------- task alerts: notification, sound and blinking tab title while the app is open ----------
var BASE_TITLE="Tareas", alBlinkT=null, ALQ=[];
function p2(n){ return String(n).padStart(2,"0"); }
function alLocal(ms){ const d=new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; }
function alFmt(ms){ const d=new Date(ms), k=dayKey(ms), today=dayKey(Date.now()), tm=new Date(); tm.setDate(tm.getDate()+1);
  const hh=`${d.getHours()}:${p2(d.getMinutes())}`;
  if(k===today) return "hoy "+hh; if(k===dayKey(tm.getTime())) return "mañana "+hh;
  return d.toLocaleDateString("es",{weekday:"short",day:"numeric",month:"short"})+(d.getFullYear()!==new Date().getFullYear()?" "+d.getFullYear():"")+" "+hh; }
function alQuick(q,t){ const d=new Date(); d.setSeconds(0,0);
  if(q==="15") d.setMinutes(d.getMinutes()+15); else if(q==="60") d.setMinutes(d.getMinutes()+60);
  else if(q==="tom"){ d.setDate(d.getDate()+1); d.setHours(9,0); }
  else if(q==="due"&&t.due){ const [y,m,dd]=t.due.split("-").map(Number); return new Date(y,m-1,dd,9,0).getTime(); }
  return d.getTime(); }
function alNtfOn(){ return "Notification" in window&&Notification.permission==="granted"; }
function alChip(t){ const left=t.alert-Date.now();
  return `<button class="nlink alchip ${t.alertFired?"fired":left<36e5?"soon":""}" type="button" data-act="alert" title="${t.alertFired?"Alerta ya avisada":"Alerta"}: ${esc(alFmt(t.alert))}. Clic para cambiarla.">${ic("bell")}${esc(alFmt(t.alert))}</button>`; }
function alForm(t){ const def=t.alert&&!t.alertFired?t.alert:(()=>{ const d=new Date(Date.now()+36e5); d.setMinutes(Math.ceil(d.getMinutes()/15)*15,0,0); return d.getTime(); })();
  const dueOk=t.due&&new Date(...t.due.split("-").map((x,i)=>i===1?x-1:+x),9,0).getTime()>Date.now();
  return `<div class="taladd"><span class="lb">${ic("bell")} Avisarme</span>
    <button class="btn sm" type="button" data-act="alert-quick" data-q="15">En 15 min</button><button class="btn sm" type="button" data-act="alert-quick" data-q="60">En 1 hora</button><button class="btn sm" type="button" data-act="alert-quick" data-q="tom">Mañana 9:00</button>${dueOk?`<button class="btn sm" type="button" data-act="alert-quick" data-q="due">Al vencer, 9:00</button>`:""}
    <input type="datetime-local" id="ta-at" value="${alLocal(def)}" aria-label="Día y hora de la alerta">
    ${t.alert?`<button class="btn sm ghost danger" type="button" data-act="alert-del">Quitar</button>`:""}<button class="btn sm" type="button" data-act="alert-cancel">Cancelar</button><button class="btn sm primary" type="button" data-act="alert-save">Guardar</button>
    ${alNtfOn()?"":`<span class="note">${!("Notification" in window)||Notification.permission==="denied"?"Las notificaciones del sistema no están disponibles aquí: el aviso aparecerá dentro del panel, con sonido y en el título de la pestaña.":"Al guardar, el navegador te pedirá permiso para mostrar notificaciones aunque la ventana esté minimizada."}</span>`}</div>`; }
function alAskPerm(){ try{ if("Notification" in window&&Notification.permission==="default") Promise.resolve(Notification.requestPermission()).then(alPermUI).catch(()=>{}); }catch{} }
function alSet(t,ms){ if(ms){ t.alert=ms; t.alertFired=false; alAskPerm(); } else { delete t.alert; delete t.alertFired; } alDrop(t.id); }
function alSave(t,ms){ if(ms<=Date.now()-6e4){ toast("Esa hora ya pasó. Elige una hora futura."); return; } alertAdd=null; alSet(t,ms); document.activeElement.blur(); commit(); toast("Te avisaré "+alFmt(ms)); }
function alSound(){ if(S.settings.alertSound===false) return; ensureAudio(); if(!AC) return;
  [0,1].forEach(rep=>[988,1319,1568].forEach((f,i)=>{ const o=AC.createOscillator(),g=AC.createGain(),t=AC.currentTime+rep*.9+i*.14;
    o.type="triangle"; o.frequency.value=f; g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(.22,t+.015); g.gain.exponentialRampToValueAtTime(.001,t+.5);
    o.connect(g).connect(AC.destination); o.start(t); o.stop(t+.55); })); }
function alNotify(t){ if(!alNtfOn()) return;
  const title="⏰ "+t.title, o={body:(t.tag?t.tag+" · ":"")+"Alerta de "+alFmt(t.alert),tag:"pp-al-"+t.id,requireInteraction:true,data:{id:t.id}};
  const click=()=>{ try{ window.focus(); }catch{} if(taskById(t.id)){ goToTask(t.id); alDrop(t.id); } };
  try{ const n=new Notification(title,o); n.onclick=()=>{ n.close(); click(); }; }
  catch{ try{ navigator.serviceWorker&&navigator.serviceWorker.ready.then(r=>r.showNotification(title,o)).catch(()=>{}); }catch{} } }
function alBlink(on){ clearInterval(alBlinkT); alBlinkT=null;
  if(on&&ALQ.length){ let k=0; alBlinkT=setInterval(()=>{ const t=taskById(ALQ[ALQ.length-1]); document.title=(k++%2)?BASE_TITLE:"⏰ "+(t?t.title:"Alerta"); },1000); }
  else document.title=BASE_TITLE; }
function alBar(){ ALQ=ALQ.filter(id=>{ const t=taskById(id); return t&&!t.completed; }); const el=$("#alBar");
  el.hidden=!ALQ.length; el.innerHTML=ALQ.map(id=>{ const t=taskById(id), late=Date.now()-t.alert>5*6e4;
    return `<div class="alitem" data-id="${t.id}"><span class="alic">${ic("bell")}</span><div class="altx"><b title="${esc(t.title)}">${esc(t.title)}</b><span>${t.tag?esc(t.tag)+" · ":""}Alerta de ${esc(alFmt(t.alert))}${late?" (no estabas aquí)":""}</span></div>
      <div class="alb"><button class="btn sm" type="button" data-al="open">Abrir tarea</button><button class="btn sm" type="button" data-al="snooze">Posponer 10 min</button><button class="btn sm primary" type="button" data-al="ok">Listo</button></div></div>`; }).join("");
  if(!ALQ.length) alBlink(false); }
function alDrop(id){ if(!ALQ.includes(id)) return; ALQ=ALQ.filter(x=>x!==id); alBar(); }
function alFire(t){ ALQ=ALQ.filter(x=>x!==t.id); ALQ.push(t.id); alBar(); alSound(); alNotify(t); if(document.hidden||!document.hasFocus()) alBlink(true); }
function alCheck(){ const now=Date.now(), due=S.tasks.filter(t=>t.alert&&!t.alertFired&&!t.completed&&t.alert<=now); if(!due.length) return;
  due.forEach(t=>{ t.alertFired=true; alFire(t); }); commit(); }
$("#alBar").addEventListener("click",e=>{ const b=e.target.closest("[data-al]"); if(!b) return; const id=b.closest("[data-id]").dataset.id, t=taskById(id); alDrop(id); if(!t) return;
  if(b.dataset.al==="open") goToTask(id);
  else if(b.dataset.al==="snooze"){ t.alert=Date.now()+10*6e4; t.alertFired=false; commit(); toast("Te vuelvo a avisar "+alFmt(t.alert)); } });
$("#tasks").addEventListener("keydown",e=>{ if(!e.target.closest(".taladd")) return; const t=taskById(e.target.closest(".task").dataset.id);
  if(e.key==="Enter"&&e.target.id==="ta-at"){ e.preventDefault(); const v=e.target.value; if(t&&v) alSave(t,new Date(v).getTime()); }
  else if(e.key==="Escape"){ e.preventDefault(); alertAdd=null; render(); } });
function alPermUI(){ const info=$("#ntfInfo"), ask=$("#ntfAsk"); if(!info) return; const p="Notification" in window?Notification.permission:"none";
  info.textContent=p==="granted"?"Activadas. El aviso aparece en la esquina de la pantalla aunque la ventana esté minimizada."
    :p==="denied"?"Bloqueadas. Para activarlas, haz clic en el ícono junto a la dirección del sitio y permite Notificaciones. Mientras tanto verás el aviso dentro del panel."
    :p==="none"?"Esta vista no permite notificaciones del sistema. Verás el aviso dentro del panel, con sonido y en el título de la pestaña."
    :"Aún no activadas. Actívalas para ver el aviso aunque la ventana esté minimizada.";
  ask.hidden=p!=="default"; }
$("#ntfAsk").addEventListener("click",()=>{ alAskPerm(); });
$("#cAlSound").addEventListener("change",()=>{ S.settings.alertSound=$("#cAlSound").checked; commit(); });
$("#ntfTest").addEventListener("click",()=>{ alSound(); const t={id:"test",title:"Alerta de prueba",tag:"",alert:Date.now()}; alNotify(t); toast(alNtfOn()?"Así se ve y suena una alerta":"Así suena una alerta. Las notificaciones del sistema no están activas."); });
addEventListener("focus",()=>{ alCheck(); if(alBlinkT) alBlink(false); });
document.addEventListener("visibilitychange",()=>{ alCheck(); if(!document.hidden&&document.hasFocus()&&alBlinkT) alBlink(false); });
document.addEventListener("pointerdown",ensureAudio,{once:true});
setInterval(alCheck,15000); setTimeout(alCheck,1500);

render();
})();

// ---------- offline app (service worker) ----------
if("serviceWorker" in navigator&&(location.protocol==="https:"||location.hostname==="localhost"||location.hostname==="127.0.0.1"))
  addEventListener("load",()=>{
    // when a new version takes over, reload once so the new files are used right away
    const had=!!navigator.serviceWorker.controller; let done=false;
    navigator.serviceWorker.addEventListener("controllerchange",()=>{ if(had&&!done){ done=true; location.reload(); } });
    navigator.serviceWorker.register("sw.js",{updateViaCache:"none"}).then(r=>r.update()).catch(()=>{}); });
