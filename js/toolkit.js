/* Court Companion — Toolkit add-on (v2).
   Records (find my case, transcripts & papers with search, the professionals on my case), lawyer accountability
   (requests, contact log, plea offers), discovery tracker, timeline, research feed (live CourtListener), pro per guide,
   defense notebook, emergency plan, and the "set up my case" intake. Everything a user adds stays on their device.
   Information and organization only — never legal advice. No searches of private people (witnesses, alleged victims,
   co-defendants) are offered, and nothing here contacts anyone. */
(function(){
"use strict";
const CC = window.CC, _ = CC._;
const { $, $$, esc, enc, modal, toast, download } = _;
const CL = "https://www.courtlistener.com";
const now = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2,10);
const fmtD = s => { if (!s) return ""; const d = new Date(s.length===10 ? s+"T12:00:00" : s); return isNaN(d) ? s : d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}); };
const daysBetween = (a,b) => Math.round((new Date(b) - new Date(a))/864e5);

/* ───────── store (per profile; seeds from profile.toolkit are read-only) ───────── */
let T = {}, TKEY = "";
const LISTS = ["requests","comms","offers","discovery","timeline","saved","notebook","people","found","helpers"];
function tload(){ TKEY = "cc:tk:"+CC.profile.id; try{ T = JSON.parse(localStorage.getItem(TKEY)||"{}")||{}; }catch(e){ T = {}; }
  for (const k of LISTS) T[k] ||= []; T.research ||= {terms:null, last:0, seen:{}, results:{}}; T.plan ||= {}; }
function tsave(){ if (CC.profile.persist === false){ toast("Private copy: changes here are not saved after you close the page."); return; }
  try{ localStorage.setItem(TKEY, JSON.stringify(T)); }catch(e){ toast("Couldn't save — this device's storage is full or blocked."); } }
const seed = k => (CC.profile.toolkit?.[k]||[]).map(x => ({...x, seed:true}));
const items = k => [...seed(k), ...T[k]];

/* ───────── files (IndexedDB) ───────── */
const DB = { db:null,
  open(){ if (this.db) return Promise.resolve(this.db); return new Promise((res,rej)=>{ const r = indexedDB.open("cc-files",1);
    r.onupgradeneeded = () => r.result.createObjectStore("files",{keyPath:"id"}); r.onsuccess = () => res(this.db = r.result); r.onerror = () => rej(r.error); }); },
  async tx(mode, fn){ const db = await this.open(); return new Promise((res,rej)=>{ const t = db.transaction("files",mode), st = t.objectStore("files"); const out = fn(st); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); },
  put(f){ return this.tx("readwrite", st => st.put(f)); },
  del(id){ return this.tx("readwrite", st => st.delete(id)); },
  async all(){ const db = await this.open(); return new Promise((res,rej)=>{ const r = db.transaction("files").objectStore("files").getAll(); r.onsuccess = () => res((r.result||[]).filter(f=>f.profile===CC.profile.id)); r.onerror = () => rej(r.error); }); }
};
let FILES = null;
async function files(){ if (FILES) return FILES; try{ FILES = await DB.all(); }catch(e){ FILES = []; } return FILES; }

let pdfjs = null;
async function loadPdfJs(){
  if (pdfjs) return pdfjs;
  await new Promise((res,rej)=>{ const s=document.createElement("script"); s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"; s.onload=res; s.onerror=()=>rej(new Error("pdf.js")); document.head.appendChild(s); });
  pdfjs = window.pdfjsLib; pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; return pdfjs;
}
async function extract(file){
  if (/\.(txt|md|csv|rtf)$/i.test(file.name) || /^text\//.test(file.type)) return [await file.text()];
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf"){
    const lib = await loadPdfJs(); const doc = await lib.getDocument({data: new Uint8Array(await file.arrayBuffer())}).promise; const pages = [];
    for (let i=1;i<=doc.numPages;i++){ const p = await doc.getPage(i); const c = await p.getTextContent(); pages.push(c.items.map(x=>x.str+(x.hasEOL?"\n":" ")).join("")); }
    return pages;
  }
  return [];
}

/* ───────── helpers ───────── */
function caseOpts(sel){ return `<option value="">—</option>`+(CC.profile.cases||[]).map(k=>`<option value="${esc(k.id)}" ${sel===k.id?"selected":""}>${esc(k.number)}</option>`).join(""); }
const caseNum = id => (CC.profile.cases||[]).find(k=>k.id===id)?.number || "";
function card(title, ic, body, extra){ return `<div class="card"><div class="row between"><h3>${icon(ic)}${title}</h3>${extra||""}</div>${body}</div>`; }
function linkBtn(url, label, ic){ return `<a class="btn ghost small" href="${esc(url)}" target="_blank" rel="noopener">${icon(ic||"link")}${esc(label)}</a>`; }
function statuteGuess(){ const out = new Set();
  for (const k of (CC.profile.cases||[])){ const t = [k.charge, k.statute].filter(Boolean).join(" ");
    for (const m of t.matchAll(/\b(\d{1,2})\s*U\.?S\.?C\.?\s*§*\s*(\d+[a-z]?)/gi)) out.add(`"${m[1]} U.S.C. § ${m[2]}"`);
    for (const m of t.matchAll(/\b(?:PC|Penal Code)\s*§*\s*(\d+(?:\.\d+)?)/gi)) out.add(`"Penal Code section ${m[1]}"`); }
  return [...out]; }

/* Generic list module: add / edit / delete with a form. Seeds are view-only. */
function form(cfg, it, onSave){
  const v = it || {};
  const fld = f => { const val = v[f.k] ?? (f.def ? f.def() : "");
    if (f.type==="select") return `<select id="tf-${f.k}">${f.opts.map(o=>{ const [k,l]=Array.isArray(o)?o:[o,o]; return `<option value="${esc(k)}" ${String(val)===k?"selected":""}>${esc(l)}</option>`; }).join("")}</select>`;
    if (f.type==="case") return `<select id="tf-${f.k}">${caseOpts(val)}</select>`;
    if (f.type==="textarea") return `<textarea id="tf-${f.k}" placeholder="${esc(f.ph||"")}">${esc(val)}</textarea>`;
    return `<input id="tf-${f.k}" type="${f.type||"text"}" value="${esc(val)}" placeholder="${esc(f.ph||"")}">`; };
  const md = modal(`<h3>${icon(cfg.icon)}${it?"Edit":"Add"}: ${esc(cfg.noun)}</h3>${cfg.note?`<p class="small">${esc(cfg.note)}</p>`:""}
    ${cfg.fields.map(f=>`<label for="tf-${f.k}">${esc(f.label)}</label>${fld(f)}${f.help?`<div class="small muted">${esc(f.help)}</div>`:""}`).join("")}
    <div class="row" style="margin-top:12px"><button class="btn" id="tf-save">${icon("check")}Save</button><button class="btn ghost" data-close>Cancel</button></div>`);
  $("#tf-save",md).onclick = () => { const out = {...v}; for (const f of cfg.fields) out[f.k] = $("#tf-"+f.k,md).value.trim();
    const miss = cfg.fields.find(f=>f.req && !out[f.k]); if (miss) return toast("Add: "+miss.label);
    if (!_.guardOK(...cfg.fields.filter(f=>f.guard!==false && f.type!=="date").map(f=>out[f.k]))) return;
    md.hidden = true; onSave(out); };
}
function listMod(key, cfg){
  const L = items(key).sort(cfg.sort || ((a,b)=>String(b[cfg.dateKey||"date"]||"").localeCompare(String(a[cfg.dateKey||"date"]||""))));
  return `${cfg.intro?`<p class="small">${cfg.intro}</p>`:""}${cfg.summary?cfg.summary(L):""}
   <div class="row" style="margin-bottom:10px"><button class="btn" data-tadd="${key}">${icon("plus")}Add ${esc(cfg.noun)}</button>${cfg.extraBtns||""}</div>
   ${L.length? L.map(it=>`<div class="card flat tk-it">${cfg.line(it)}
      <div class="row" style="margin-top:8px;gap:6px">${it.seed?'<span class="chip sample">From your case file</span>':`<button class="btn ghost small" data-tedit="${key}:${esc(it.id)}">${icon("doc")}Edit</button><button class="btn ghost small" data-tdel="${key}:${esc(it.id)}">${icon("x")}Delete</button>`}${cfg.btns?cfg.btns(it):""}</div></div>`).join("")
     : `<p class="muted small">Nothing yet.</p>`}`;
}
const MODS = {};
function wireList(root){
  $$("[data-tadd]",root).forEach(b=>b.onclick=()=>{ const k=b.dataset.tadd, cfg=MODS[k]; form(cfg, null, out=>{ out.id=uid(); out.added=now(); T[k].push(out); tsave(); CC.render(); toast("Saved."); }); });
  $$("[data-tedit]",root).forEach(b=>b.onclick=()=>{ const [k,id]=b.dataset.tedit.split(":"), cfg=MODS[k], it=T[k].find(x=>x.id===id); if (it) form(cfg, it, out=>{ Object.assign(it,out); tsave(); CC.render(); }); });
  $$("[data-tdel]",root).forEach(b=>b.onclick=()=>{ const [k,id]=b.dataset.tdel.split(":"); if (!confirm("Delete this entry?")) return; T[k]=T[k].filter(x=>x.id!==id); tsave(); CC.render(); });
}

/* ───────── module definitions ───────── */
MODS.requests = { noun:"request to my lawyer", icon:"clip", dateKey:"asked",
  intro:"Everything you've asked your lawyer to do, with the date you asked and what happened. Mark it <b>Done</b> when they say it's done and <b>Verified</b> when you've seen proof (the filed motion, the received discovery).",
  fields:[{k:"what",label:"What I asked for",req:true,ph:"e.g. File a motion to dismiss / get the bodycam video"},{k:"case",label:"Case",type:"case"},
    {k:"asked",label:"Date I asked",type:"date",req:true,def:()=>_.ymd(new Date())},{k:"how",label:"How I asked",type:"select",opts:["Email","Text","Phone call","In person","Letter","In court"]},
    {k:"status",label:"Status",type:"select",opts:[["open","Waiting on lawyer"],["answered","Lawyer answered"],["done","Lawyer says done"],["verified","Verified — I saw proof"],["declined","Lawyer decided not to (reason below)"]]},
    {k:"reason",label:"Lawyer's answer / reason",type:"textarea"},{k:"proof",label:"Proof (file name, docket entry, date)"}],
  summary: L => { const open = L.filter(x=>x.status==="open"||!x.status); const old = open.filter(x=>x.asked && daysBetween(x.asked,new Date())>=7);
    return `<div class="row" style="margin-bottom:8px;gap:6px"><span class="chip">${L.length} total</span><span class="chip fee">${open.length} waiting</span>${old.length?`<span class="chip fee">${old.length} waiting 7+ days</span>`:""}<span class="chip verified">${L.filter(x=>x.status==="verified").length} verified</span></div>`; },
  line: it => { const st = {open:"Waiting on lawyer",answered:"Answered",done:"Lawyer says done",verified:"Verified",declined:"Lawyer decided not to"}[it.status||"open"];
    const wait = (it.status||"open")==="open" && it.asked ? daysBetween(it.asked,new Date()) : null;
    return `<b>${esc(it.what)}</b><div class="small">${esc(fmtD(it.asked))}${it.how?" · "+esc(it.how):""}${it.case?" · "+esc(caseNum(it.case)):""}</div>
      <div class="row" style="gap:6px;margin-top:6px"><span class="chip ${it.status==="verified"?"verified":(it.status==="declined"||wait>=7)?"fee":""}">${esc(st)}${wait!==null?` · ${wait} day${wait===1?"":"s"}`:""}</span></div>
      ${it.reason?`<div class="small" style="margin-top:6px"><b>Answer:</b> ${esc(it.reason)}</div>`:""}${it.proof?`<div class="small"><b>Proof:</b> ${esc(it.proof)}</div>`:""}`; } };

MODS.comms = { noun:"contact with my lawyer", icon:"phone",
  intro:"Every call, text, email or visit — and when they answered. This is your record if you ever need to show the court you tried to reach your lawyer.",
  fields:[{k:"date",label:"Date",type:"date",req:true,def:()=>_.ymd(new Date())},{k:"dir",label:"Who reached out",type:"select",opts:[["me","I contacted my lawyer"],["them","My lawyer contacted me"]]},
    {k:"how",label:"How",type:"select",opts:["Phone call","Text","Email","Visit","Video call","Letter","Voicemail"]},{k:"about",label:"About",req:true,type:"textarea"},
    {k:"replied",label:"Date they replied (blank if no reply yet)",type:"date"},{k:"case",label:"Case",type:"case"}],
  summary: L => { const mine = L.filter(x=>x.dir!=="them"); const noReply = mine.filter(x=>!x.replied); const rep = mine.filter(x=>x.replied).map(x=>daysBetween(x.date,x.replied));
    const avg = rep.length ? (rep.reduce((a,b)=>a+b,0)/rep.length).toFixed(1) : "—";
    return `<div class="row" style="margin-bottom:8px;gap:6px"><span class="chip">${mine.length} times I reached out</span><span class="chip fee">${noReply.length} with no reply</span><span class="chip">Average reply: ${avg} days</span></div>`; },
  line: it => `<b>${esc(fmtD(it.date))} · ${esc(it.how||"")}</b> <span class="small">${it.dir==="them"?"(lawyer contacted me)":"(I contacted my lawyer)"}</span><div class="small" style="margin-top:4px">${esc(it.about)}</div>
    <div class="small">${it.dir==="them"?"":it.replied?`Replied ${esc(fmtD(it.replied))} (${daysBetween(it.date,it.replied)} days)`:"<b>No reply yet</b>"}</div>` };

MODS.offers = { noun:"plea offer", icon:"scales",
  intro:"Every offer the prosecution makes, the deadline, and your answer. <b>Accepting or rejecting a plea is your decision — not your lawyer's.</b> Your lawyer has to tell you about every formal offer (Missouri v. Frye, 566 U.S. 134 (2012)). Ask for each one in writing.",
  fields:[{k:"date",label:"Date I was told",type:"date",req:true,def:()=>_.ymd(new Date())},{k:"case",label:"Case",type:"case"},{k:"from",label:"Who told me",ph:"e.g. my lawyer by email"},
    {k:"offer",label:"The offer, word for word",type:"textarea",req:true},{k:"deadline",label:"Deadline",type:"date"},
    {k:"answer",label:"My answer",type:"select",opts:[["","Not decided"],["rejected","Rejected"],["accepted","Accepted"],["countered","Asked for something different"]]},{k:"answered",label:"Date I answered",type:"date"},{k:"note",label:"How I answered / notes",type:"textarea"}],
  line: it => `<b>${esc(fmtD(it.date))}${it.case?" · "+esc(caseNum(it.case)):""}</b><div class="small" style="margin-top:4px">${esc(it.offer)}</div>
    <div class="row" style="gap:6px;margin-top:6px">${it.deadline?`<span class="chip fee">${icon("flag")}Deadline ${esc(fmtD(it.deadline))}</span>`:""}<span class="chip ${it.answer==="rejected"?"fee":it.answer?"verified":""}">${esc({rejected:"Rejected",accepted:"Accepted",countered:"Countered"}[it.answer]||"Not decided")}${it.answered?" · "+esc(fmtD(it.answered)):""}</span></div>${it.note?`<div class="small">${esc(it.note)}</div>`:""}` };

MODS.discovery = { noun:"discovery item", icon:"folder", dateKey:"requested",
  intro:"The evidence you know exists (reports, video, bodycam, 911 calls, texts, lab results, witness statements) and whether you've actually seen it. Gaps show up in red.",
  fields:[{k:"what",label:"Item",req:true,ph:"e.g. Arresting officer's bodycam"},{k:"case",label:"Case",type:"case"},{k:"requested",label:"Date requested",type:"date"},
    {k:"status",label:"Status",type:"select",opts:[["missing","Not received"],["lawyer","Lawyer has it — I haven't seen it"],["seen","I've seen it"],["copy","I have a copy"],["none","Prosecution says it doesn't exist"]]},
    {k:"received",label:"Date received / seen",type:"date"},{k:"notes",label:"Notes",type:"textarea"}],
  summary: L => `<div class="row" style="margin-bottom:8px;gap:6px"><span class="chip">${L.length} items</span><span class="chip fee">${L.filter(x=>!x.status||x.status==="missing"||x.status==="lawyer").length} I haven't seen</span><span class="chip verified">${L.filter(x=>x.status==="seen"||x.status==="copy").length} seen</span></div>`,
  line: it => `<b>${esc(it.what)}</b><div class="small">${it.case?esc(caseNum(it.case))+" · ":""}${it.requested?"Requested "+esc(fmtD(it.requested)):""}${it.received?" · Received "+esc(fmtD(it.received)):""}</div>
    <span class="chip ${(!it.status||it.status==="missing"||it.status==="lawyer")?"fee":"verified"}" style="margin-top:6px">${esc({missing:"Not received",lawyer:"Lawyer has it",seen:"Seen",copy:"Have a copy",none:"Says it doesn't exist"}[it.status||"missing"])}</span>${it.notes?`<div class="small">${esc(it.notes)}</div>`:""}` };

MODS.timeline = { noun:"timeline entry", icon:"calendar",
  intro:"What happened and when — arrest, hearings, emails, calls, offers. Write it the day it happens; a record made at the time is worth more than memory later.",
  fields:[{k:"date",label:"Date",type:"date",req:true,def:()=>_.ymd(new Date())},{k:"time",label:"Time (optional)",type:"time"},{k:"case",label:"Case",type:"case"},
    {k:"what",label:"What happened",type:"textarea",req:true},{k:"proof",label:"Proof (screenshot / file name / docket entry)"}],
  sort:(a,b)=>String(b.date+(b.time||"")).localeCompare(String(a.date+(a.time||""))),
  line: it => `<b>${esc(fmtD(it.date))}${it.time?" · "+esc(it.time):""}</b>${it.case?` <span class="small">${esc(caseNum(it.case))}</span>`:""}<div class="small" style="margin-top:4px">${esc(it.what)}</div>${it.proof?`<div class="small"><b>Proof:</b> ${esc(it.proof)}</div>`:""}` };

MODS.notebook = { noun:"defense point", icon:"book", dateKey:"added",
  intro:"Your own notebook: each point you want made in your defense, what you'd say, and the cases you saved that support it. This is your thinking to take to your lawyer — not legal advice from the app.",
  fields:[{k:"title",label:"The point",req:true,ph:"e.g. They never proved I knew about it"},{k:"case",label:"Case",type:"case"},{k:"say",label:"How I'd say it",type:"textarea"},
    {k:"support",label:"Cases / evidence that support it",type:"textarea",help:"Tip: save cases from Research, then list them here."},{k:"against",label:"What the other side will say — and my answer",type:"textarea"},{k:"motion",label:"Motion this could go in"}],
  line: it => `<b>${esc(it.title)}</b>${it.case?` <span class="small">${esc(caseNum(it.case))}</span>`:""}${it.say?`<div class="small" style="margin-top:4px"><b>I'd say:</b> ${esc(it.say)}</div>`:""}${it.support?`<div class="small"><b>Support:</b> ${esc(it.support)}</div>`:""}${it.against?`<div class="small"><b>Their side / my answer:</b> ${esc(it.against)}</div>`:""}${it.motion?`<div class="small"><b>Motion:</b> ${esc(it.motion)}</div>`:""}` };

const PRO_ROLES = [["attorney","My defense attorney"],["prosecutor","Prosecutor"],["judge","Judge"],["probation","Probation / pretrial officer"],["bail","Bail agent"],["investigator","Defense investigator / expert"],["clerk","Court clerk / courtroom"]];
MODS.people = { noun:"professional on my case", icon:"users", dateKey:"added",
  note:"Only the professionals working on your case. Searches of private people — witnesses, alleged victims, co-defendants — are not offered.",
  fields:[{k:"role",label:"Role",type:"select",opts:PRO_ROLES},{k:"name",label:"Name",req:true},{k:"bar",label:"Bar # / badge # / license # (if known)"},{k:"phone",label:"Phone"},{k:"email",label:"Email"},{k:"case",label:"Case",type:"case"},{k:"notes",label:"Notes",type:"textarea"}],
  line: it => `<b>${esc(it.name)}</b> <span class="small">${esc((PRO_ROLES.find(r=>r[0]===it.role)||[,""])[1])}${it.bar?" · #"+esc(it.bar):""}</span>${it.notes?`<div class="small">${esc(it.notes)}</div>`:""}
    <div class="acts" style="margin-top:6px">${_.actBtns({phone:it.phone,email:it.email,caseId:it.case})}</div>`,
  btns: it => lookupBtns(it) };
MODS.helpers = { noun:"helper", icon:"hands", dateKey:"added",
  note:"Family, friends or a legal assistant who help with rides, paperwork and calls. Anyone you're ordered not to contact can't be added.",
  fields:[{k:"name",label:"Name",req:true},{k:"rel",label:"Relationship / role",ph:"e.g. Mom, legal assistant"},{k:"phone",label:"Phone"},{k:"email",label:"Email"},{k:"does",label:"What they help with",type:"textarea"}],
  line: it => `<b>${esc(it.name)}</b> <span class="small">${esc(it.rel||"")}</span>${it.does?`<div class="small">${esc(it.does)}</div>`:""}<div class="acts" style="margin-top:6px">${_.actBtns({phone:it.phone,email:it.email})}</div>` };

function lookupBtns(p){
  const n = p.name||"", st = CC.data.state||{};
  const b = [];
  if (p.role==="attorney"||p.role==="prosecutor"){ b.push(linkBtn("https://apps.calbar.ca.gov/attorney/LicenseeSearch/QuickSearch?FreeText="+enc(p.bar||n),"State Bar license & discipline","shield")); b.push(linkBtn(CL+"/?type=r&q="+enc('"'+n+'"'),"Their federal cases (CourtListener)","search")); }
  if (p.role==="judge"){ b.push(`<button class="btn ghost small" data-judge="${esc(n)}">${icon("search")}Judge profile</button>`); b.push(linkBtn(CL+"/?type=o&q="+enc('judge:"'+n.replace(/^(hon\.?|judge)\s+/i,"")+'"'),"Their published opinions","search")); }
  if (p.role==="bail" && st.bail?.license_lookup_url) b.push(linkBtn(st.bail.license_lookup_url,"Check bail license (CDI)","shield"));
  return b.join("");
}

/* ───────── views ───────── */
const TABS = [["deadlines","Deadlines"],["help","Find help"],["jails","Jails & prisons"],["library","Library"],["records","Records"],["lawyer","My lawyer"],["discovery","Discovery"],["timeline","Timeline"],["research","Research"],["proper","Pro per"],["notebook","Notebook"],["plan","Emergency plan"]];
CC.VIEWS.toolkit = () => {
  const tab = CC.tkTab || "deadlines";
  const mine = !CC.profile.sample;
  const head = `<div class="pagehead">${icon("key","lg")}<div><h1>Toolkit</h1><p>Your records, your lawyer's to-do list, the evidence, research and the pro per guide — all in one place. Information and organization only, not legal advice.</p></div></div>
    ${CC.profile.sample?`<div class="card" style="border-color:var(--gold)"><div class="row between"><div><b>This is a sample case.</b><div class="small">Set up your own case to start your own records. Your data stays on your phone.</div></div><button class="btn gold" data-intake>${icon("plus")}Set up my case</button></div></div>`:""}
    <div class="seg">${TABS.map(([k,l])=>`<button data-tktab="${k}" class="${tab===k?"on":""}">${l}</button>`).join("")}</div>`;
  return head + `<div id="tkbody">${(SUB[tab]||SUB.deadlines)()}</div>`;
};
CC.VIEWS.toolkit.wire = () => {
  const v = $("#view");
  $$("[data-tktab]",v).forEach(b=>b.onclick=()=>{ CC.tkTab=b.dataset.tktab; CC.render(); });
  $$("[data-intake]",v).forEach(b=>b.onclick=intake);
  wireList(v);
  (WIRE[CC.tkTab||"deadlines"]||(()=>{}))(v); tour("tk-"+(CC.tkTab||"deadlines"));
};

const SUB = {}, WIRE = {};
SUB.deadlines = () => window.CCdl ? window.CCdl.view() : "";
WIRE.deadlines = v => window.CCdl && window.CCdl.wire(v);
window.CCtk = { items: k => items(k) };
SUB.jails = () => window.CCjails ? window.CCjails.view() : "";
WIRE.jails = v => window.CCjails && window.CCjails.wire(v);
/* Records */
SUB.records = () => {
  const counties = Object.entries(CC.data.counties||{});
  const ks = CC.profile.cases||[];
  const found = items("found");
  return card("Find my case","search",`<p class="small">Type your case number. Federal cases are searched live on CourtListener (free copies of the PACER docket). State court cases open the county's official case search.</p>
     <div class="fgrid two"><div><label for="fc-num">Case number</label><input id="fc-num" value="${esc(ks[0]&&!CC.profile.sample?ks[0].number:"")}" placeholder="e.g. 2:26-cr-00123 or 26CF01234"></div>
     <div><label for="fc-sys">Court</label><select id="fc-sys"><option value="federal">Federal court (any district)</option>${counties.map(([id,c])=>`<option value="${esc(id)}">${esc(c.name||id)} Superior Court</option>`).join("")}</select></div></div>
     <div class="row" style="margin-top:10px"><button class="btn" id="fc-go">${icon("search")}Search</button>${linkBtn("https://pcl.uscourts.gov/pcl/index.jsf","PACER Case Locator (official)","link")}</div>
     <div id="fc-out" style="margin-top:10px"></div>
     ${found.length?`<h4 style="margin-top:12px">Saved dockets</h4>${found.map(f=>`<div class="small" style="margin:4px 0">${icon("folder")} <a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a> · ${esc(f.docket)} · ${esc(f.court)}${f.filed?" · filed "+esc(fmtD(f.filed)):""}</div>`).join("")}`:""}
     <p class="small muted">Court transcripts are ordered from the court reporter (state) or through the court's transcript order process (federal); free filings show up on CourtListener when someone has bought them on PACER. Ask your lawyer for copies of anything already in the file.</p>`)
   + card("Transcripts & papers","doc",`<p class="small">Add transcripts, police reports, discovery, letters and court papers (PDF or text). They stay <b>only on this device</b> — nothing is uploaded. Then search every page at once.</p>
     <div class="fgrid two"><div><label for="tr-file">Add files</label><input id="tr-file" type="file" multiple accept=".pdf,.txt,.md,.csv,.rtf,image/*"></div>
     <div><label for="tr-kind">What kind</label><select id="tr-kind">${["Transcript","Police report","Discovery","Court paper","Letter / email","Other"].map(x=>`<option>${x}</option>`).join("")}</select></div></div>
     <label for="tr-q">Search all my papers</label><input id="tr-q" type="search" placeholder="A name, a date, a phrase…">
     <div id="tr-out" style="margin-top:10px"><p class="muted small">Loading…</p></div>`)
   + card("People on my case","users", listMod("people", MODS.people) + `<div class="small muted" style="margin-top:8px">${esc(MODS.people.note)}</div>`)
   + card("Check your own record","shield",`<p class="small">See what the government has on file for you.</p><div class="acts">${linkBtn("https://oag.ca.gov/fingerprints/record-review","CA DOJ — request your record","shield")}${linkBtn("https://pcl.uscourts.gov/pcl/index.jsf","Federal cases in your name (PACER)","search")}${(CC.data.counties?.[CC.profile.home?.county]?.case_search_url)?linkBtn(CC.data.counties[CC.profile.home.county].case_search_url,"County court case search","search"):""}</div>`);
};
WIRE.records = v => {
  $("#fc-go",v).onclick = findCase;
  const fi = $("#tr-file",v), q = $("#tr-q",v);
  fi.onchange = async () => { const fl = [...fi.files]; if (!fl.length) return; if (CC.profile.sample && !confirm("This is the sample case. Add these files to it anyway? (They stay on this device.)")) return;
    $("#tr-out",v).innerHTML = `<p class="small">Reading ${fl.length} file(s)…</p>`;
    for (const f of fl){ let pages = []; try{ pages = await extract(f); }catch(e){ toast("Couldn't read text from "+f.name); }
      const rec = {id:uid(), profile:CC.profile.id, name:f.name, kind:$("#tr-kind",v).value, type:f.type, size:f.size, added:now(), pages, blob:f};
      try{ await DB.put(rec); FILES = null; }catch(e){ toast("This browser blocked saving files."); } }
    fi.value = ""; showFiles(v, q.value); toast("Added."); };
  let t; q.oninput = () => { clearTimeout(t); t = setTimeout(()=>showFiles(v, q.value), 200); };
  showFiles(v, "");
  $$("[data-judge]",v).forEach(b=>b.onclick=()=>judgeLookup(b.dataset.judge));
};
async function showFiles(v, query){
  const out = $("#tr-out",v); if (!out) return; const fl = (await files()).sort((a,b)=>b.added.localeCompare(a.added));
  if (!fl.length){ out.innerHTML = `<p class="muted small">No papers yet.</p>`; return; }
  const qq = query.trim().toLowerCase();
  if (qq.length >= 2){
    const hits = [];
    for (const f of fl) (f.pages||[]).forEach((p,i)=>{ const low = p.toLowerCase(); let at = low.indexOf(qq), n = 0;
      while (at >= 0 && n < 3){ const s = Math.max(0,at-90), e = Math.min(p.length, at+qq.length+90);
        hits.push({f, page:i+1, html: esc(p.slice(s,at)) + "<mark>"+esc(p.slice(at,at+qq.length))+"</mark>" + esc(p.slice(at+qq.length,e))}); at = low.indexOf(qq, at+qq.length); n++; } });
    out.innerHTML = hits.length ? `<p class="small"><b>${hits.length}</b> match${hits.length===1?"":"es"}</p>`+hits.slice(0,80).map(h=>`<div class="card flat" style="padding:10px"><div class="small"><b>${esc(h.f.name)}</b>${h.f.pages.length>1?" · page "+h.page:""} <button class="btn ghost small" data-open="${esc(h.f.id)}" data-page="${h.page}">Open</button></div><div class="small" style="margin-top:4px">…${h.html}…</div></div>`).join("") : `<p class="muted small">No matches.</p>`;
  } else {
    out.innerHTML = fl.map(f=>`<div class="row between" style="border-top:1px solid var(--line);padding:8px 0"><div class="small"><b>${esc(f.name)}</b><br>${esc(f.kind)} · ${(f.size/1024).toFixed(0)} KB · ${f.pages?.length?f.pages.length+" page"+(f.pages.length===1?"":"s")+" searchable":"not searchable (photo)"} · added ${esc(fmtD(f.added))}</div>
      <div class="row" style="gap:6px"><button class="btn ghost small" data-open="${esc(f.id)}">Open</button><button class="btn ghost small" data-fdel="${esc(f.id)}" aria-label="Delete">${icon("x")}</button></div></div>`).join("");
  }
  $$("[data-open]",out).forEach(b=>b.onclick=()=>{ const f = fl.find(x=>x.id===b.dataset.open); if (!f) return; const u = URL.createObjectURL(f.blob); window.open(u + (b.dataset.page && /pdf/.test(f.type)?"#page="+b.dataset.page:""), "_blank"); });
  $$("[data-fdel]",out).forEach(b=>b.onclick=async()=>{ if (!confirm("Delete this file from this device?")) return; await DB.del(b.dataset.fdel); FILES = null; showFiles(v, ""); });
}
async function findCase(){
  const num = $("#fc-num").value.trim(), sys = $("#fc-sys").value, out = $("#fc-out");
  if (!num) return toast("Type a case number.");
  if (sys !== "federal"){ const c = CC.data.counties[sys]||{};
    out.innerHTML = `<p class="small">State court records aren't on CourtListener. Open the official search and type <b>${esc(num)}</b>:</p><div class="acts">${c.case_search_url?linkBtn(c.case_search_url,(c.name||sys)+" case search (official)","search"):""}</div>${c.case_search_note?`<p class="small muted">${esc(c.case_search_note)}</p>`:""}`; return; }
  out.innerHTML = `<p class="small">Searching…</p>`;
  try{
    const r = await fetch(CL+"/api/rest/v4/search/?type=r&q="+enc('docketNumber:"'+num.replace(/"/g,"")+'"'));
    const d = await r.json(); const res = d.results||[];
    if (!res.length){ out.innerHTML = `<p class="small">No match on CourtListener yet. New cases can take a few days to appear, and sealed cases never do.</p><div class="acts">${linkBtn("https://pcl.uscourts.gov/pcl/index.jsf","Search PACER (official)")}${linkBtn(CL+"/?type=r&q="+enc(num),"Search CourtListener")}</div>`; return; }
    out.innerHTML = res.slice(0,10).map((x,i)=>`<div class="card flat" style="padding:10px"><b>${esc(x.caseName)}</b><div class="small">${esc(x.docketNumber)} · ${esc(x.court)}${x.dateFiled?" · filed "+esc(fmtD(x.dateFiled)):""}${x.assignedTo?" · Judge "+esc(x.assignedTo):""}</div>
      <div class="acts" style="margin-top:6px">${linkBtn(CL+x.docket_absolute_url,"Open docket & filings")}<button class="btn ghost small" data-fsave="${i}">${icon("plus")}Save to my case</button></div></div>`).join("");
    $$("[data-fsave]",out).forEach(b=>b.onclick=()=>{ const x = res[+b.dataset.fsave]; T.found.push({id:uid(), name:x.caseName, docket:x.docketNumber, court:x.court, filed:x.dateFiled, url:CL+x.docket_absolute_url}); tsave(); toast("Saved."); CC.render(); });
  }catch(e){ out.innerHTML = `<p class="small">CourtListener didn't answer. Try again, or search directly:</p><div class="acts">${linkBtn(CL+"/?type=r&q="+enc(num),"CourtListener")}${linkBtn("https://pcl.uscourts.gov/pcl/index.jsf","PACER")}</div>`; }
}
async function judgeLookup(name){
  const md = modal(`<h3>${icon("gavel")}${esc(name)}</h3><p class="small">Looking up public judge records…</p>`);
  try{ const d = await (await fetch(CL+"/api/rest/v4/search/?type=p&q="+enc(name.replace(/^(hon\.?|judge)\s+/i,"")))).json(); const r = (d.results||[]).slice(0,5);
    $(".sheet",md).innerHTML = `<h3>${icon("gavel")}${esc(name)}</h3>${r.length? r.map(x=>`<div class="card flat" style="padding:10px"><b>${esc(x.name)}</b><div class="small">${esc((x.court||[]).join?.(", ")||x.court||"")}${x.appointer?" · appointed by "+esc([].concat(x.appointer).join(", ")):""}${x.political_affiliation?" · "+esc([].concat(x.political_affiliation).join(", ")):""}</div><div class="acts" style="margin-top:6px">${linkBtn(CL+x.absolute_url,"Full profile")}</div></div>`).join("") : `<p class="small">No profile found. State trial judges often aren't listed.</p>`}
      <div class="acts">${linkBtn("https://www.google.com/search?q="+enc('"'+name+'" judge'),"Search the web")}<button class="btn ghost small" data-close>Close</button></div>`; $$("[data-close]",md).forEach(b=>b.onclick=()=>md.hidden=true);
  }catch(e){ $(".sheet",md).innerHTML = `<p class="small">Couldn't reach CourtListener.</p><button class="btn" data-close>Close</button>`; $$("[data-close]",md).forEach(b=>b.onclick=()=>md.hidden=true); }
}

/* My lawyer */
SUB.lawyer = () => { const s = CC.lawSub || "duties";
  return `<div class="seg">${[["duties","First court date to-do"],["requests","My requests"],["comms","Contact log"],["offers","Plea offers"],["letters","Letters to sign"]].map(([k,l])=>`<button data-lsub="${k}" class="${s===k?"on":""}">${l}</button>`).join("")}</div>`
   + (s==="letters" ? lettersView() : s==="duties" ? (window.CCduty?window.CCduty.view():"") : listMod(s, MODS[s])); };
WIRE.lawyer = v => { $$("[data-lsub]",v).forEach(b=>b.onclick=()=>{ CC.lawSub=b.dataset.lsub; CC.render(); }); if ((CC.lawSub||"duties")==="duties" && window.CCduty) window.CCduty.wire(v); };
const LETTERS = [
  {id:"tk-decisions", title:"My decisions as the client", what:"Puts in writing the decisions that belong to you: whether to plead, whether to testify, jury or no jury, and that you maintain your innocence.", body:"To: [attorney name]\nRe: [case number]\nDate: [date]\n\nI am writing so my decisions are clear and on record. These decisions are mine to make as the client:\n\n1. Plea: I do not want to plead guilty or accept a plea offer at this time. Please tell me about every offer in writing, and do not accept any offer for me.\n2. Trial: I want a [jury / court] trial.\n3. Testifying: I will decide whether to testify after we discuss it.\n4. Speedy trial: I [do / do not] agree to waive time.\n\nPlease confirm in writing that you received this letter.\n\nThank you,"},
  {id:"tk-discovery", title:"Request for my discovery", what:"Asks your lawyer for copies of (or a time to review) the evidence, and to tell you if a protective order limits copies.", body:"To: [attorney name]\nRe: [case number]\nDate: [date]\n\nPlease send me copies of the discovery in my case, or set a time for me to review it, including:\n- [police reports]\n- [video / bodycam / audio recordings, with dates]\n- [other items]\n\nIf a protective order limits what I can have, please tell me what it covers and how I can review the items.\n\nPlease let me know by [date] when I can expect them.\n\nThank you,"},
  {id:"tk-speedy", title:"I do not waive time", what:"Tells your lawyer in writing that you want your speedy-trial rights kept.", body:"To: [attorney name]\nRe: [case number]\nDate: [date]\n\nI do not want to waive time in my case. I want my trial within the time the law allows. Please do not agree to a continuance or waive time on my behalf without discussing it with me first. If a continuance is requested, I want my objection stated on the record.\n\nThank you,"},
  {id:"tk-plea-answer", title:"My answer to a plea offer", what:"Your written answer to an offer, so there is no question later what you decided.", body:"To: [attorney name]\nRe: [case number]\nDate: [date]\n\nI received the offer dated [date of offer]: [describe the offer].\n\nMy answer: I [reject / accept] this offer.\n\nPlease communicate my answer to the prosecution and confirm to me in writing that you did.\n\nThank you,"},
  {id:"tk-contact", title:"Please call me — update request", what:"A polite, dated request for a phone call and a status update.", body:"To: [attorney name]\nRe: [case number]\nDate: [date]\n\nI have tried to reach you on [dates] by [phone / text / email]. Please call me at [phone] by [date] for an update on:\n- [motions I asked about]\n- [discovery]\n- [next court date]\n\nI would prefer a phone call to an in-person meeting.\n\nThank you,"},
  {id:"tk-assistant", title:"Authorization for my legal assistant / helper", what:"Lets your lawyer talk to a named helper about scheduling and paperwork. Ask your lawyer how it affects privilege before you sign.", body:"I, [client name], authorize my attorney, [attorney name], to communicate with [helper name], [relationship], phone [phone], about court dates, scheduling, documents and logistics in case [case number].\n\nThis does not authorize sharing strategy or privileged communications unless I say so in writing. Any document my helper prepares must be approved by me before it is signed or sent. I may revoke this at any time in writing."}
];
function lettersView(){ return `<div class="card" style="border-color:var(--bad,#b3261e)"><b>${icon("alert")}READ THIS FIRST — me and my attorney</b><div class="small">Your speedy-trial status, urgent deadlines and open requests on one page, with a line for your attorney to sign that they read it. Sign it and send it to your attorney in one tap.</div><div class="acts" style="margin-top:6px"><button class="btn small" data-sign="tk-first">${icon("check")}Sign &amp; send to my attorney</button><button class="btn ghost small" data-docview="tk-first">Read it</button></div></div><p class="small">Fill in the [brackets], sign on the screen, and send the PDF by email or text. Keep a copy, and log it in the Contact log.</p>` +
  LETTERS.map(d=>`<div class="card flat"><b>${esc(d.title)}</b><div class="small">${esc(d.what)}</div><div class="acts" style="margin-top:6px"><button class="btn small" data-sign="${d.id}">${icon("check")}Fill &amp; sign</button><button class="btn ghost small" data-docview="${d.id}">Read it</button></div></div>`).join(""); }

SUB.discovery = () => listMod("discovery", MODS.discovery);
SUB.timeline = () => listMod("timeline", MODS.timeline) + `<div class="row" style="margin-top:6px"><button class="btn ghost" id="tl-exp">${icon("download")}Download timeline</button></div>`;
WIRE.timeline = v => { $("#tl-exp",v).onclick = () => { const L = items("timeline").sort((a,b)=>String(a.date+(a.time||"")).localeCompare(String(b.date+(b.time||""))));
  download("timeline.txt", L.map(x=>`${x.date}${x.time?" "+x.time:""}${x.case?" ["+caseNum(x.case)+"]":""}\n${x.what}${x.proof?"\nProof: "+x.proof:""}\n`).join("\n"), "text/plain"); }; };
SUB.notebook = () => listMod("notebook", MODS.notebook);

/* Research feed */
const PROSE_Q = '("pro se" OR "pro per" OR "in propria persona" OR Faretta OR "self-representation")';
function terms(){ return T.research.terms || [...statuteGuess(), ...(CC.profile.research_terms||[])]; }
SUB.research = () => { const R = T.research, tm = terms(), last = R.last ? new Date(R.last).toLocaleString() : "never";
  const saved = items("saved");
  return card("Case-law feed","search",`<p class="small">Live searches of published court opinions on CourtListener for the laws in your case. It checks again each day you open this tab and marks what's new. Read the full opinion before relying on any case, and take what you find to your lawyer.</p>
    <label for="rs-terms">Search terms (one per line — statutes, issues, phrases)</label><textarea id="rs-terms" style="min-height:90px">${esc(tm.join("\n"))}</textarea>
    <div class="row" style="margin-top:8px"><button class="btn" id="rs-run">${icon("search")}Search now</button><label class="row small" style="margin:0;gap:6px;font-weight:500"><input type="checkbox" id="rs-prose" style="width:auto;min-height:0" ${CC.rsProse?"checked":""}> Only pro per / self-representation cases</label></div>
    <p class="small muted">Last checked: ${esc(last)}</p><div id="rs-out">${resultsHTML()}</div>`)
  + card(`Saved cases (${saved.length})`,"book", saved.length? saved.map(s=>`<div class="card flat" style="padding:10px"><b><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></b> <span class="chip ${s.verdict==="helps"?"verified":s.verdict==="hurts"?"fee":""}">${esc({helps:"Helps",hurts:"Hurts",unsure:"Not sure"}[s.verdict]||"")}</span><div class="small">${esc([s.cite,s.court,fmtD(s.date)].filter(Boolean).join(" · "))}</div>${s.note?`<div class="small" style="margin-top:4px">${esc(s.note)}</div>`:""}
     <div class="row" style="gap:6px;margin-top:6px">${s.seed?'<span class="chip sample">From your case file</span>':`<button class="btn ghost small" data-snote="${esc(s.id)}">Note</button><button class="btn ghost small" data-tdel="saved:${esc(s.id)}">${icon("x")}</button>`}</div></div>`).join("") : `<p class="muted small">Tap Save on any result to keep it here, marked helps / hurts.</p>`); };
function resultsHTML(){ const R = T.research, rs = R.results||{}; const keys = Object.keys(rs); if (!keys.length) return "";
  return keys.map(k=>{ const list = rs[k]||[]; if (rs[k]===null) return `<h4 style="margin:12px 0 4px">${esc(k)}</h4><p class="small muted">CourtListener is busy right now — try again in a minute. ${_.searchBtns(k,["cl"])}</p>`; return `<h4 style="margin:12px 0 4px">${esc(k)}</h4>${list.length? list.map(x=>`<div class="card flat" style="padding:10px">${x.isNew?'<span class="chip fee">New</span> ':""}<b><a href="${esc(CL+x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a></b><div class="small">${esc([x.cite,x.court,fmtD(x.date)].filter(Boolean).join(" · "))}</div>
     <div class="row" style="gap:6px;margin-top:6px">${["helps","hurts","unsure"].map(vv=>`<button class="btn ghost small" data-rsave="${esc(k)}|${esc(x.url)}|${vv}">${{helps:"Save: helps",hurts:"Save: hurts",unsure:"Save: not sure"}[vv]}</button>`).join("")}</div></div>`).join("") : `<p class="small muted">No results.</p>`}`; }).join(""); }
async function runResearch(quiet){
  const R = T.research, list = $("#rs-terms") ? $("#rs-terms").value.split("\n").map(s=>s.trim()).filter(Boolean) : terms();
  if (!list.length){ if (!quiet) toast("Add at least one search term."); return; }
  if ($("#rs-terms")) R.terms = list;
  const prose = !!CC.rsProse; R.results = {}; const seen = R.seen || (R.seen = {});
  if ($("#rs-out")) $("#rs-out").innerHTML = `<p class="small">Searching ${list.length} term(s)…</p>`;
  for (const t of list.slice(0,8)){
    try{ const q = prose ? `(${t}) AND ${PROSE_Q}` : t;
      const r = await fetch(CL+"/api/rest/v4/search/?type=o&order_by=dateFiled%20desc&q="+enc(q));
      if (!r.ok){ R.results[t] = null; continue; } const d = await r.json();
      R.results[t] = (d.results||[]).slice(0,8).map(x=>{ const url = x.absolute_url; const isNew = !seen[url]; seen[url] = seen[url] || now();
        return {name:x.caseName, cite:(x.citation||[])[0]||"", court:x.court, date:x.dateFiled, url, isNew: isNew && !!R.last}; });
    }catch(e){ R.results[t] = []; }
  }
  R.last = Date.now(); tsave();
  if ($("#rs-out")){ $("#rs-out").innerHTML = resultsHTML(); wireResearch($("#view")); }
}
function wireResearch(v){
  $$("[data-rsave]",v).forEach(b=>b.onclick=()=>{ const [k,url,verdict] = b.dataset.rsave.split("|"); const x = (T.research.results[k]||[]).find(r=>r.url===url); if (!x) return;
    if (T.saved.some(s=>s.url===CL+url)) return toast("Already saved.");
    T.saved.push({id:uid(), name:x.name, cite:x.cite, court:x.court, date:x.date, url:CL+url, verdict, term:k, added:now()}); tsave(); toast("Saved."); CC.render(); });
}
WIRE.research = v => {
  $("#rs-run",v).onclick = () => runResearch(false);
  $("#rs-prose",v).onchange = e => { CC.rsProse = e.target.checked; };
  $$("[data-snote]",v).forEach(b=>b.onclick=()=>{ const s = T.saved.find(x=>x.id===b.dataset.snote); if (!s) return;
    const md = modal(`<h3>Note on ${esc(s.name)}</h3><label for="sn-v">Helps or hurts?</label><select id="sn-v">${[["helps","Helps"],["hurts","Hurts"],["unsure","Not sure"]].map(([k,l])=>`<option value="${k}" ${s.verdict===k?"selected":""}>${l}</option>`).join("")}</select><label for="sn-n">Why (in your words)</label><textarea id="sn-n">${esc(s.note||"")}</textarea><div class="row" style="margin-top:10px"><button class="btn" id="sn-s">Save</button><button class="btn ghost" data-close>Cancel</button></div>`);
    $("#sn-s",md).onclick = () => { s.verdict = $("#sn-v",md).value; s.note = $("#sn-n",md).value.trim(); md.hidden = true; tsave(); CC.render(); }; });
  wireResearch(v);
  if (!T.research.last || Date.now() - T.research.last > 20*36e5) runResearch(true);
};

/* Pro per guide — general information with sources; the user decides. */
const PP = {
  rights:[
    ["Faretta v. California, 422 U.S. 806 (1975)","You have a constitutional right to represent yourself if you ask clearly, on time, and the judge finds you understand what you're giving up. The judge can warn you it's a bad idea but can't refuse a valid, timely request just because you'll probably do worse than a lawyer."],
    ["McKaskle v. Wiggins, 465 U.S. 168 (1984)","The judge may appoint standby counsel, even over your objection. Standby counsel can't take over: you control the defense and the jury must see you as representing yourself."],
    ["Iowa v. Tovar, 541 U.S. 77 (2004)","What the judge has to tell you before you give up a lawyer depends on the stage of the case; at a plea, you must understand the charges, your right to a lawyer and the possible punishment."],
    ["Indiana v. Edwards, 554 U.S. 164 (2008)","A judge can require a lawyer for someone who is competent to stand trial but, because of severe mental illness, is not competent to run the trial alone."],
    ["Martinez v. Court of Appeal, 528 U.S. 152 (2000)","There is no constitutional right to represent yourself on a direct appeal."],
    ["Kane v. Garcia Espitia, 546 U.S. 9 (2005)","The Supreme Court has not clearly established a right to law-library access for someone representing themselves while in custody — ask the judge for a pro per privileges order."],
    ["28 U.S.C. § 1654","In federal court, parties may plead and conduct their own cases personally."]],
  ca:[
    ["People v. Windham (1977) 19 Cal.3d 121","In California the request must be made a reasonable time before trial to be a right. Asked later, it's up to the judge."],
    ["People v. Lopez (1977) 71 Cal.App.3d 568","The advisements California judges commonly give (often on a written \"Lopez\" or Faretta waiver form) about the dangers of self-representation."],
    ["People v. Marsden (1970) 2 Cal.3d 118","If you have an appointed lawyer, you can ask for a private hearing to replace them. You have to give specific reasons (not doing the work, a breakdown in the relationship)."],
    ["Townsend v. Superior Court (1975) 15 Cal.3d 774","A California court can let your lawyer waive time even over your objection when it's for your benefit. If speedy trial matters to you, say so on the record yourself."],
    ["Penal Code § 1382","California's speedy-trial deadlines (for a felony, generally 60 days after arraignment on the information unless you waive time)."]],
  fed:[
    ["18 U.S.C. § 3161 (Speedy Trial Act)","Federal deadlines: indictment within 30 days of arrest; trial within 70 days of indictment or first appearance, minus excluded time."],
    ["Missouri v. Frye, 566 U.S. 134 (2012)","Your lawyer must tell you about formal plea offers. The decision to take or reject one is yours."],
    ["Rock v. Arkansas, 483 U.S. 44 (1987)","Whether to testify is your decision."],
    ["McCoy v. Louisiana, 584 U.S. 414 (2018)","Your lawyer can't admit your guilt over your objection; you decide the objective of maintaining innocence."]],
  pressure:[
    ["\"People who represent themselves always lose.\"","Many do worse than they would with a good lawyer — that's real. But the choice is yours, and the judge can't deny a valid, timely request because of it (Faretta). If you go this way, prepare like it's a full-time job."],
    ["\"You don't know the rules of evidence.\"","The judge will ask if you understand you'll be held to the same rules as a lawyer. The truthful answer is \"Yes, I understand that.\" Then study them (Evidence Code in California; Federal Rules of Evidence)."],
    ["\"You can't complain later that your lawyer was bad.\"","True. If you represent yourself you generally can't claim ineffective assistance for your own work (Faretta, footnote 46). Know that before you decide."],
    ["\"Take the deal now or it's gone.\"","Deadlines on offers are real. But the decision is yours alone. Ask for the offer in writing, log it, and answer in writing."],
    ["\"Waive time so we can prepare.\"","Sometimes more time really helps the defense. If you want a speedy trial, say \"I do not waive time\" on the record yourself."],
    ["\"Don't testify.\"","Testifying has real risks, and your lawyer should explain them. The final choice is yours (Rock v. Arkansas)."],
    ["\"Standby counsel will handle it.\"","Standby counsel can help if you ask, but can't run your case (McKaskle)."],
    ["\"The judge can take pro per away.\"","True — for serious misconduct or deliberate disruption. Stay respectful and organized and it won't be an issue."],
    ["\"Why are they asking about my education and medications?\"","Those are standard questions so the judge can make sure your choice is knowing and voluntary. Answer honestly."],
    ["\"You'll have no help in jail.\"","Ask the court for pro per privileges (law library time, legal phone calls, an investigator, copies). What's available depends on the county."]],
  never:["Never contact a witness, alleged victim or protected person yourself — not as pro per, not through family. Use a court-appointed investigator and the court's process.","Never discuss your case on jail phones or in jail visits — they are recorded.","Never miss a deadline or a court date; ask for more time in writing before it passes.","Never argue with the judge after a ruling — say \"I object, for the record\" and move on."],
  steps:["Decide early. In California a request is a right only if it's made a reasonable time before trial.","Say it clearly in court: \"Your Honor, I want to represent myself.\" (A Marsden request to replace an appointed lawyer is different — ask for it separately if that's what you want.)","Expect the judge's questions and the waiver form; answer honestly.","Ask for standby or advisory counsel if you want it, and for pro per privileges if you're in custody.","Get the full discovery and the docket; calendar every deadline in Reminders.","Use the Notebook to write each defense point and the cases that support it."]
};
SUB.proper = () => {
  const saved = items("saved").filter(s=>new RegExp("pro se|pro per|faretta|self-repres|marsden|standby","i").test([s.name,s.term,s.note].join(" ")));
  const ref = rows => rows.map(([c,t])=>`<div class="card flat" style="padding:10px"><b>${esc(c)}</b><div class="small" style="margin-top:4px">${esc(t)}</div><div class="acts" style="margin-top:6px">${_.searchBtns(c.replace(/\s*\(.*$/,"").replace(/,\s*\d.*$/,""),["cl","scholar"])}</div></div>`).join("");
  return `<div class="card" style="border-color:var(--gold)"><p class="small" style="margin:0"><b>Representing yourself ("pro per" in California, "pro se" in federal court)</b> is your right, with real risks. This guide is general information with sources so you can decide with eyes open — it isn't legal advice. Read each case yourself.</p></div>`
   + card("How it works — step by step","flag",`<ol class="small" style="padding-left:18px">${PP.steps.map(s=>`<li>${esc(s)}</li>`).join("")}</ol>`)
   + card("What they'll say — and the truthful answer","ear", PP.pressure.map(([q,a])=>`<div class="card flat" style="padding:10px"><b>${esc(q)}</b><div class="small" style="margin-top:4px">${esc(a)}</div></div>`).join(""))
   + card("Never","ban",`<ul class="small" style="padding-left:18px">${PP.never.map(s=>`<li>${esc(s)}</li>`).join("")}</ul>`)
   + card("The law — U.S. Supreme Court & federal","scales", ref(PP.rights))
   + card("California","scales", ref(PP.ca))
   + card("Federal case decisions that are yours","scales", ref(PP.fed))
   + card(`From your research feed (${saved.length})`,"search", saved.length? saved.map(s=>`<div class="small" style="margin:6px 0"><a href="${esc(s.url)}" target="_blank" rel="noopener"><b>${esc(s.name)}</b></a> · ${esc([s.cite,s.court].filter(Boolean).join(" · "))}${s.note?" — "+esc(s.note):""}</div>`).join("") : `<p class="small muted">Go to Research, tick "Only pro per / self-representation cases", search, and save the ones that matter. They'll show up here.</p>`)
   + `<p class="small muted">Citations checked against the official reporters' names and years; confirm current law before relying on any of them.</p>`;
};

/* Emergency plan */
SUB.plan = () => { const P = T.plan;
  return card("If I'm arrested or can't be reached","alert",`<p class="small">What your family should do. Keep it short; they'll read it in a hurry. Never put passwords here.</p>
    <label for="pl-first">First call</label><input id="pl-first" value="${esc(P.first||"")}" placeholder="e.g. My lawyer: name and number">
    <label for="pl-docs">Where my papers are</label><input id="pl-docs" value="${esc(P.docs||"")}" placeholder="e.g. Folder in the hall closet; copies in this app">
    <label for="pl-bail">Bail / release plan</label><input id="pl-bail" value="${esc(P.bail||"")}" placeholder="e.g. Who to call, what's set aside">
    <label for="pl-tasks">Things to keep going</label><textarea id="pl-tasks" placeholder="Rent, car, kids, pets, work — who handles what">${esc(P.tasks||"")}</textarea>
    <label for="pl-say">What NOT to do</label><textarea id="pl-say">${esc(P.say||"Don't discuss my case on jail calls or social media. Don't contact any witness or anyone in the case. Send everything through my lawyer.")}</textarea>
    <div class="row" style="margin-top:10px"><button class="btn" id="pl-save">${icon("check")}Save</button><button class="btn ghost" id="pl-print">${icon("download")}Print / PDF for family</button></div>`)
  + card("My helpers","hands", listMod("helpers", MODS.helpers)); };
WIRE.plan = v => {
  const get = () => ({first:$("#pl-first",v).value.trim(), docs:$("#pl-docs",v).value.trim(), bail:$("#pl-bail",v).value.trim(), tasks:$("#pl-tasks",v).value.trim(), say:$("#pl-say",v).value.trim()});
  $("#pl-save",v).onclick = () => { const p = get(); if (!_.guardOK(...Object.values(p))) return; T.plan = p; tsave(); toast("Saved."); };
  $("#pl-print",v).onclick = () => { const p = get(); const H = items("helpers");
    $("#print").innerHTML = `<h1>Emergency plan — ${esc(CC.profile.person?.name||"")}</h1>${[["First call",p.first],["Where my papers are",p.docs],["Bail / release plan",p.bail],["Things to keep going",p.tasks],["What NOT to do",p.say]].map(([k,x])=>x?`<h2>${k}</h2><p>${esc(x).replace(/\n/g,"<br>")}</p>`:"").join("")}
      ${H.length?`<h2>Helpers</h2><ul>${H.map(h=>`<li>${esc(h.name)} (${esc(h.rel||"")}) ${esc(h.phone||"")} — ${esc(h.does||"")}</li>`).join("")}</ul>`:""}
      <h2>Case numbers</h2><ul>${(CC.profile.cases||[]).map(k=>`<li>${esc(k.number)} — ${esc(k.court_label||"")}</li>`).join("")}</ul><div class="disc">Information only — not legal advice.</div>`;
    document.body.classList.add("printing"); const done=()=>{document.body.classList.remove("printing"); window.removeEventListener("afterprint",done)}; window.addEventListener("afterprint",done); setTimeout(()=>window.print(),50); };
};


/* ───────── Find help: guided lookups (lawyers, free lawyers, legal aid, bail, tickets, record clearing) ───────── */
const HELP = [
 ["free","I can't afford a lawyer", st => [
   "At your first court date (arraignment), tell the judge you can't afford a lawyer and ask for the public defender. You'll fill out a short financial form.",
   "Federal case: you'll get the Federal Public Defender or a CJA panel lawyer the same way.",
   "Your county's public defender office and phone number are in the Directory tab."], st => [["#directory","Public defender — your county (Directory)"]]],
 ["hire","Hire a private lawyer", st => [
   "Use a State Bar–certified lawyer referral service: they screen lawyers and the first consult is usually low-cost.",
   "Before you pay anyone, look up their license and discipline record (type their name below).",
   "Ask: How many cases like mine have you tried? Who will actually handle my case? Flat fee or hourly — and what does it include (motions, trial)? How fast do you return calls?",
   "Get the fee agreement in writing. In California, most fee agreements over $1,000 must be in writing."], st => (st.statewide_help||[]).filter(x=>/Referral|attorney search/i.test(x.name)).map(x=>[x.url,x.name]), true],
 ["aid","Free legal aid (non-criminal problems too)", st => [
   "Legal aid groups help with housing, benefits, family law, record clearing and more, for free if you qualify.",
   "The courts' self-help centers help you fill out forms yourself."], st => (st.statewide_help||[]).filter(x=>/LawHelp|Self-Help/i.test(x.name)).map(x=>[x.url,x.name])],
 ["bail","Bail / a bail bondsman", st => [...(st.bail?.how_to_verify||[]), "Get every payment in writing with a receipt, and read the contract before signing. Ask what happens to the premium and collateral when the case ends."],
   st => [[st.bail?.license_lookup_url,"Check a bail agent's license (CDI)"],[st.bail?.rate_lookup_url,"Check filed bail rates (CDI)"],["#directory","Jails and bail info — your county"]].filter(x=>x[0])],
 ["ticket","A traffic ticket", st => [
   "Read the date on the ticket. Missing it can add a failure-to-appear charge and a license hold.",
   "You can usually pay, ask for traffic school, fight it in court, or fight it by written declaration. You can ask the court to lower the fine based on your ability to pay.",
   "The court's self-help guide walks you through each option."], st => [["https://selfhelp.courts.ca.gov/","California Courts Self-Help"]]],
 ["record","Clearing my record", st => [
   "Many convictions can be dismissed or reduced after probation, which helps with jobs and housing.",
   "Answer the court's questionnaire to see which option fits; legal aid groups often help for free."], st => (st.record_clearing||[]).map(x=>[x.url,x.name])],
 ["self","Representing myself", st => ["Read the Pro per tab first: the steps, the questions the judge will ask, and the cases.", "Use the court's self-help center for forms and procedure."], st => [["#toolkit:proper","Pro per guide"],["https://selfhelp.courts.ca.gov/","California Courts Self-Help"]]],
];
SUB.help = () => { const st = CC.data.state||{}, pick = CC.helpPick;
  return `<p class="small">Pick what you need. Each one walks you through it step by step, with the official place to go.</p>
   <div class="grid two">${HELP.map(([k,l])=>`<button class="btn ${pick===k?"":"ghost"}" data-help="${k}" style="justify-content:flex-start">${icon(k==="bail"?"bond":k==="ticket"?"flag":k==="record"?"shield":"users")}${esc(l)}</button>`).join("")}</div>
   ${pick ? (()=>{ const h = HELP.find(x=>x[0]===pick); return card(esc(h[1]),"info",`<ol class="small" style="padding-left:18px">${h[2](st).map(x=>`<li>${esc(x)}</li>`).join("")}</ol>
     ${h[4]?`<label for="hp-name">Look up a lawyer by name or bar number</label><div class="row"><input id="hp-name" style="flex:1" placeholder="e.g. Jane Smith or 123456"><button class="btn" id="hp-go">${icon("search")}Look up</button></div>`:""}
     <div class="acts" style="margin-top:10px">${h[3](st).map(([u,l])=>u.startsWith("#")?`<a class="btn ghost small" href="${u.split(":")[0]}" ${u.includes(":")?`data-gotk="${u.split(":")[1]}"`:""}>${icon("link")}${esc(l)}</a>`:linkBtn(u,l)).join("")}</div>`); })() : ""}`; };
WIRE.help = v => { $$("[data-help]",v).forEach(b=>b.onclick=()=>{ CC.helpPick=b.dataset.help; CC.render(); });
  $$("[data-gotk]",v).forEach(a=>a.onclick=e=>{ e.preventDefault(); CC.tkTab=a.dataset.gotk; CC.render(); });
  const go = $("#hp-go",v); if (go) go.onclick = () => { const n = $("#hp-name",v).value.trim(); if (!n) return; window.open("https://apps.calbar.ca.gov/attorney/LicenseeSearch/QuickSearch?FreeText="+enc(n),"_blank","noopener"); }; };

/* ───────── Library: the built-in "brain" of free case law (works offline once loaded) ───────── */
let LIB = null;
async function lib(){ if (LIB) return LIB; const p = "data/brain/library.json";
  try{ LIB = (CC.inline && CC.inline[p]) || await (await fetch(p)).json(); }catch(e){ LIB = {topics:[]}; } return LIB; }
SUB.library = () => `<p class="small">A built-in library of the most-cited court decisions on criminal cases, traffic tickets, appeals and civil-rights suits — already downloaded, so it works without searching. Tap any case to read the full opinion free on CourtListener. Information only — read the case and confirm it's still good law.</p>
  <label for="lb-q">Search the library</label><input id="lb-q" type="search" placeholder="e.g. Miranda, bail, speedy trial, 1512, DUI" value="${esc(CC.libQ||"")}">
  <div id="lb-out" style="margin-top:10px"><p class="small muted">Loading the library…</p></div>`;
WIRE.library = async v => { const L = await lib(), out = $("#lb-out",v), q = $("#lb-q",v); if (!out) return;
  const draw = () => { const qq = (CC.libQ = q.value.trim()).toLowerCase(); const total = L.topics.reduce((a,t)=>a+t.cases.length,0);
    if (!qq){ const areas = [...new Set(L.topics.map(t=>t.area))];
      out.innerHTML = `<p class="small muted">${L.topics.length} topics · ${total} cases · updated ${esc(L.built||"")}</p>` + areas.map(a=>`<h4 style="margin:14px 0 6px">${esc(a)}</h4>${L.topics.filter(t=>t.area===a).map(t=>`<details class="card flat" style="padding:10px"><summary><b>${esc(t.label)}</b> <span class="small muted">(${t.cases.length})</span><div class="small">${esc(t.what)}</div></summary>${t.cases.map(caseRow).join("")}</details>`).join("")}`).join(""); }
    else { const hits = []; for (const t of L.topics) for (const c of t.cases) if ([t.label,t.what,c.name,c.cite,c.snip].join(" ").toLowerCase().includes(qq)) hits.push([t,c]);
      out.innerHTML = `<p class="small"><b>${hits.length}</b> case${hits.length===1?"":"s"}</p>` + hits.slice(0,120).map(([t,c])=>caseRow(c, t.label)).join("") + `<div class="acts" style="margin-top:8px">${_.searchBtns(q.value.trim(),["cl","scholar"])}</div>`; }
    $$("[data-lsave]",out).forEach(b=>b.onclick=()=>{ const c = JSON.parse(b.dataset.lsave); if (T.saved.some(s=>s.url===c.url)) return toast("Already saved."); T.saved.push({id:uid(), ...c, verdict:"unsure", added:now()}); tsave(); toast("Saved to Research."); }); };
  let t; q.oninput = () => { clearTimeout(t); t = setTimeout(draw, 200); }; draw(); };
function caseRow(c, topic){ return `<div style="border-top:1px solid var(--line);padding:8px 0"><a href="${esc(c.url)}" target="_blank" rel="noopener"><b>${esc(c.name)}</b></a><div class="small">${esc([c.cite,c.court,(c.date||"").slice(0,4),c.cites?c.cites+" later cases cite it":"",topic].filter(Boolean).join(" · "))}</div>${c.snip?`<div class="small muted">${esc(c.snip)}</div>`:""}
  <button class="btn ghost small" style="margin-top:4px" data-lsave="${esc(JSON.stringify({name:c.name,cite:c.cite,court:c.court,date:c.date,url:c.url,term:topic||""}))}">${icon("plus")}Save</button></div>`; }

/* ───────── Walkthrough: the first time someone opens each section, explain what it's for ───────── */
const TOUR = {
 home:["Home","Your next court date, what's due this week, and the ground rules. Tap \"Add to calendar\" so your phone reminds you."],
 court:["Court","Find your courthouse and courtroom: address, parking, what to bring and how to check in."],
 tasks:["Reminders","Every obligation in one list — court, probation, ankle monitor, drug tests, classes, fees. Add your own and they'll remind you."],
 directory:["Directory","Phone numbers and addresses for the public defender, legal aid, probation, programs, jails and bail in your county. Tap to call, text, email or map."],
 guides:["Guides","Motions at each stage of a case, what happens if you lose, and how appeals and record clearing work."],
 case:["My case","Your case at a glance, a family area, a private attorney-only area, documents to sign, and a PDF packet for your lawyer."],
 settings:["Settings","Switch between the sample and your own case, export or erase your data, and replay these tips."],
 toolkit:["Toolkit","Your workbench: find help, the case-law library, your records and transcripts, your lawyer's to-do list, evidence, research and the pro per guide. The tabs across the top switch sections."],
 "tk-deadlines":["Deadlines","Your speedy-trial clock, appeal deadlines and motion deadlines counting down. Anything within 14 days says URGENT. If you waived time, it tells you plainly and how to restart the clock."],
 "tk-jails":["Jails & prisons","Every county jail (men's and women's), which courthouse people held there go to, visiting and sending money — plus California state prisons (CDCR) and federal prisons."],
 "tk-help":["Find help","Pick what you need — a free lawyer, a private lawyer, legal aid, bail, a ticket, clearing your record — and it walks you through it with the official links."],
 "tk-library":["Library","The app's built-in brain: hundreds of the most-cited court decisions by topic, already downloaded. Search it or browse by topic, and save cases to your research."],
 "tk-records":["Records","Find your case by number, keep transcripts and papers on your phone and search every page, look up the professionals on your case, and check your own record."],
 "tk-lawyer":["My lawyer","Starts with the first-court-date to-do list for your lawyer — mark each item and text it to your family — and what ineffective assistance really means. Then: Track what you asked your lawyer for and whether it got done, every call and whether they replied, every plea offer and your answer, and letters you can sign on screen."],
 "tk-discovery":["Discovery","The evidence in your case and whether you've actually seen it. Anything you haven't seen shows in red."],
 "tk-timeline":["Timeline","Write down what happened the day it happens. A dated record beats memory later. Download it any time."],
 "tk-research":["Research","Live searches of new court decisions on the laws in your case. It checks again each day you open it, marks what's new, and lets you save cases as helps or hurts."],
 "tk-proper":["Pro per","If you're thinking about representing yourself: the steps, what people will say to scare you and the truthful answer, and the cases — with sources."],
 "tk-notebook":["Notebook","Your own defense points: what you'd say, what supports it, and what the other side will say back."],
 "tk-plan":["Emergency plan","What your family should do if you're arrested or can't be reached — who to call, where papers are, what not to do. Print it for them."],
};
let TS = {}; try{ TS = JSON.parse(localStorage.getItem("cc:tour")||"{}"); }catch(e){}
function tour(k){ const t = TOUR[k]; if (!t || TS[k] || !$("#modal").hidden) return; TS[k] = 1; try{ localStorage.setItem("cc:tour", JSON.stringify(TS)); }catch(e){}
  modal(`<div class="eyebrow small" style="color:var(--gold);font-weight:700;letter-spacing:.08em;text-transform:uppercase">Quick tour</div><h3>${icon("info")}${esc(t[0])}</h3><p>${esc(t[1])}</p><div class="row"><button class="btn" data-close>Got it</button><button class="btn ghost small" id="tour-off">Turn off tips</button></div>`);
  $("#tour-off").onclick = () => { for (const x in TOUR) TS[x] = 1; try{ localStorage.setItem("cc:tour", JSON.stringify(TS)); }catch(e){} $("#modal").hidden = true; }; }
CC.tour = tour;
CC.tourReset = () => { TS = {}; try{ localStorage.removeItem("cc:tour"); }catch(e){} toast("Tips will show again as you open each section."); };
window.addEventListener("hashchange", () => setTimeout(() => tour((location.hash||"#home").slice(1)), 150));
/* ───────── intake: set up my own case ───────── */
function intake(){
  const counties = Object.entries(CC.data.counties||{});
  const md = modal(`<h3>${icon("plus")}Set up my case</h3><p class="small">This creates your own private copy on this device. Nothing is uploaded. You can change everything later.</p>
    <label for="in-name">Your name</label><input id="in-name" autocomplete="name">
    <label for="in-sys">Court</label><select id="in-sys"><option value="federal">Federal court</option>${counties.map(([id,c])=>`<option value="${esc(id)}">${esc(c.name||id)} Superior Court (California)</option>`).join("")}</select>
    <label for="in-num">Case number</label><input id="in-num" placeholder="From your paperwork">
    <label for="in-chg">Charge(s) and code sections</label><input id="in-chg" placeholder="e.g. 18 U.S.C. § 1512(b) or PC § 459">
    <div class="fgrid two"><div><label for="in-date">Next court date</label><input id="in-date" type="date"></div><div><label for="in-time">Time</label><input id="in-time" type="time"></div></div>
    <label for="in-dept">Courtroom / department</label><input id="in-dept">
    <label for="in-atty">My lawyer (name)</label><input id="in-atty">
    <div class="fgrid two"><div><label for="in-aph">Lawyer phone</label><input id="in-aph" type="tel"></div><div><label for="in-aem">Lawyer email</label><input id="in-aem" type="email"></div></div>
    <label for="in-nc">People I'm ordered not to contact (one per line)</label><textarea id="in-nc" placeholder="The app will block reminders, contacts and notes about them."></textarea>
    <div class="row" style="margin-top:12px"><button class="btn" id="in-go">${icon("check")}Create my case</button><button class="btn ghost" data-close>Cancel</button></div>`);
  $("#in-go",md).onclick = () => {
    const g = id => $("#"+id,md).value.trim(); const sys = g("in-sys"), cnty = CC.data.counties[sys];
    if (!g("in-name") || !g("in-num")) return toast("Add your name and case number.");
    if (!_.guardOK(g("in-atty"), g("in-dept"), g("in-chg"))) return;
    const k = {id:"c1", caption:(sys==="federal"?"United States v. ":"People v. ")+g("in-name").split(" ").slice(-1)[0], number:g("in-num"), court_label: sys==="federal" ? "U.S. District Court" : (cnty?.name||sys)+" Superior Court",
      county: sys, charge: g("in-chg"), defense: g("in-atty"), status:"", release:"" };
    const p = { id:"mine-"+uid(), mine:true, person:{name:g("in-name")}, home:{state:"CA", county: sys==="federal" ? (CC.profile.home?.county||"orange") : sys},
      cases:[k], nocontact: g("in-nc").split("\n").map(s=>s.trim()).filter(Boolean), events:[], contacts:[], release_conditions:[] };
    if (g("in-date")) p.events.push({id:"e1", kind:"court", title:"Court date", date:g("in-date"), time:g("in-time")||"", dept:g("in-dept"), caseId:"c1", caseLabel:k.number});
    if (g("in-atty")) p.contacts.push({id:"a1", role:"attorney", name:g("in-atty"), phone:g("in-aph"), email:g("in-aem"), caseId:"c1"});
    try{ localStorage.setItem("cc:profile:mine", JSON.stringify(p)); localStorage.setItem("cc:active","mine"); }catch(e){ return toast("This browser blocked saving. Try a normal (not private) window."); }
    location.hash = "#home"; location.reload(); };
}
CC.intake = intake;
/* Add another case to MY profile (several cases at once: e.g. a federal and a state case). */
function addCase(){
  let p=null; try{ p=JSON.parse(localStorage.getItem("cc:profile:mine")||"null"); }catch(e){}
  if (!p) return intake();
  const counties = Object.entries(CC.data.counties||{});
  const md = modal(`<h3>${icon("plus")}Add another case</h3><p class="small">Adds a case to ${esc(p.person?.name||"your profile")} (you have ${(p.cases||[]).length}). Each case gets its own number, court, lawyer and dates.</p>
    <label for="ac-sys">Court</label><select id="ac-sys"><option value="federal">Federal court</option>${counties.map(([id,c])=>`<option value="${esc(id)}">${esc(c.name||id)} Superior Court (California)</option>`).join("")}</select>
    <label for="ac-num">Case number</label><input id="ac-num" placeholder="From your paperwork">
    <label for="ac-chg">Charge(s) and code sections</label><input id="ac-chg">
    <div class="fgrid two"><div><label for="ac-date">Next court date</label><input id="ac-date" type="date"></div><div><label for="ac-time">Time</label><input id="ac-time" type="time"></div></div>
    <label for="ac-dept">Courtroom / department</label><input id="ac-dept">
    <label for="ac-atty">Lawyer on this case</label><input id="ac-atty">
    <div class="fgrid two"><div><label for="ac-aph">Lawyer phone</label><input id="ac-aph" type="tel"></div><div><label for="ac-aem">Lawyer email</label><input id="ac-aem" type="email"></div></div>
    <div class="row" style="margin-top:12px"><button class="btn" id="ac-go">${icon("check")}Add this case</button><button class="btn ghost" data-close>Cancel</button></div>`);
  $("#ac-go",md).onclick = () => {
    const g = id => $("#"+id,md).value.trim(); const sys=g("ac-sys"), cnty=CC.data.counties[sys];
    if (!g("ac-num")) return toast("Add the case number.");
    if ((p.cases||[]).some(c=>c.number===g("ac-num"))) return toast("That case is already in your profile.");
    if (!_.guardOK(g("ac-atty"), g("ac-dept"), g("ac-chg"))) return;
    p.cases ||= []; p.events ||= []; p.contacts ||= [];
    const cid = "c"+(p.cases.length+1)+"-"+uid().slice(0,4), last=(p.person?.name||"").split(" ").slice(-1)[0];
    const k = {id:cid, caption:(sys==="federal"?"United States v. ":"People v. ")+last, number:g("ac-num"), court_label: sys==="federal"?"U.S. District Court":(cnty?.name||sys)+" Superior Court", county:sys, charge:g("ac-chg"), defense:g("ac-atty"), status:"", release:""};
    p.cases.push(k);
    if (g("ac-date")) p.events.push({id:"e"+uid(), kind:"court", title:"Court date", date:g("ac-date"), time:g("ac-time")||"", dept:g("ac-dept"), caseId:cid, caseLabel:k.number});
    if (g("ac-atty")) p.contacts.push({id:"a"+uid(), role:"attorney", name:g("ac-atty"), phone:g("ac-aph"), email:g("ac-aem"), caseId:cid});
    try{ localStorage.setItem("cc:profile:mine", JSON.stringify(p)); localStorage.setItem("cc:active","mine"); }catch(e){ return toast("This browser blocked saving."); }
    toast("Case added."); location.hash="#home"; location.reload(); };
}
CC.addCase = addCase;
/* Save everything (all cases, notes, toolkit lists, transcripts) to one backup file, and restore it on any phone. */
CC.backup = async () => {
  const keys={}; try{ for (let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if (k && k.startsWith("cc:")) keys[k]=localStorage.getItem(k); } }catch(e){}
  let files=[]; try{ const db=await new Promise((res,rej)=>{ const r=indexedDB.open("cc-files",1); r.onupgradeneeded=()=>r.result.createObjectStore("files",{keyPath:"id"}); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
    files=await new Promise(res=>{ try{ const q=db.transaction("files").objectStore("files").getAll(); q.onsuccess=()=>res(q.result||[]); q.onerror=()=>res([]); }catch(e){ res([]); } });
    files=await Promise.all(files.map(async f=>{ const o={...f}; for (const [k,v] of Object.entries(o)) if (v instanceof Blob){ o[k]={__blob:true,type:v.type,data:await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(v);})}; } return o; })); }catch(e){}
  const out={app:"court-companion",version:1,saved:new Date().toISOString(),keys,files};
  _.download("court-companion-backup-"+new Date().toISOString().slice(0,10)+".json", JSON.stringify(out), "application/json");
  try{ localStorage.setItem("cc:lastBackup", new Date().toISOString()); }catch(e){}
  toast("Backup saved. Keep the file somewhere safe (Files, iCloud Drive or email it to yourself).");
};
CC.restore = () => {
  const inp=document.createElement("input"); inp.type="file"; inp.accept="application/json,.json";
  inp.onchange = async () => { const f=inp.files[0]; if (!f) return; let d; try{ d=JSON.parse(await f.text()); }catch(e){ return toast("That file isn't a Court Companion backup."); }
    if (d.app!=="court-companion"||!d.keys) return toast("That file isn't a Court Companion backup.");
    if (!confirm("Restore this backup? It replaces what's saved in this browser.")) return;
    try{ Object.entries(d.keys).forEach(([k,v])=>{ if (k.startsWith("cc:")) localStorage.setItem(k,v); }); }catch(e){ return toast("This browser blocked saving."); }
    try{ if ((d.files||[]).length){ const db=await new Promise((res,rej)=>{ const r=indexedDB.open("cc-files",1); r.onupgradeneeded=()=>r.result.createObjectStore("files",{keyPath:"id"}); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
      const tx=db.transaction("files","readwrite"), st=tx.objectStore("files");
      for (const f of d.files){ const o={...f}; for (const [k,v] of Object.entries(o)) if (v&&v.__blob){ o[k]=await (await fetch(v.data)).blob(); } st.put(o); } } }catch(e){}
    toast("Restored."); setTimeout(()=>location.reload(),600); };
  inp.click();
};
try{ navigator.storage && navigator.storage.persist && navigator.storage.persist(); }catch(e){}
CC.useDemo = () => { try{ localStorage.setItem("cc:active","demo"); }catch(e){} location.reload(); };
CC.useMine = () => { try{ localStorage.setItem("cc:active","mine"); }catch(e){} location.reload(); };

CC.onStart = async () => {
  tload();
  // Letter templates join the shared documents list so the existing sign-and-send flow handles them.
  setTimeout(() => { const h = (location.hash||"#home").slice(1); tour(h); }, 600);
  if (CC.data.guides){ CC.data.guides.documents ||= []; for (const d of LETTERS) if (!CC.data.guides.documents.some(x=>x.id===d.id)) CC.data.guides.documents.push({...d, kind:"sign"}); }
};
})();
/* ───────── Deadlines: speedy-trial clocks, time waivers, urgent motions; "Read this first"; signed PDFs to the attorney ───────── */
(function(){
const CC = window.CC, _ = CC._, { $, $$, esc, enc, modal, toast } = _;
const DAY = 864e5, addD = (s,n) => _.ymd(new Date(_.parseD(s).getTime()+n*DAY)), left = s => Math.round((_.parseD(s) - _.today())/DAY);
function K(){ try{ return JSON.parse(localStorage.getItem("cc:dl:"+CC.profile.id)||"{}"); }catch(e){ return {}; } }
function KS(o){ try{ localStorage.setItem("cc:dl:"+CC.profile.id, JSON.stringify(o)); }catch(e){} }
const D = () => Object.assign({}, CC.profile.deadlines||{}, K());
/* Each rule: what starts the clock, how many days, the law. The user enters the dates from their paperwork. */
const RULES = {
 "ca-felony":   {label:"California felony", clocks:[["arraign_info","Arraignment on the information (after the prelim)",60,"Trial must start within 60 days unless you waive time (Penal Code § 1382(a)(2))."],["complaint","Arraignment on the complaint",10,"Preliminary hearing within 10 court days (Penal Code § 859b) unless you waive — counted here as calendar days; confirm with your lawyer."]]},
 "ca-misd-in":  {label:"California misdemeanor — in custody", clocks:[["arraign","Arraignment",30,"Trial within 30 days if you're in custody (Penal Code § 1382(a)(3))."]]},
 "ca-misd-out": {label:"California misdemeanor — out of custody", clocks:[["arraign","Arraignment",45,"Trial within 45 days (Penal Code § 1382(a)(3))."]]},
 "federal":     {label:"Federal", clocks:[["arrest","Arrest / complaint",30,"Indictment within 30 days of arrest (18 U.S.C. § 3161(b))."],["indict","Indictment or first appearance (whichever is later)",70,"Trial within 70 days, minus excluded time (18 U.S.C. § 3161(c)(1), (h)). Ask your lawyer which days were excluded."]]}
};
const AFTER = [["sentence_ca_felony","California felony judgment/sentence",60,"Notice of appeal due (Cal. Rules of Court 8.308)."],["sentence_ca_misd","California misdemeanor judgment",30,"Notice of appeal due (Cal. Rules of Court 8.853)."],["sentence_fed","Federal judgment entered",14,"Notice of appeal due (Fed. R. App. P. 4(b))."]];
function items(){ const d = D(), out = [];
  const R = RULES[d.type]; if (R) for (const [k,lab,n,law] of R.clocks) if (d[k]){
    const waived = d.waived && d.waived_on && d.waived_on >= d[k];
    let due = addD(d[k], n), why = law;
    if (waived && d.waiver_end) { due = addD(d.waiver_end, d.type==="federal"?0:10); why = "Limited time waiver: trial within 10 days after "+d.waiver_end+" (Penal Code § 1382(a)(2)(B)). "+law; }
    else if (waived && d.withdrawn) { due = addD(d.withdrawn, 60); why = "You withdrew your time waiver: trial within 60 days of that date (Penal Code § 1382(a)(2)(B)). "+law; }
    out.push({title:(k==="complaint"?"Preliminary hearing clock":k==="arrest"?"Indictment clock":"Speedy trial clock"), from:lab+" "+d[k], due: (waived && !d.waiver_end && !d.withdrawn) ? null : due, why, waived}); }
  for (const [k,lab,n,law] of AFTER) if (d[k]) out.push({title:"Appeal deadline", from:lab+" "+d[k], due:addD(d[k],n), why:law});
  for (const m of (d.motions||[])) if (m.due) out.push({title:m.name, from:"Set by "+(m.by||"the court"), due:m.due, why:m.why||"", motion:true});
  return out.sort((a,b)=>String(a.due||"9").localeCompare(String(b.due||"9"))); }
function badge(it){ if (!it.due) return `<span class="chip fee">TIME WAIVED — clock stopped</span>`; const n = left(it.due);
  return n < 0 ? `<span class="chip fee">OVERDUE ${-n} days</span>` : n <= 14 ? `<span class="chip fee">URGENT · ${n} day${n===1?"":"s"} left</span>` : `<span class="chip">${n} days left</span>`; }
CC.deadlineItems = items;
function view(){ const d = D(), L = items();
  return `${d.waived?`<div class="notice warn">${icon("alert")}<div><b>You waived time${d.waived_on?" on "+esc(d.waived_on):""}${d.waiver_end?" (limited to "+esc(d.waiver_end)+")":" (general waiver)"}.</b> Your speedy-trial clock is stopped. To restart it you must withdraw the waiver in court — say "I withdraw my time waiver" on the record — and the clock restarts.</div></div>`:""}
  <p class="small">Enter the dates from your paperwork. Every clock counts down here and on Home; anything within 14 days is marked <b>URGENT</b>. Courts can extend or exclude time — confirm every date with your lawyer.</p>
  <div class="card"><label for="dl-type">Type of case</label><select id="dl-type"><option value="">Choose…</option>${Object.entries(RULES).map(([k,r])=>`<option value="${k}" ${d.type===k?"selected":""}>${esc(r.label)}</option>`).join("")}</select>
   <div id="dl-dates">${(RULES[d.type]?.clocks||[]).map(([k,lab])=>`<label for="dl-${k}">${esc(lab)}</label><input type="date" id="dl-${k}" data-dk="${k}" value="${esc(d[k]||"")}">`).join("")}</div>
   <label class="row small" style="gap:6px;margin-top:10px;font-weight:600"><input type="checkbox" id="dl-waived" style="width:auto;min-height:0" ${d.waived?"checked":""}> I waived time (speedy trial)</label>
   <div class="fgrid two"><div><label for="dl-waived_on">Date I waived</label><input type="date" id="dl-waived_on" data-dk="waived_on" value="${esc(d.waived_on||"")}"></div><div><label for="dl-waiver_end">Limited waiver — until (blank = general)</label><input type="date" id="dl-waiver_end" data-dk="waiver_end" value="${esc(d.waiver_end||"")}"></div></div>
   <label for="dl-withdrawn">Date I withdrew my waiver in court (if I did)</label><input type="date" id="dl-withdrawn" data-dk="withdrawn" value="${esc(d.withdrawn||"")}">
   <details style="margin-top:8px"><summary class="small"><b>After a conviction — appeal deadlines</b></summary>${AFTER.map(([k,lab])=>`<label for="dl-${k}">${esc(lab)}</label><input type="date" id="dl-${k}" data-dk="${k}" value="${esc(d[k]||"")}">`).join("")}</details>
   <h4 style="margin-top:12px">Motions with a deadline in my case</h4>
   ${(d.motions||[]).map((m,i)=>`<div class="row small" style="gap:6px;margin:4px 0">${esc(m.name)} — due ${esc(m.due)} <button class="btn ghost small" data-mdel="${i}">${icon("x")}</button></div>`).join("")}
   <div class="fgrid two"><div><label for="dl-mname">Motion</label><input id="dl-mname" placeholder="e.g. Motion to suppress (PC 1538.5)"></div><div><label for="dl-mdue">Due / hearing date</label><input type="date" id="dl-mdue"></div></div>
   <div class="row" style="margin-top:10px"><button class="btn" id="dl-save">${icon("check")}Save dates</button></div></div>
  ${L.map(it=>`<div class="card flat"><div class="row between"><b>${esc(it.title)}</b>${badge(it)}</div><div class="small">${esc(it.from)}${it.due?" → due "+esc(_.fmtLong(it.due)):""}</div><div class="small muted">${esc(it.why)}</div></div>`).join("")||""}`; }
function wire(v){
  $("#dl-type",v).onchange = e => { const o = K(); o.type = e.target.value; KS(o); CC.render(); };
  $$("[data-mdel]",v).forEach(b=>b.onclick=()=>{ const o = K(); o.motions = (o.motions||[]); o.motions.splice(+b.dataset.mdel,1); KS(o); CC.render(); });
  $("#dl-save",v).onclick = () => { const o = K(); $$("[data-dk]",v).forEach(i=>{ o[i.dataset.dk] = i.value; }); o.waived = $("#dl-waived",v).checked;
    const mn = $("#dl-mname",v).value.trim(), md = $("#dl-mdue",v).value; if (mn && md){ (o.motions ||= []).push({name:mn, due:md}); }
    KS(o); toast("Saved."); CC.render(); };
}
/* "Read this first" — one page for the client AND the attorney, with an acknowledgment the attorney signs. */
function firstHTML(){ const d = D(), L = items(), P = CC.profile, T = window.CCtk;
  const asks = T ? T.items("requests").filter(r=>!r.status||r.status==="open") : [];
  return `READ THIS FIRST — for me and my attorney
Client: ${P.person?.name||""}
Case(s): ${(P.cases||[]).map(k=>k.number+" ("+(k.court_label||"")+")").join("; ")}
Date: ${new Date().toLocaleDateString()}

1. SPEEDY TRIAL: ${d.waived?`I waived time${d.waived_on?" on "+d.waived_on:""}${d.waiver_end?", limited to "+d.waiver_end:" (general)"}.${d.withdrawn?" I withdrew the waiver on "+d.withdrawn+".":""}`:"I have NOT waived time. Do not waive time for me without talking to me first."}

2. URGENT DEADLINES:
${L.map(it=>`- ${it.title}: ${it.due?("due "+it.due+" ("+(left(it.due)<0?"OVERDUE":left(it.due)+" days left")+")"):"clock stopped (time waived)"} — ${it.why}`).join("\n")||"- (none entered)"}

3. WHAT I'M WAITING ON FROM MY ATTORNEY:
${asks.map(r=>`- ${r.what} (asked ${r.asked||""})`).join("\n")||"- (none)"}

4. MY DECISIONS: Plea offers, testifying, and jury or no jury are my decisions. Tell me about every offer in writing.

ATTORNEY ACKNOWLEDGMENT: I have read this page and the deadlines above.
Attorney name: ______________________  Signature: ______________________  Date: __________`; }
CC.firstDoc = () => ({id:"tk-first", title:"Read this first — me and my attorney", kind:"sign", what:"One page with your speedy-trial status, urgent deadlines and open requests, with a line for your attorney to sign that they read it.", body:firstHTML()});

/* Signed PDF (drawn signature) + one-tap send to the attorney. */
let jsPDFp = null;
const loadPDF = () => jsPDFp ||= new Promise((res,rej)=>{ const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"; s.onload = () => res(window.jspdf.jsPDF); s.onerror = rej; document.head.appendChild(s); });
async function signedPDF(title, body, sigImg, name, when){
  const J = await loadPDF(), doc = new J({unit:"pt", format:"letter"}), W = 612, M = 54; let y = M;
  doc.setFont("helvetica","bold"); doc.setFontSize(15); doc.text(title, M, y); y += 24; doc.setFont("helvetica","normal"); doc.setFontSize(11);
  for (const line of doc.splitTextToSize(body, W-2*M)){ if (y > 700){ doc.addPage(); y = M; } doc.text(line, M, y); y += 15; }
  if (y > 640){ doc.addPage(); y = M; } y += 10; doc.addImage(sigImg, "PNG", M, y, 180, 60); y += 66; doc.line(M, y, M+260, y); y += 14;
  doc.setFontSize(9); doc.text(`${name} — signed electronically ${when}`, M, y); y += 24;
  doc.setTextColor(110); doc.text("Created with Court Companion. Information and organization only — not legal advice.", M, 760);
  return new File([doc.output("blob")], title.replace(/[^\w\- ]+/g,"").slice(0,60)+".pdf", {type:"application/pdf"}); }
function attorney(){ const c = [...(CC.profile.contacts||[]), ...((window.CCtk?.items("people"))||[])].find(x=>/attorney|pd/.test(x.role||"") && x.email); return c||null; }
CC.signedPDF = async (title, body, img, name, when) => { const f = await signedPDF(title, body, img, name, when); _.download(f.name, f, "application/pdf"); };
CC.sendSigned = async (title, body, img, name, when) => {
  const f = await signedPDF(title, body, img, name, when), a = attorney(), subj = title+" — "+_.caseRef(null);
  if (navigator.canShare && navigator.canShare({files:[f]})){ try{ await navigator.share({files:[f], title:subj, text:(a?`To ${a.name}: `:"")+"Please read and confirm you received this."}); return; }catch(e){ if (e.name==="AbortError") return; } }
  _.download(f.name, f, "application/pdf");
  modal(`<h3>${icon("doc")}Send to your attorney</h3><p class="small">The signed PDF was saved. Your email will open — attach the PDF and send.</p><div class="acts"><a class="btn" href="mailto:${esc(a?.email||"")}?subject=${enc(subj)}&body=${enc("Please read the attached and confirm you received it.\n\n"+body.slice(0,1500))}">${icon("doc")}Email ${esc(a?.name||"my attorney")}</a><button class="btn ghost" data-close>Close</button></div>`); };
window.CCdl = {view, wire};
})();
/* ───────── Jails & prisons: every county jail (men's / women's) with the court it feeds, CDCR prisons, federal BOP ───────── */
(function(){
const CC = window.CC, _ = CC._, { $, $$, esc, enc } = _;
let X = null;
async function extra(){ if (X) return X; X = {};
  for (const [k,p] of [["cdcr","data/states/ca/cdcr.json"],["bop","data/federal/ca_bop.json"]]){ try{ X[k] = (CC.inline && CC.inline[p]) || await (await fetch(p)).json(); }catch(e){ X[k] = null; } }
  return X; }
const lk = (u,l) => u ? `<a class="btn ghost small" href="${esc(u)}" target="_blank" rel="noopener">${icon("link")}${esc(l)}</a>` : "";
function jailCard(j, c){ const courts = (j.court_ids||[]).map(id=>(c.courthouses||[]).find(h=>h.id===id)).filter(Boolean);
  return `<div class="card flat" style="padding:10px"><b>${esc(j.name)}</b> <span class="chip ${j.houses==="women"?"attorney":""}">${esc({men:"Men",women:"Women",both:"Men & women",juvenile:"Juvenile"}[j.houses]||"—")}</span>
   <div class="small">${esc([j.address,j.city,j.zip].filter(Boolean).join(", "))}</div>
   ${courts.length?`<div class="small"><b>Goes to court at:</b> ${courts.map(h=>esc(h.name)+(h.address?" — "+esc(h.address+", "+(h.city||"")):"")).join("; ")}${j.court_note?" ("+esc(j.court_note)+")":""}</div>`:""}
   <div class="acts" style="margin-top:6px">${_.actBtns({phone:j.phone, address:[j.address,j.city].filter(Boolean).join(", "), sms:false})}${lk(j.visiting_url,"Visiting")}${lk(j.commissary_or_money_url,"Send money")}${lk(j.url||j.source_url,"Official page")}</div></div>`; }
function view(){ const C = CC.data.counties||{}, sel = CC.jCounty || CC.profile.home?.county || Object.keys(C)[0], who = CC.jWho || "all";
  const c = C[sel]||{}; const J = (c.jails||[]).filter(j=>who==="all"||j.houses===who||j.houses==="both");
  return `<p class="small">Find where someone is held, how to visit or send money, and which courthouse they'll be taken to. Always confirm with the official inmate locator first.</p>
   <div class="fgrid two"><div><label for="jc">County</label><select id="jc">${Object.entries(C).sort((a,b)=>(a[1].county||a[0]).localeCompare(b[1].county||b[0])).map(([id,x])=>`<option value="${esc(id)}" ${id===sel?"selected":""}>${esc(x.county||id)}</option>`).join("")}</select></div>
   <div><label for="jw">Housing</label><select id="jw">${[["all","All"],["men","Men"],["women","Women"],["juvenile","Juvenile"]].map(([k,l])=>`<option value="${k}" ${who===k?"selected":""}>${l}</option>`).join("")}</select></div></div>
   <div class="acts" style="margin:10px 0">${lk(c.inmate_lookup_url,"County inmate locator (official)")}</div>
   ${J.map(j=>jailCard(j,c)).join("")||`<p class="small muted">No facilities listed for this county yet.</p>`}
   <div id="jx"><p class="small muted">Loading state and federal prisons…</p></div>`; }
async function wire(v){
  $("#jc",v).onchange = e => { CC.jCounty = e.target.value; CC.render(); };
  $("#jw",v).onchange = e => { CC.jWho = e.target.value; CC.render(); };
  const x = await extra(), box = $("#jx",v); if (!box) return; let h = "";
  if (x.cdcr){ const I = (x.cdcr.institutions||[]).filter(i=>CC.jWho!=="men"&&CC.jWho!=="women"||i.houses===CC.jWho);
    h += `<h3 style="margin-top:16px">${icon("courthouse")}California state prisons (CDCR)</h3><div class="acts">${lk(x.cdcr.inmate_locator_url,"CDCR inmate locator")}${lk(x.cdcr.visiting_info_url,"Visiting rules")}${lk(x.cdcr.sending_money_url,"Sending money")}${lk(x.cdcr.family_resources_url,"Family resources")}</div>
     ${I.map(i=>`<details class="card flat" style="padding:10px"><summary><b>${esc(i.name)}</b> <span class="small">(${esc(i.acronym||"")}) · ${esc(i.city||"")}</span> <span class="chip ${i.houses==="women"?"attorney":""}">${esc(i.houses==="women"?"Women":"Men")}</span>${i.reception_center?' <span class="chip">Reception center</span>':""}</summary>
       <div class="small" style="margin-top:6px">${esc([i.address,i.city,i.zip].filter(Boolean).join(", "))}${i.local_court?"<br><b>Local court:</b> "+esc(i.local_court):""}${i.note?"<br>"+esc(i.note):""}</div>
       <div class="acts" style="margin-top:6px">${_.actBtns({phone:i.phone, address:[i.address,i.city].filter(Boolean).join(", "), sms:false})}${lk(i.visiting_url,"Visiting")}${lk(i.url,"Official page")}</div></details>`).join("")}`; }
  if (x.bop){ h += `<h3 style="margin-top:16px">${icon("courthouse")}Federal prisons in California (BOP)</h3><div class="acts">${lk(x.bop.inmate_locator_url,"BOP inmate locator")}</div>
     ${(x.bop.facilities||x.bop.institutions||[]).map(i=>`<div class="card flat" style="padding:10px"><b>${esc(i.name)}</b> <span class="small">${esc(i.status||"")}</span><div class="small">${esc([i.address,i.city,i.zip].filter(Boolean).join(", "))}</div><div class="acts" style="margin-top:6px">${_.actBtns({phone:i.phone, sms:false})}${lk(i.url,"Official page")}</div></div>`).join("")}`; }
  box.innerHTML = h || "";
}
window.CCjails = {view, wire};
})();
/* ───────── First court date: what your lawyer (public defender or private) is supposed to do, shareable to family;
   and what "ineffective assistance of counsel" really means. Information, not legal advice. ───────── */
(function(){
const CC = window.CC, _ = CC._, { $, $$, esc, enc, modal, toast } = _;
const DUTIES = [
 ["talk","Talk with me before or at the first court date and explain the charges and what I'm facing.","Cal. Rules of Professional Conduct, rule 1.4 (duty to communicate); Bus. & Prof. Code § 6068(m).","An ethics violation you can report to the State Bar, and a reason to ask for a Marsden hearing. It becomes ineffective assistance only if it hurt the result (Strickland)."],
 ["plea","Enter a NOT GUILTY plea unless I decide otherwise. The plea is my decision.","Cal. Rules of Prof. Conduct, rule 1.2(a); McCoy v. Louisiana, 584 U.S. 414 (2018).","A lawyer who pleads for you or concedes guilt over your objection violates your Sixth Amendment rights (McCoy) — that error doesn't require showing prejudice."],
 ["release","Ask for my release or lower bail, and tell the judge what I can afford.","In re Humphrey (2021) 11 Cal.5th 135 (ability to pay); federal: 18 U.S.C. § 3142(f) detention hearing.","Ask your lawyer on the record to request a bail review. Not arguing release when there's a basis can be raised with the court."],
 ["time","Ask me before waiving time. Don't waive my speedy-trial rights without explaining it to me.","Penal Code § 1382; federal: 18 U.S.C. § 3161. (In California a court may allow counsel to waive time over objection for the client's benefit — Townsend v. Superior Court (1975) 15 Cal.3d 774.)","If you don't want to waive time, say \"I object, I do not waive time\" in court yourself so it's on the record."],
 ["discovery","Request the discovery (police reports, video, evidence) and show it to me.","Penal Code § 1054.1 and § 1054.5(b); Brady v. Maryland, 373 U.S. 83 (1963); federal: Fed. R. Crim. P. 16.","Failing to get and review the evidence can be deficient performance under Strickland if it affected the outcome."],
 ["investigate","Investigate my case: witnesses I name for the defense, the scene, video, records.","Strickland v. Washington, 466 U.S. 668 (1984): counsel must make reasonable investigations or make a reasonable decision that one isn't needed.","The most common basis for an ineffective-assistance claim: a failure to investigate that a reasonable lawyer wouldn't make, and that likely changed the result."],
 ["offers","Tell me about every plea offer, in writing if I ask, and the deadline.","Missouri v. Frye, 566 U.S. 134 (2012); Lafler v. Cooper, 566 U.S. 156 (2012).","Not telling you about a formal offer — or giving bad advice that made you reject a good one — is recognized ineffective assistance."],
 ["immigration","If I'm not a U.S. citizen: tell me the immigration consequences of any plea.","Padilla v. Kentucky, 559 U.S. 356 (2010); Penal Code § 1016.3; § 1473.7.","Failing to advise is ineffective assistance, and in California a plea can later be challenged under § 1473.7."],
 ["prelim","Felony in custody: hold the preliminary hearing on time unless I agree to waive.","Penal Code § 859b (10 court days after arraignment/plea, 60 days at most, unless waived).","Missing the deadline without your waiver can lead to dismissal — ask your lawyer to move to dismiss."],
 ["status","Answer my reasonable questions about my case within a reasonable time.","Bus. & Prof. Code § 6068(m); Cal. Rules of Prof. Conduct, rule 1.4.","An ethics violation (State Bar complaint). Keep your Contact log — it's your proof."],
 ["confidential","Keep what I say confidential.","Bus. & Prof. Code § 6068(e); Evidence Code § 954 (attorney-client privilege).","A serious ethics violation; report it to the State Bar and tell the judge."],
 ["file","If I change lawyers: hand over my complete file promptly.","Cal. Rules of Prof. Conduct, rule 1.16(e).","Ethics violation; the new lawyer or the court can order it."],
];
const ST = {done:"Done ✅", not:"NOT done ❌", unk:"Don't know yet ❓"};
const K = () => { try{ return JSON.parse(localStorage.getItem("cc:duty:"+CC.profile.id)||"{}"); }catch(e){ return {}; } };
function text(){ const k = K(), P = CC.profile, nc = (CC.deadlineItems?CC.deadlineItems():[]).filter(x=>x.due).slice(0,1)[0];
  return `${P.person?.name||"My"} — what my lawyer should do after my first court date${(P.cases||[])[0]?" ("+P.cases[0].number+")":""}:\n\n`+
   DUTIES.map(([id,d],i)=>`${i+1}. ${d}\n   Status: ${ST[k[id]]||ST.unk}`).join("\n")+
   `\n\nIf something stays "NOT done", I'll ask my lawyer in writing, and the app explains my options.\nPlease don't discuss my case on jail calls. Don't contact anyone involved in the case.\n(From Court Companion — information, not legal advice.)`; }
function view(){ const k = K(), H = window.CCtk ? window.CCtk.items("helpers") : [];
  const nots = DUTIES.filter(([id])=>k[id]==="not");
  return `<div class="card" style="border-color:var(--gold)"><b>The first to-do list for your lawyer</b><div class="small">After the first court date (arraignment), your lawyer — public defender or private — should be doing these things. Mark each one, then send the list to your family so everyone knows what's supposed to happen.</div></div>
   ${DUTIES.map(([id,d,law,ifnot],i)=>`<div class="card flat" style="padding:10px"><div class="row between"><b>${i+1}. ${esc(d)}</b></div><div class="small muted">${esc(law)}</div>
     <div class="seg" style="margin:8px 0 0">${Object.entries(ST).map(([s,l])=>`<button data-duty="${id}:${s}" class="${k[id]===s?"on":""}">${esc(l)}</button>`).join("")}</div>
     ${k[id]==="not"?`<div class="notice warn" style="margin-top:8px">${icon("alert")}<div class="small"><b>If it isn't done:</b> ${esc(ifnot)}</div></div>`:""}</div>`).join("")}
   ${nots.length?`<div class="notice warn">${icon("alert")}<div><b>${nots.length} not done.</b> Step 1: ask your lawyer in writing (My lawyer → Letters → "Please call me"). Step 2: log it in My requests. Step 3: read "Ineffective assistance — what it means" below before anything else.</div></div>`:""}
   <div class="card"><h3>${icon("users")}Send this to my family</h3><div class="acts">
     <button class="btn" id="du-share">${icon("link")}Share…</button><button class="btn ghost" id="du-copy">${icon("doc")}Copy text</button>
     ${H.filter(h=>h.phone).map(h=>`<a class="btn ghost" href="sms:${esc(_.digits(h.phone))}?&body=${enc(text())}">${icon("phone")}Text ${esc(h.name)}</a>`).join("")}</div>
     ${H.some(h=>h.phone)?"":`<p class="small muted">Add family in Emergency plan → My helpers to get one-tap text buttons.</p>`}</div>
   ${iac()}`; }
function iac(){ return `<div class="card"><h3>${icon("scales")}Ineffective assistance of counsel — what it means</h3>
  <p class="small">You have a right to a lawyer who actually does the job (Sixth Amendment). When a lawyer's work falls below that standard and it hurts your case, that's called <b>ineffective assistance of counsel</b>.</p>
  <p class="small"><b>The test (Strickland v. Washington, 466 U.S. 668 (1984)) has two parts — you need both:</b></p>
  <ol class="small" style="padding-left:18px"><li><b>Deficient performance:</b> the lawyer did something (or failed to do something) no reasonable lawyer would do. Courts give lawyers a lot of room for <i>strategy</i> — a choice you disagree with isn't automatically ineffective.</li>
   <li><b>Prejudice:</b> there's a reasonable probability the result would have been different without the mistake.</li></ol>
  <p class="small"><b>Exceptions where harm is presumed:</b> no lawyer at a critical stage, or a lawyer who completely fails to test the prosecution's case (United States v. Cronic, 466 U.S. 648 (1984)); a lawyer admitting your guilt over your objection (McCoy v. Louisiana).</p>
  <p class="small"><b>Recognized examples:</b> not telling you about a plea offer (Frye); bad advice that made you reject a good offer (Lafler); not warning a non-citizen about deportation (Padilla); failing to investigate a defense (Strickland, Wiggins v. Smith, 539 U.S. 510 (2003)).</p>
  <p class="small"><b>Not the same thing:</b> breaking an <i>ethics rule</i> (not returning calls, not keeping you informed) is reported to the State Bar. It's ineffective assistance only when it hurt the outcome.</p>
  <p class="small"><b>What you can do, in order:</b></p>
  <ol class="small" style="padding-left:18px"><li>Ask in writing and keep proof (Letters, Contact log, My requests).</li><li>Appointed lawyer in California: ask the judge for a <b>Marsden hearing</b> to replace them (People v. Marsden (1970) 2 Cal.3d 118). Federal: ask the court for new counsel.</li>
   <li>Ethics problems: file a complaint with the State Bar of California.</li><li>After a conviction: ineffective assistance is usually raised in a motion for new trial, on appeal, or in a habeas corpus petition — deadlines are strict.</li><li>Or decide to represent yourself (see Pro per).</li></ol>
  <div class="acts">${_.searchBtns("Strickland v. Washington ineffective assistance",["cl","scholar"])}<a class="btn ghost small" href="https://www.calbar.ca.gov/" target="_blank" rel="noopener">${icon("link")}State Bar of California</a></div>
  <p class="small muted">General information, not legal advice about your case.</p></div>`; }
function wire(v){
  $$("[data-duty]",v).forEach(b=>b.onclick=()=>{ const [id,s] = b.dataset.duty.split(":"); const k = K(); k[id] = s; try{ localStorage.setItem("cc:duty:"+CC.profile.id, JSON.stringify(k)); }catch(e){} CC.render(); });
  $("#du-copy",v).onclick = async () => { try{ await navigator.clipboard.writeText(text()); toast("Copied — paste it into a text."); }catch(e){ modal(`<textarea style="min-height:240px">${esc(text())}</textarea><button class="btn" data-close>Close</button>`); } };
  $("#du-share",v).onclick = async () => { if (navigator.share){ try{ await navigator.share({title:"My lawyer's to-do list", text:text()}); return; }catch(e){ if (e.name==="AbortError") return; } } location.href = "sms:?&body="+enc(text()); };
}
window.CCduty = {view, wire, text};
})();
