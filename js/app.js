/* Court Companion v1 — static, offline-first. Information and reminders only; never legal advice.
   Boot: CC.start(profile, inlineData?) — the demo loader fetches JSON; the private build passes decrypted data. */
(function(){
"use strict";
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2,"0");
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const KINDS = {
  court:{label:"Court date",icon:"gavel"}, attorney:{label:"Attorney meeting",icon:"scales"},
  probation:{label:"Probation / pretrial check-in",icon:"clip"}, pars:{label:"PARS / pretrial supervision",icon:"clip"},
  monitor:{label:"Ankle monitor / GPS",icon:"battery"}, drugtest:{label:"Drug test",icon:"flask"},
  class:{label:"Class / program",icon:"cap"}, service:{label:"Community service",icon:"hands"},
  fee:{label:"Fee / payment",icon:"dollar"}, deadline:{label:"Filing deadline",icon:"flag"}, other:{label:"Other task",icon:"check"}
};
const DEFAULT_REMIND = {court:[1440,120], attorney:[1440,60], probation:[1440,60], pars:[1440,60], monitor:[0], drugtest:[0], class:[1440,60], service:[60], fee:[4320,1440], deadline:[10080,4320,1440], other:[60]};
const REMIND_OPTS = [[10080,"1 week before"],[4320,"3 days before"],[1440,"Day before"],[120,"2 hours before"],[60,"1 hour before"],[0,"At the time"]];

const CC = window.CC = { data:{state:null, counties:{}, federal:null, guard:null, guides:null}, profile:null, inline:null, role:"client", attyOpen:false, mstat:{} };
let S = {}; // per-device store
let KEY = "cc:v1";

/* ───────── data ───────── */
async function J(path){
  if (CC.inline && CC.inline[path] !== undefined) return CC.inline[path];
  const r = await fetch(path, {cache:"no-cache"}); if (!r.ok) throw new Error(path+" "+r.status); return r.json();
}
function load(){ try{ S = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; }catch(e){ S = {}; } S.events ||= []; S.contacts ||= []; S.nocontact ||= []; S.done ||= {}; S.questions ||= []; S.fired ||= {}; S.notes ||= []; }
function save(){ if (CC.profile.persist === false){ const slim={done:S.done,fired:S.fired,pick:S.pick,role:S.role,seenDisclaimer:S.seenDisclaimer,consent:S.consent}; try{localStorage.setItem(KEY, JSON.stringify(slim))}catch(e){} return; }
  try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){} }
const uid = () => Math.random().toString(36).slice(2,10);

/* ───────── guardrails (no-contact screen; reuses the Family Clerk rules) ───────── */
let GUARD = {names:[], topics:[], creds:/\b(pass\s?words?|passcodes?|log-?ins?|contraseñas?|pin numbers?)\b/i};
function buildGuard(){
  const g = CC.data.guard || {topic_patterns:[]};
  const terms = [...(CC.profile.nocontact||[]), ...S.nocontact].filter(t => t && t.trim());
  GUARD.names = terms.map(t => new RegExp("(?<![A-Za-z])"+t.trim().replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"(?![A-Za-z])","i"));
  GUARD.topics = (g.topic_patterns||[]).map(p => new RegExp(p,"i"));
}
function screen(text){
  text = text || "";
  if (GUARD.names.some(r => r.test(text))) return "blocked_person";
  if (GUARD.topics.some(r => r.test(text))) return "witness_topic";
  if (GUARD.creds.test(text)) return "credentials";
  return null;
}
function guardMsg(cat){
  if (cat === "credentials") return "Don't store passwords or account logins here. Share those in person.";
  return "Court Companion can't create reminders, contacts or messages that involve a witness, an alleged victim, or anyone you've been ordered not to contact — and it never relays messages to them. Contact like that can lead to new charges or loss of release. Take any question about them to your attorney.";
}
function guardOK(...texts){ for (const t of texts){ const c = screen(t); if (c){ modal(`<h3>${icon("ban")} Not allowed here</h3><p>${esc(guardMsg(c))}</p><div class="row"><button class="btn" data-close>OK</button></div>`); return false; } } return true; }

/* ───────── dates ───────── */
const today = () => { const d=new Date(); d.setHours(0,0,0,0); return d; };
const parseD = (s, t) => { const [y,m,d] = s.split("-").map(Number); const [hh,mm] = (t||"00:00").split(":").map(Number); return new Date(y, m-1, d, hh, mm); };
const ymd = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
function fmtTime(t){ if(!t) return "All day"; let [h,m]=t.split(":").map(Number); const ap=h>=12?"PM":"AM"; h=h%12||12; return h+":"+pad(m)+" "+ap; }
function fmtLong(s,t){ const d=parseD(s,t); return DOW[d.getDay()]+", "+MON[d.getMonth()]+" "+d.getDate()+", "+d.getFullYear()+(t?" · "+fmtTime(t):""); }
function daysUntil(s){ return Math.round((parseD(s) - today())/864e5); }
function allEvents(){ return [...(CC.profile.events||[]), ...S.events]; }
function occurrences(from, days){
  const out = [], end = new Date(from.getTime()+days*864e5);
  for (const e of allEvents()){
    if (!e.date) continue;
    let d = parseD(e.date), until = e.until ? parseD(e.until) : end, n=0;
    const step = e.repeat || "none";
    while (d <= end && d <= until && n < 400){
      if (d >= from) out.push({...e, date: ymd(d), _key: e.id+"@"+ymd(d)});
      if (step === "none") break;
      if (step === "daily") d = new Date(d.getFullYear(), d.getMonth(), d.getDate()+1);
      else if (step === "weekly") d = new Date(d.getFullYear(), d.getMonth(), d.getDate()+7);
      else if (step === "monthly") d = new Date(d.getFullYear(), d.getMonth()+1, d.getDate());
      else break; n++;
    }
  }
  return out.sort((a,b) => (a.date+(a.time||"99")).localeCompare(b.date+(b.time||"99")));
}
function nextCourt(){ return occurrences(today(), 400).find(e => e.kind === "court"); }

/* ───────── lookup ───────── */
function countyData(id){ return id === "federal-cacd" ? CC.data.federal : CC.data.counties[id]; }
function courthouse(countyId, chId){ const c = countyData(countyId); return c && (c.courthouses||[]).find(h => h.id === chId); }
function placeLine(e){
  const ch = e.county && e.courthouse ? courthouse(e.county, e.courthouse) : null;
  const parts = [];
  if (e.dept) parts.push(/^dept|^court|^room/i.test(e.dept) ? e.dept : "Dept "+e.dept);
  if (ch) parts.push(ch.name);
  else if (e.where) parts.push(e.where);
  return parts.join(" · ");
}
function addrOf(h){ return [h.address, h.city ? h.city+", CA "+(h.zip||"") : ""].filter(Boolean).join(", "); }
const mapsUrl = a => "https://maps.apple.com/?q="+encodeURIComponent(a);
const tel = p => p ? `<a href="tel:${esc(String(p).replace(/[^\d+]/g,""))}">${esc(p)}</a>` : "";
const digits = p => String(p||"").replace(/[^\d+]/g,"");
const enc = encodeURIComponent;
/* Tap-to-act buttons for any person or office: call, text, email (subject pre-filled with the case number), map, website. */
function caseRef(c){ const ks = CC.profile?.cases||[]; const k = (c && c.caseId && ks.find(x=>x.id===c.caseId)) || (ks.length===1 ? ks[0] : null);
  return k ? "Re: "+k.number : (ks.length ? "Re: "+ks.map(x=>x.number).join(" / ") : "Re: my case"); }
function actBtns(c){
  const b = [];
  if (c.phone){ b.push(`<a class="btn ghost small" href="tel:${esc(digits(c.phone))}">${icon("phone")}Call ${esc(c.phone)}</a>`);
    if (c.sms !== false) b.push(`<a class="btn ghost small" href="sms:${esc(digits(c.phone))}">${icon("doc")}Text</a>`); }
  for (const p of (c.phones||[])) b.push(`<a class="btn ghost small" href="tel:${esc(digits(p.phone))}">${icon("phone")}${esc(p.label||"Call")} ${esc(p.phone)}</a>`);
  if (c.email) b.push(`<a class="btn ghost small" href="mailto:${esc(c.email)}?subject=${enc(caseRef(c))}">${icon("doc")}Email</a>`);
  if (c.address) b.push(`<a class="btn ghost small" href="${mapsUrl(c.address)}" target="_blank" rel="noopener">${icon("pin")}Map</a>`);
  if (c.url) b.push(`<a class="btn ghost small" href="${esc(c.url)}" target="_blank" rel="noopener">${icon("link")}Website</a>`);
  return b.join("");
}
/* "Search it yourself": public sources pre-filled with a citation, statute or case number. */
const SEARCH = {
  cl: q => "https://www.courtlistener.com/?type=o&q="+enc(q),
  clDocket: q => "https://www.courtlistener.com/?type=r&q="+enc(q),
  scholar: q => "https://scholar.google.com/scholar?hl=en&as_sdt=4,5&q="+enc(q),
  justia: q => "https://law.justia.com/search?q="+enc(q),
};
function searchBtns(q, kinds){ return (kinds||["cl","scholar"]).map(k=>{ const L={cl:"CourtListener",clDocket:"CourtListener dockets",scholar:"Google Scholar",justia:"Justia"}[k];
  return `<a class="btn ghost small" href="${esc(SEARCH[k](q))}" target="_blank" rel="noopener">${icon("search")}${L}</a>`; }).join(""); }

/* ───────── ICS export ───────── */
function icsEsc(s){ return String(s||"").replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/([,;])/g,"\\$1"); }
function icsFold(line){ const out=[]; while (line.length > 73){ out.push(line.slice(0,73)); line=" "+line.slice(73); } out.push(line); return out.join("\r\n"); }
const VTZ = ["BEGIN:VTIMEZONE","TZID:America/Los_Angeles","BEGIN:DAYLIGHT","TZOFFSETFROM:-0800","TZOFFSETTO:-0700","TZNAME:PDT","DTSTART:19700308T020000","RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU","END:DAYLIGHT","BEGIN:STANDARD","TZOFFSETFROM:-0700","TZOFFSETTO:-0800","TZNAME:PST","DTSTART:19701101T020000","RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU","END:STANDARD","END:VTIMEZONE"];
function buildICS(events){
  const now = new Date(), stamp = now.toISOString().replace(/[-:]/g,"").replace(/\.\d+/,"");
  const L = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Court Companion//v1//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:Court Companion", ...VTZ];
  for (const e of events){
    const d = e.date.replace(/-/g,"");
    L.push("BEGIN:VEVENT","UID:"+e.id+"@court-companion","DTSTAMP:"+stamp);
    if (e.time){ const t = e.time.replace(":","")+"00"; L.push("DTSTART;TZID=America/Los_Angeles:"+d+"T"+t);
      const end = parseD(e.date,e.time); end.setMinutes(end.getMinutes()+(e.kind==="monitor"?(e.minutes||60):60));
      L.push("DTEND;TZID=America/Los_Angeles:"+ymd(end).replace(/-/g,"")+"T"+pad(end.getHours())+pad(end.getMinutes())+"00"); }
    else { const n = parseD(e.date); n.setDate(n.getDate()+1); L.push("DTSTART;VALUE=DATE:"+d, "DTEND;VALUE=DATE:"+ymd(n).replace(/-/g,"")); }
    if (e.repeat && e.repeat !== "none") L.push("RRULE:FREQ="+e.repeat.toUpperCase()+(e.until?";UNTIL="+e.until.replace(/-/g,"")+"T235959Z":""));
    L.push(icsFold("SUMMARY:"+icsEsc(e.title)));
    const where = placeLine(e), ch = e.county && e.courthouse ? courthouse(e.county,e.courthouse) : null;
    if (where || ch) L.push(icsFold("LOCATION:"+icsEsc([where, ch ? addrOf(ch) : ""].filter(Boolean).join(" — "))));
    L.push(icsFold("DESCRIPTION:"+icsEsc([(e.caseLabel||""), "Reminder from Court Companion. Information only, not legal advice. Confirm dates with the court or your attorney."].filter(Boolean).join("\n"))));
    for (const m of (e.remind || DEFAULT_REMIND[e.kind] || [60])) L.push("BEGIN:VALARM","ACTION:DISPLAY",icsFold("DESCRIPTION:"+icsEsc(e.title)),"TRIGGER:-PT"+m+"M","END:VALARM");
    L.push("END:VEVENT");
  }
  L.push("END:VCALENDAR"); return L.join("\r\n")+"\r\n";
}
function download(name, text, type){ const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove()}, 500); }
CC.exportICS = (ids) => { const evs = allEvents().filter(e => !ids || ids.includes(e.id)); download(ids && ids.length===1 ? "court-companion-"+evs[0].date+".ics" : "court-companion-all.ics", buildICS(evs), "text/calendar"); toast("Calendar file downloaded — open it to add the reminders."); };
CC.buildICS = buildICS;

/* ───────── browser notifications + SMS/Telegram hook (outbox only; nothing is sent) ───────── */
function alertsDue(hours){
  const now = Date.now(), until = now + hours*36e5, out = [];
  for (const o of occurrences(new Date(now - 864e5), Math.ceil(hours/24)+3)){
    for (const m of (o.remind || DEFAULT_REMIND[o.kind] || [60])){
      const at = parseD(o.date, o.time || "08:00").getTime() - m*6e4;
      if (at >= now - 6e4 && at <= until) out.push({key:o._key+"#"+m, at, event:o, lead:m});
    }
  }
  return out.sort((a,b)=>a.at-b.at);
}
function alertText(a){ const e=a.event; return (a.lead? (a.lead>=1440? "Tomorrow" : "In "+(a.lead>=60? a.lead/60+" hr" : a.lead+" min")) : "Now")+": "+e.title+(e.time?" at "+fmtTime(e.time):"")+(placeLine(e)?" — "+placeLine(e):""); }
async function notify(title, body){
  try{ const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) return reg.showNotification(title, {body, icon:"icons/icon-192.png", badge:"icons/icon-192.png"}); }catch(e){}
  try{ new Notification(title, {body}); }catch(e){}
}
const timers = [];
function scheduleAlerts(){
  timers.splice(0).forEach(clearTimeout);
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  for (const a of alertsDue(36)){ if (S.fired[a.key]) continue;
    timers.push(setTimeout(() => { S.fired[a.key]=1; save(); notify(CC.brand.name, alertText(a)); }, Math.max(0, a.at - Date.now()))); }
}
CC.outbox = (hours=72) => alertsDue(hours).map(a => ({channel:"sms|telegram", send_at:new Date(a.at).toISOString(), text:alertText(a)+". Reply STOP to opt out. Info only, not legal advice.", event_id:a.event.id}));

/* ───────── UI helpers ───────── */
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true, 3200); }
function modal(html){ const m=$("#modal"); $(".sheet",m).innerHTML=html; m.hidden=false; $$("[data-close]",m).forEach(b=>b.onclick=()=>m.hidden=true); m.onclick=e=>{ if(e.target===m) m.hidden=true; }; return m; }
function chip(kind){ const k=KINDS[kind]||KINDS.other; return `<span class="chip ${esc(kind)}">${icon(k.icon)}${esc(k.label.split(" /")[0])}</span>`; }
function whenBox(o){ const d=parseD(o.date); return `<div class="when"><div class="m">${MON[d.getMonth()]}</div><div class="d">${d.getDate()}</div><div class="t">${o.time?fmtTime(o.time):DOW[d.getDay()]}</div></div>`; }
function itemRow(o, opts={}){
  const done = !!S.done[o._key];
  return `<li class="item ${done?"done":""}">${whenBox(o)}<div class="body"><b>${esc(o.title)}</b>
    <div class="small">${esc(placeLine(o))}${o.caseLabel? " · "+esc(o.caseLabel):""}${o.repeat&&o.repeat!=="none"?" · repeats "+esc(o.repeat):""}</div>
    <div class="row" style="margin-top:6px;gap:6px">${chip(o.kind)}${o.sample?'<span class="chip sample">Sample</span>':""}
    ${opts.actions!==false?`<button class="btn ghost small" data-done="${esc(o._key)}">${icon("check")}${done?"Undo":"Done"}</button><button class="btn ghost small" data-ics="${esc(o.id)}">${icon("calendar")}.ics</button>${o.mine?`<button class="btn ghost small" data-del="${esc(o.id)}" aria-label="Delete">${icon("x")}</button>`:""}`:""}</div>
    ${o.notes && CC.role!=="family"?`<div class="small" style="margin-top:6px">${esc(o.notes)}</div>`:""}</div></li>`;
}
function wireItems(root){
  $$("[data-done]",root).forEach(b=>b.onclick=()=>{ const k=b.dataset.done; S.done[k]=!S.done[k]; save(); render(); });
  $$("[data-ics]",root).forEach(b=>b.onclick=()=>CC.exportICS([b.dataset.ics]));
  $$("[data-del]",root).forEach(b=>b.onclick=()=>{ S.events=S.events.filter(e=>e.id!==b.dataset.del); save(); scheduleAlerts(); render(); toast("Reminder removed."); });
}
function srcLine(o){ if(!o) return ""; const u=o.source_url||o.url; return u||o.verified_on ? `<div class="src">Source: ${u?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\//,"").slice(0,60))}</a>`:"—"}${o.verified_on?" · verified "+esc(o.verified_on):" · not yet verified"}</div>` : ""; }

/* ───────── views ───────── */
const VIEWS = {};
VIEWS.home = () => {
  const nc = nextCourt(), seen = new Set(), occ = occurrences(today(), 7).filter(o=>{ if (S.done[o._key] || seen.has(o.id)) return false; seen.add(o.id); return true; }).slice(0,8);
  const P = CC.profile;
  let hero = `<div class="hero"><svg class="bg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">${ICONS.courthouse}</svg>`;
  if (nc){ const n=daysUntil(nc.date), ch = nc.county&&nc.courthouse?courthouse(nc.county,nc.courthouse):null;
    hero += `<div class="eyebrow">Next court date</div><div class="row" style="align-items:flex-end;gap:14px"><div class="big">${n===0?"Today":n===1?"1 day":n+" days"}</div></div>
      <h2 style="margin-top:8px">${esc(nc.title)}</h2><div class="meta">${esc(fmtLong(nc.date,nc.time))}<br>${esc(placeLine(nc))}${ch?"<br>"+esc(addrOf(ch)):""}</div>
      <div class="row" style="margin-top:12px"><button class="btn gold small" data-ics="${esc(nc.id)}">${icon("calendar")}Add to calendar</button>${ch?`<a class="btn small" style="background:transparent;border-color:rgba(255,255,255,.4)" href="${mapsUrl(addrOf(ch))}" target="_blank" rel="noopener">${icon("pin")}Directions</a>`:""}</div>`;
  } else hero += `<div class="eyebrow">Next court date</div><h2>No court date saved yet</h2><a class="btn gold small" href="#court">Find your courthouse</a>`;
  hero += `</div>`;
  const mon = P.monitor && P.monitor.enabled ? `<div class="card flat"><h3>${icon("battery")}Ankle monitor</h3><p class="small">Charging reminders at ${(P.monitor.charge_times||[]).map(fmtTime).join(" and ")} for ${P.monitor.minutes||60} min. ${esc(P.monitor.vendor_note||"")}</p><p class="small">Court Companion never tracks your location. It only reminds you to charge and keeps the officer's number handy.</p></div>` : "";
  return `${P.sample?`<div class="notice warn">${icon("info")}<div><b>Sample data.</b> Jordan Reyes and every case number here are fictional and marked SAMPLE.</div></div>
  <div class="card" style="border-color:var(--gold)"><div class="row between"><div><b>Ready to use it for your own case?</b><div class="small">Court dates, your lawyer's to-do list, your transcripts (searchable), evidence tracker, case-law research and a pro per guide. Saved only on your phone.</div></div><button class="btn gold" onclick="CC.intake()">${icon("plus")}Set up my case</button></div></div>`:""}
  ${hero}
  <div class="notice navy">${icon("ear")}<div><b>Jail calls are recorded.</b> Every jail phone call, video visit and tablet message is recorded or read, except legal calls with your lawyer. Never discuss the case on them.</div></div>
  <div class="card"><div class="row between"><h3>${icon("bell")}Next 7 days</h3><a class="small" href="#tasks">All reminders →</a></div><p class="small" style="margin:0">Next time each one is due. Daily items repeat — see Reminders for the full schedule.</p>
    ${occ.length?`<ul class="list">${occ.map(o=>itemRow(o)).join("")}</ul>`:`<p class="muted">Nothing in the next week.</p>`}</div>
  <div class="grid two">${mon}
    <div class="card flat"><h3>${icon("shield")}How this app protects you</h3><ul class="small" style="padding-left:18px;margin:0">
      <li>Information and reminders only — never legal advice.</li><li>Won't contact or relay messages to witnesses or alleged victims.</li><li>Your attorney's area is kept separate from the family area.</li><li>Everything stays on this device unless you export it.</li></ul></div></div>`;
};

VIEWS.court = () => {
  const st = CC.data.state, pick = S.pick || {state:"CA", county:CC.profile.home?.county || "", ch:"", dept:""};
  const cty = pick.county ? countyData(pick.county) : null, ch = cty && pick.ch ? (cty.courthouses||[]).find(h=>h.id===pick.ch) : null;
  const deps = ch ? (ch.departments||[]) : [], dep = deps.find(d=>d.id===pick.dept);
  const counties = (st.counties_available||[]).map(id=>[id, CC.data.counties[id]?.county ? CC.data.counties[id].county+" County" : id]);
  const step = (n,on) => `<span class="${on?"on":""}">${n}</span>`;
  let out = `<div class="pagehead">${icon("courthouse","lg")}<div><h1>Find your court</h1><p>State → county → courthouse → department. Your court notice or minute order lists the department.</p></div></div>
  <div class="steps">${step("1 · State",1)}${step("2 · County",pick.county)}${step("3 · Courthouse",pick.ch)}${step("4 · Department",pick.dept)}</div>
  <div class="card"><div class="statecard"><svg viewBox="0 0 100 120" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="${STATE_OUTLINES.CA}"/></svg>
   <div style="flex:1;min-width:0"><label for="p-state" style="margin-top:0">State</label><select id="p-state"><option value="CA">California</option><option disabled>More states coming soon</option></select></div></div>
   <label for="p-county">County or federal court</label><select id="p-county"><option value="">Choose…</option>${counties.map(([id,n])=>`<option value="${esc(id)}" ${pick.county===id?"selected":""}>${esc(n)} — Superior Court</option>`).join("")}<option value="federal-cacd" ${pick.county==="federal-cacd"?"selected":""}>Federal — U.S. District Court, Central District of California</option></select>
   ${cty?`<label for="p-ch">Courthouse</label><select id="p-ch"><option value="">Choose…</option>${(cty.courthouses||[]).filter(h=>h.criminal!==false).map(h=>`<option value="${esc(h.id)}" ${pick.ch===h.id?"selected":""}>${esc(h.name)}${h.city?" — "+esc(h.city):""}</option>`).join("")}</select>`:""}
   ${ch?(deps.length?`<label for="p-dept">Department / courtroom</label><select id="p-dept"><option value="">Choose…</option>${deps.map(d=>`<option value="${esc(d.id)}" ${pick.dept===d.id?"selected":""}>${esc(d.label||d.id)}${d.type?" — "+esc(d.type):""}</option>`).join("")}</select>`
      :`<label for="p-dept-t">Department / courtroom</label><input id="p-dept-t" placeholder="As printed on your notice, e.g. C57" value="${esc(pick.dept||"")}">`):""}
  </div>`;
  if (ch){
    const a = addrOf(ch);
    out += `<div class="card"><div class="eyebrow">${esc(cty.court_name||cty.name||"")}</div><h2>${esc(ch.name)}</h2>
     <dl class="kv"><dt>Address</dt><dd><a href="${mapsUrl(a)}" target="_blank" rel="noopener">${esc(a)}</a></dd>
     ${ch.phone?`<dt>Phone</dt><dd>${tel(ch.phone)}</dd>`:""}${ch.hours?`<dt>Hours</dt><dd>${esc(ch.hours)}</dd>`:""}
     ${ch.division?`<dt>Division</dt><dd>${esc(ch.division)}</dd>`:""}${dep?`<dt>Department</dt><dd><b>${esc(dep.label||dep.id)}</b>${dep.type?" — "+esc(dep.type):""}${dep.note?"<br><span class='small'>"+esc(dep.note)+"</span>":""}</dd>`:""}</dl>
     ${ch.note?`<p class="small" style="margin-top:8px">${esc(ch.note)}</p>`:""}${!deps.length&&ch.departments_note?`<p class="small">${esc(ch.departments_note)}</p>`:""}
     ${srcLine(ch)}
     <div class="row" style="margin-top:12px"><button class="btn" id="add-here">${icon("plus")}Add a court date here</button><a class="btn ghost" href="${mapsUrl(a)}" target="_blank" rel="noopener">${icon("pin")}Directions</a></div></div>
     <div class="notice">${icon("info")}<div class="small">Get there 30–45 minutes early for parking and security. Bring photo ID and your court paperwork. Phones silent; no photos or recording inside. Always confirm your date on the court's official case search${cty.case_search_url?`: <a href="${esc(cty.case_search_url)}" target="_blank" rel="noopener">official case search</a>`:cty.case_search?.pacer?`: <a href="${esc(cty.case_search.pacer)}" target="_blank" rel="noopener">PACER</a>`:""}.</div></div>`;
  }
  const mine = occurrences(new Date(today().getTime()-30*864e5), 400).filter(o=>o.kind==="court");
  out += `<div class="card"><div class="row between"><h3>${icon("gavel")}My court dates</h3><button class="btn ghost small" id="ics-court">${icon("download")}All to calendar</button></div>
    ${mine.length?`<ul class="list">${mine.map(o=>itemRow(o)).join("")}</ul>`:`<p class="muted">None yet.</p>`}</div>`;
  return out;
};
VIEWS.court.wire = () => {
  const set = (k,v,reset) => { S.pick = Object.assign(S.pick || {state:"CA", county:CC.profile.home?.county||""}, {[k]:v}); for (const r of reset||[]) S.pick[r]=""; save(); render(); };
  $("#p-county")?.addEventListener("change", e=>set("county", e.target.value, ["ch","dept"]));
  $("#p-ch")?.addEventListener("change", e=>set("ch", e.target.value, ["dept"]));
  $("#p-dept")?.addEventListener("change", e=>set("dept", e.target.value));
  $("#p-dept-t")?.addEventListener("change", e=>set("dept", e.target.value.trim()));
  $("#add-here")?.addEventListener("click", ()=>eventForm({kind:"court", county:S.pick.county, courthouse:S.pick.ch, dept:S.pick.dept}));
  $("#ics-court")?.addEventListener("click", ()=>CC.exportICS(allEvents().filter(e=>e.kind==="court").map(e=>e.id)));
};

const TEMPLATES = [
  {kind:"monitor", title:"Charge ankle monitor", time:"07:00", repeat:"daily", remind:[0], minutes:60},
  {kind:"monitor", title:"Charge ankle monitor (evening)", time:"19:00", repeat:"daily", remind:[0], minutes:60},
  {kind:"drugtest", title:"Call the drug-test line", time:"06:30", repeat:"daily", remind:[0]},
  {kind:"probation", title:"Probation / pretrial check-in", time:"10:00", repeat:"weekly", remind:[1440,60]},
  {kind:"pars", title:"PARS office visit", time:"10:30", repeat:"none", remind:[1440,120,60]},
  {kind:"class", title:"Class session", time:"18:00", repeat:"weekly", remind:[1440,60]},
  {kind:"service", title:"Community service shift", time:"08:00", repeat:"weekly", remind:[1440,60]},
  {kind:"fee", title:"Court fine / fee payment due", time:null, repeat:"monthly", remind:[4320,1440]},
];
VIEWS.tasks = () => {
  const occ = occurrences(new Date(today().getTime()-2*864e5), 45);
  const perm = !("Notification" in window) ? "unsupported" : Notification.permission;
  const groups = {}; for (const o of occ){ (groups[o.date] ||= []).push(o); }
  return `<div class="pagehead">${icon("bell","lg")}<div><h1>Reminders</h1><p>Court, probation and PARS, ankle-monitor charging, drug tests, classes, community service, fees — anything you must not miss.</p></div></div>
  <div class="card"><div class="row between"><h3>${icon("bell")}Alerts on this device</h3><span class="chip ${perm==="granted"?"verified":""}">${perm==="granted"?"On":perm==="denied"?"Blocked in browser settings":perm==="unsupported"?"Not supported":"Off"}</span></div>
    <p class="small">Phone alerts work while the app is open or installed to your home screen. For alerts you can't miss, also add everything to your phone's calendar (.ics) — calendar alarms ring even when the app is closed.</p>
    <div class="row"><button class="btn" id="perm">${icon("bell")}Turn on alerts</button><button class="btn ghost" id="testn">Send a test alert</button><button class="btn ghost" id="ics-all">${icon("download")}Everything to calendar</button></div></div>
  <div class="card"><div class="row between"><h3>${icon("plus")}Add a reminder</h3><button class="btn small" id="newev">${icon("plus")}Custom</button></div>
    <div class="row" style="gap:6px">${TEMPLATES.map((t,i)=>`<button class="btn ghost small" data-tpl="${i}">${icon(KINDS[t.kind].icon)}${esc(t.title)}</button>`).join("")}</div></div>
  <div class="card"><h3>${icon("calendar")}Coming up (45 days)</h3>${Object.keys(groups).length?Object.entries(groups).map(([d,list])=>`<div class="eyebrow" style="margin-top:12px">${esc(fmtLong(d))}${daysUntil(d)===0?" · Today":""}</div><ul class="list">${list.map(o=>itemRow(o)).join("")}</ul>`).join(""):`<p class="muted">Nothing scheduled.</p>`}</div>
  <div class="card flat"><h3>${icon("phone")}Text &amp; Telegram reminders</h3><p class="small">Coming later. This version never sends texts or messages; it only shows what a reminder would say. <a href="#settings">See the outbox preview</a>.</p></div>`;
};
VIEWS.tasks.wire = () => {
  $("#perm").onclick = async () => { if (!("Notification" in window)) return toast("This browser can't show alerts. Use the calendar file instead."); const r = await Notification.requestPermission(); scheduleAlerts(); render(); toast(r==="granted"?"Alerts are on.":"Alerts are off."); };
  $("#testn").onclick = () => { if (!("Notification" in window) || Notification.permission!=="granted") return toast("Turn on alerts first."); notify(CC.brand.name, "Test alert: reminders are working."); };
  $("#ics-all").onclick = () => CC.exportICS();
  $("#newev").onclick = () => eventForm({kind:"other"});
  $$("[data-tpl]").forEach(b=>b.onclick=()=>eventForm({...TEMPLATES[+b.dataset.tpl], date:ymd(today())}));
};

function eventForm(pre){
  const p = Object.assign({kind:"other", title:"", date:ymd(today()), time:"09:00", repeat:"none"}, pre);
  if (!p.title) p.title = p.kind==="court" ? "Court date" : "";
  const rem = p.remind || DEFAULT_REMIND[p.kind];
  const ch = p.county && p.courthouse ? courthouse(p.county,p.courthouse) : null;
  const m = modal(`<h3>${icon("plus")}New reminder</h3>
   <label for="f-kind">Type</label><select id="f-kind">${Object.entries(KINDS).map(([k,v])=>`<option value="${k}" ${p.kind===k?"selected":""}>${esc(v.label)}</option>`).join("")}</select>
   <label for="f-title">What</label><input id="f-title" value="${esc(p.title)}" placeholder="e.g. Pretrial hearing">
   <div class="fgrid two"><div><label for="f-date">Date</label><input id="f-date" type="date" value="${esc(p.date)}"></div><div><label for="f-time">Time (leave blank for all day)</label><input id="f-time" type="time" value="${esc(p.time||"")}"></div></div>
   <div class="fgrid two"><div><label for="f-rep">Repeats</label><select id="f-rep">${["none","daily","weekly","monthly"].map(r=>`<option ${p.repeat===r?"selected":""}>${r}</option>`).join("")}</select></div><div><label for="f-until">Until (optional)</label><input id="f-until" type="date" value="${esc(p.until||"")}"></div></div>
   <label for="f-where">Where</label><input id="f-where" value="${esc(ch?(p.dept?"Dept "+p.dept+", ":"")+ch.name:(p.where||""))}" placeholder="Courthouse, office, or address">
   <label for="f-case">Case (optional)</label><input id="f-case" value="${esc(p.caseLabel||"")}" placeholder="Case number">
   <label>Remind me</label><div class="stack">${REMIND_OPTS.map(([v,l])=>`<label class="check"><input type="checkbox" data-rem="${v}" ${rem.includes(v)?"checked":""}>${l}</label>`).join("")}</div>
   <p class="small" style="margin-top:10px">${icon("ban")} Reminders can't name a witness, an alleged victim, or anyone you're ordered not to contact.</p>
   <div class="row" style="margin-top:12px"><button class="btn" id="f-save">Save reminder</button><button class="btn ghost" data-close>Cancel</button></div>`);
  $("#f-save",m).onclick = () => {
    const e = {id:"u-"+uid(), mine:true, kind:$("#f-kind").value, title:$("#f-title").value.trim(), date:$("#f-date").value, time:$("#f-time").value||null,
      repeat:$("#f-rep").value, until:$("#f-until").value||null, where:$("#f-where").value.trim(), caseLabel:$("#f-case").value.trim(),
      remind:$$("[data-rem]",m).filter(x=>x.checked).map(x=>+x.dataset.rem), minutes:p.minutes};
    if (ch && e.where.endsWith(ch.name)){ e.county=p.county; e.courthouse=p.courthouse; e.dept=p.dept; e.where=""; }
    if (!e.title || !e.date) return toast("Add what and when.");
    if (!guardOK(e.title, e.where, e.caseLabel)) return;
    S.events.push(e); save(); scheduleAlerts(); m.hidden=true; render(); toast("Reminder saved.");
  };
}

VIEWS.directory = () => {
  const pick = S.dirCounty || CC.profile.home?.county || (CC.data.state.counties_available||[])[0];
  const c = countyData(pick) || {}, isFed = pick==="federal-cacd", tab = S.dirTab || "defense", B = CC.brand, st = CC.data.state;
  const ent = (o, extra="") => `<div class="entry"><b>${esc(o.name)}</b>${o.what||o.serves?`<div class="small">${esc([o.what,o.serves].filter(Boolean).join(" · "))}</div>`:""}
    ${o.address?`<div class="small"><a href="${mapsUrl(addrOf(o))}" target="_blank" rel="noopener">${esc(addrOf(o))}</a></div>`:""}${o.hours?`<div class="small">${esc(o.hours)}</div>`:""}${o.summary?`<p class="small" style="margin:4px 0">${esc(o.summary)}</p>`:""}${extra}
    <div class="acts">${actBtns({phone:o.phone, email:o.email, url:o.url, sms:false})}</div>${srcLine(o)}</div>`;
  const sec = (title, arr, empty) => `<div class="card"><h3>${title}</h3>${(arr&&arr.length)?arr.map(o=>ent(o)).join(""):`<p class="muted small">${empty||"Nothing listed yet for this court."}</p>`}</div>`;
  let body = "";
  if (tab==="defense"){
    body = sec(icon("scales")+(isFed?"Federal Public Defender":"Public defender"), c.public_defenders, "Not yet listed.")
      + (isFed && c.cja_panel ? `<div class="card flat"><h3>${icon("users")}CJA panel attorneys</h3><p class="small">${esc(c.cja_panel.what||"")}</p>${c.cja_panel.url?`<a class="btn ghost small" href="${esc(c.cja_panel.url)}" target="_blank" rel="noopener">${icon("link")}Learn more</a>`:""}</div>`:"")
      + `<div class="card flat"><h3>${icon("search")}Check any lawyer's license</h3><p class="small">Every California lawyer's license status and any public discipline is on the State Bar's official site.</p>${(st.statewide_help||[]).filter(h=>/bar/i.test(h.name)).map(h=>`<a class="btn ghost small" style="margin:0 6px 6px 0" href="${esc(h.url)}" target="_blank" rel="noopener">${icon("link")}${esc(h.name)}</a>`).join("")}</div>`;
  } else if (tab==="aid"){
    body = sec(icon("hands")+"Legal aid &amp; pro bono", c.legal_aid, "Not yet listed.") + `<div class="notice">${icon("info")}<div class="small">Most legal-aid groups don't handle criminal defense — the public defender does. Legal aid often helps with record clearing, reentry, housing and benefits.</div></div>`
      + `<div class="card flat"><h3>${icon("book")}Statewide help</h3>${(st.statewide_help||[]).map(h=>ent(h)).join("")}</div>`;
  } else if (tab==="probono"){
    const G = CC.data.guides?.probono || {items:[]};
    body = `<div class="notice">${icon("info")}<div class="small">${esc(G.intro||"")}</div></div>`
      + sec(icon("hands")+"Free and low-cost legal help near this court", c.legal_aid, "Not yet listed for this court.")
      + `<div class="card"><h3>${icon("scales")}Pro bono, referrals &amp; clinics</h3>${G.items.map(o=>ent(o, `<div class="small"><b>Who qualifies:</b> ${esc(o.eligibility||"Ask the program.")}</div>${o.todo?`<div class="small muted">To do: ${esc(o.todo)}</div>`:""}`)).join("")}
        <p class="small" style="margin-top:8px">Information only. Each program decides who it can help.</p></div>`;
  } else if (tab==="supervision"){
    body = sec(icon("clip")+(isFed?"Pretrial services":"Probation &amp; pretrial"), isFed ? [...(c.pretrial||[]), ...(c.probation||[])] : c.probation, "Not yet listed.")
      + `<div class="card flat"><h3>${icon("battery")}Electronic monitoring (any vendor)</h3><ul class="small" style="padding-left:18px;margin:0"><li>Write down your vendor, device ID and the 24-hour monitoring line from your paperwork.</li><li>Charge on a fixed schedule (most devices need about an hour, at least once or twice a day) — set a daily reminder.</li><li>If the strap is loose, damaged, or the device vibrates/beeps, call your officer or the monitoring line right away and note the time.</li><li>Before travel, appointments or schedule changes, get permission from your officer in writing if you can.</li><li>Court Companion never tracks or shares your location.</li></ul>
        <button class="btn ghost small" style="margin-top:10px" data-tplkind="monitor">${icon("plus")}Add charging reminders</button></div>`;
  } else if (tab==="programs"){
    body = `<div class="card"><h3>${icon("cap")}Programs</h3>${(c.programs||[]).length?(c.programs).map(o=>ent(o, `<div style="margin-top:4px"><span class="chip">${esc(o.type||"program")}</span></div>`)).join(""):`<p class="muted small">Not yet listed for this court.</p>`}
      <p class="small" style="margin-top:10px">Whether a program fits your case is a question for your attorney. This list is information only.</p></div>`;
  } else if (tab==="jail"){
    body = sec(icon("lock")+"Custody facilities", c.jails, "Not yet listed.") + `<div class="notice navy">${icon("ear")}<div><b>Jail calls are recorded.</b> Phone calls, video visits, tablet messages and letters are recorded or read — except legal calls and legal mail with your lawyer.</div></div>`;
  } else if (tab==="bail"){
    const bail = st.bail || {}, look = bail.license_lookup_url || c.bail?.doi_lookup_url;
    body = (B.whitelabel ? `<div class="card" style="border-color:var(--brand-gold)"><div class="eyebrow">Your bail agent</div><h2>${esc(B.name)}</h2><p class="small">${esc(B.tagline||"")}</p>
        <dl class="kv"><dt>License</dt><dd>${esc(B.license||"—")}</dd><dt>Phone</dt><dd>${esc(B.phone||"—")}</dd><dt>Hours</dt><dd>${esc(B.hours||"—")}</dd></dl>${B.sample?'<p class="small"><span class="chip sample">Sample</span> Fictional company for demonstration. Not a real bail agent.</p>':""}</div>` : "")
      + `<div class="card"><h3>${icon("search")}Verify any bail agent's license</h3><p class="small">${esc(bail.regulator||"Bail agents in California are licensed by the California Department of Insurance.")}</p>
        <ol class="small" style="padding-left:18px">${(bail.how_to_verify||["Open the Department of Insurance license lookup.","Search the agent's or company's name or license number.","Confirm the license is active and is a bail license."]).map(s=>`<li>${esc(s)}</li>`).join("")}</ol>
        ${look?`<a class="btn" href="${esc(look)}" target="_blank" rel="noopener">${icon("link")}Open the official license lookup</a>`:""}
        ${(bail.consumer_tips||[]).length?`<h4 style="margin-top:14px">Before you sign</h4><ul class="small" style="padding-left:18px">${bail.consumer_tips.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>`:""}
        ${CC.data.guides?.bail?`<h4 style="margin-top:14px">Premium, payments &amp; collateral</h4><ul class="small" style="padding-left:18px">${CC.data.guides.bail.premium.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>
          <h4>If you're cosigning</h4><ul class="small" style="padding-left:18px">${CC.data.guides.bail.cosigner.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>`:""}
        ${bail.complaint_url?`<p class="small">Problem with a bail agent? <a href="${esc(bail.complaint_url)}" target="_blank" rel="noopener">File a complaint with the Department of Insurance</a>${bail.consumer_hotline?" or call "+tel(bail.consumer_hotline):""}.</p>`:""}${srcLine(bail)}</div>`
      + ((bail.verified_listings||[]).length?`<div class="card"><h3>${icon("bond")}Licensed bail agents (license checked)</h3>${bail.verified_listings.map(o=>ent(o, `<div class="small">License ${esc(o.license_no)} · ${esc(o.status)}</div>`)).join("")}<p class="small">Listing is not an endorsement.</p></div>`:"")
      + `<div class="card flat"><h3>${icon("plus")}Your bondsman</h3>${contactList(contactsBy(["bondsman"]))}<p class="small">Save your agent's name, license number and phone so your family can call with one tap.</p><button class="btn ghost small" id="addbond">${icon("plus")}Add bondsman</button></div>`;
  }
  return `<div class="pagehead">${icon("book","lg")}<div><h1>Directory</h1><p>Defense, legal aid, supervision, programs, custody and bail — by county. Official sources, with the date we checked.</p></div></div>
  <label for="d-county" style="margin-top:0">Court</label><select id="d-county" style="margin-bottom:12px">${(st.counties_available||[]).map(id=>`<option value="${esc(id)}" ${pick===id?"selected":""}>${esc((CC.data.counties[id]?.county||id)+" County")}</option>`).join("")}<option value="federal-cacd" ${isFed?"selected":""}>Federal — Central District of California</option></select>
  <div class="seg" role="tablist">${[["defense","Defense"],["aid","Legal aid"],["probono","Pro bono"],["supervision",isFed?"Pretrial":"Probation"],["programs","Programs"],["jail","Custody"],["bail","Bail"]].filter(([k])=>!(isFed&&k==="programs")).map(([k,l])=>`<button data-tab="${k}" class="${tab===k?"on":""}">${l}</button>`).join("")}</div>
  ${body}${isFed&&tab==="jail"&&c.marshals?`<div class="card flat">${ent(c.marshals)}</div>`:""}`;
};
VIEWS.directory.wire = () => {
  $("#d-county").onchange = e => { S.dirCounty = e.target.value; if (S.dirCounty==="federal-cacd" && S.dirTab==="programs") S.dirTab="defense"; save(); render(); };
  $$("[data-tab]").forEach(b=>b.onclick=()=>{ S.dirTab=b.dataset.tab; save(); render(); });
  $$("[data-tplkind]").forEach(b=>b.onclick=()=>eventForm({...TEMPLATES[0], date:ymd(today())}));
  $("#addbond")?.addEventListener("click", ()=>contactForm({role:"bondsman"}));
};

function contactForm(pre){
  const m = modal(`<h3>${icon("users")}Add a contact</h3>
   <label for="c-role">Role</label><select id="c-role">${[["attorney","Defense attorney"],["family","Family / support"],["bondsman","Bail agent"],["probation","Probation / pretrial officer"],["program","Program / class"],["other","Other"]].map(([v,l])=>`<option value="${v}" ${pre.role===v?"selected":""}>${l}</option>`).join("")}</select>
   <label for="c-name">Name</label><input id="c-name"><label for="c-phone">Phone</label><input id="c-phone" type="tel"><label for="c-email">Email (optional)</label><input id="c-email" type="email"><label for="c-addr">Address (optional)</label><input id="c-addr"><label for="c-note">Note (license #, office, hours)</label><input id="c-note">
   <p class="small" style="margin-top:10px">${icon("ban")} Contacts can't include witnesses, alleged victims, or anyone you're ordered not to contact.</p>
   <div class="row" style="margin-top:10px"><button class="btn" id="c-save">Save</button><button class="btn ghost" data-close>Cancel</button></div>`);
  $("#c-save",m).onclick = () => { const c={id:"c-"+uid(), mine:true, role:$("#c-role").value, name:$("#c-name").value.trim(), phone:$("#c-phone").value.trim(), email:$("#c-email").value.trim(), address:$("#c-addr").value.trim(), note:$("#c-note").value.trim()};
    if (!c.name) return toast("Add a name."); if (!guardOK(c.name, c.note, c.email, c.address)) return; S.contacts.push(c); save(); m.hidden=true; render(); toast("Contact saved."); };
}

/* ───────── case: at a glance / family / attorney-only / packet ───────── */
const ROLE_LBL = {attorney:"Defense attorney", pd:"Public defender", family:"Family / support", bondsman:"Bail agent", probation:"Probation / pretrial", program:"Program", court:"Court / custody office", other:"Other"};
function contactsBy(roles){ return [...(CC.profile.contacts||[]), ...S.contacts].filter(c=>roles.includes(c.role)); }
function contactList(arr){ return arr.length ? arr.map(c=>`<div class="entry"><b>${esc(c.name)}</b>${c.sample?' <span class="chip sample">Sample</span>':""}<div class="small">${esc(ROLE_LBL[c.role]||c.role)}${c.note?" · "+esc(c.note):""}</div>${c.address?`<div class="small"><a href="${mapsUrl(c.address)}" target="_blank" rel="noopener">${esc(c.address)}</a></div>`:""}${c.email?`<div class="small">${esc(c.email)}</div>`:""}<div class="acts">${actBtns(c)}</div></div>`).join("") : `<p class="muted small">None yet.</p>`; }
function caseCards(){
  return (CC.profile.cases||[]).map(k=>{ const ch = courthouse(k.county,k.courthouse); const nx = occurrences(today(),400).find(o=>o.caseId===k.id && o.kind==="court");
    return `<div class="card"><div class="row between"><div class="eyebrow">${esc(k.court_label||"")}</div>${k.sample?'<span class="chip sample">Sample</span>':""}</div><h2>${esc(k.caption)}</h2>
    <dl class="kv"><dt>Case no.</dt><dd><b>${esc(k.number)}</b></dd>${ch?`<dt>Courthouse</dt><dd>${esc(ch.name)}${k.dept?", Dept "+esc(k.dept):""}<br><span class="small">${esc(addrOf(ch))}</span></dd>`:""}
    ${k.charge?`<dt>Charge as filed</dt><dd>${esc(k.charge)}<br><span class="small">An accusation only. Presumed innocent.</span></dd>`:""}${k.status?`<dt>Status</dt><dd>${esc(k.status)}</dd>`:""}
    ${k.release?`<dt>Release</dt><dd>${esc(k.release)}</dd>`:""}${k.defense?`<dt>Defense</dt><dd>${esc(k.defense)}</dd>`:""}${nx?`<dt>Next date</dt><dd>${esc(fmtLong(nx.date,nx.time))} — ${esc(nx.title)}</dd>`:""}</dl>
    ${(k.extra||[]).length?`<dl class="kv" style="margin-top:8px">${k.extra.map(([a,b])=>`<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join("")}</dl>`:""}
    ${(k.deadlines||[]).length?`<h4 style="margin-top:10px">Deadlines</h4><ul class="list">${k.deadlines.map(d=>`<li class="item"><div class="body"><b>${esc(d.label)}</b><div class="small">${esc(d.date?fmtLong(d.date):"Not set yet")}${d.date&&daysUntil(d.date)>=0?" · "+daysUntil(d.date)+" days left":""}${d.note?" · "+esc(d.note):""}</div></div></li>`).join("")}</ul>`:""}
    ${k.public_lookup?`<p class="small" style="margin-top:8px">Look it up yourself: ${esc(k.public_lookup)}</p>`:""}
    ${caseSearch(k)}</div>`; }).join("");
}
function caseSearch(k){
  const b = [], cty = countyData(k.county);
  if (k.county==="federal-cacd"){ b.push(`<a class="btn ghost small" href="${esc(SEARCH.clDocket(k.number))}" target="_blank" rel="noopener">${icon("search")}CourtListener docket</a>`, `<a class="btn ghost small" href="https://pcl.uscourts.gov/pcl/index.jsf" target="_blank" rel="noopener">${icon("search")}PACER Case Locator</a>`); }
  else if (cty && (cty.case_search_url || cty.case_search?.url)) b.push(`<a class="btn ghost small" href="${esc(cty.case_search_url||cty.case_search.url)}" target="_blank" rel="noopener">${icon("search")}${esc((cty.county||"Court")+" case search")} (${esc(k.number)})</a>`);
  for (const l of (k.links||[])) b.push(`<a class="btn ghost small" href="${esc(l.url)}" target="_blank" rel="noopener">${icon("link")}${esc(l.label)}</a>`);
  if (k.statute){ if (k.statute_url) b.push(`<a class="btn ghost small" href="${esc(k.statute_url)}" target="_blank" rel="noopener">${icon("book")}Read ${esc(k.statute)}</a>`);
    b.push(`<a class="btn ghost small" href="${esc(SEARCH.cl('"'+k.statute+'"'))}" target="_blank" rel="noopener">${icon("search")}Cases on ${esc(k.statute)}</a>`); }
  return b.length ? `<div class="eyebrow" style="margin-top:10px">Search it yourself</div><div class="acts">${b.join("")}</div>` : "";
}
async function sha256(s){ const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join(""); }
/* research: every authority links to its source, plus "search it yourself" */
function researchItem(r){
  const q = r.q || r.cite;
  return `<li class="item"><div class="body"><b>${r.url?`<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.cite)}</a>`:esc(r.cite)}</b>
    ${r.effect?` <span class="chip ${/HELP/i.test(r.effect)?"verified":/HURT/i.test(r.effect)?"fee":""}">${esc(r.effect)}</span>`:""}
    <div class="small">${esc(r.why||"")}</div>${r.holding?`<details class="small"><summary>Holding &amp; how it may be used</summary><p>${esc(r.holding)}</p>${r.use?`<p><strong>Use:</strong> ${esc(r.use)}</p>`:""}</details>`:""}
    <div class="acts">${r.url?`<a class="btn ghost small" href="${esc(r.url)}" target="_blank" rel="noopener">${icon("link")}Source</a>`:""}${searchBtns(q)}</div></div>
    <span class="chip ${r.verified?"verified":""}">${r.verified?"Verified":"Unverified"}</span></li>`;
}
function researchBlock(A){
  const groups = {}; for (const r of (A.research||[])) (groups[r.theory||r.why||"Other"] ||= []).push(r);
  return `<p class="small">Leads for the attorney to evaluate — not conclusions. Unverified items must be checked before anyone relies on them.</p>
   ${Object.entries(groups).map(([t,list])=>`<h4 style="margin-top:12px">${esc(t)}</h4>${list[0].summary?`<p class="small">${esc(list[0].summary)}</p>`:""}<ul class="list">${list.map(researchItem).join("")}</ul>`).join("")||"<p class='muted small'>None yet.</p>"}
   ${(A.angles||[]).length?`<h3 style="margin-top:14px">${icon("flag")}Angles found by the research agent</h3>${A.angles.map(g=>`<details class="entry"><summary><b>${esc(g.title)}</b> <span class="small muted">${esc(g.case||"")}</span></summary>
      <p class="small">${esc(g.argument||"")}</p>${g.evidence?`<p class="small"><b>Evidence:</b> ${esc(g.evidence)}</p>`:""}${g.motion?`<p class="small"><b>Motion:</b> ${esc(g.motion)}</p>`:""}${g.risk?`<p class="small"><b>Risk:</b> ${esc(g.risk)}</p>`:""}
      ${(g.cases||[]).length?`<div class="small"><b>Cases:</b> ${g.cases.map(c=>typeof c==="string"?`<a href="${esc(SEARCH.cl(c))}" target="_blank" rel="noopener">${esc(c)}</a>`:(c.url?`<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name||c.cite)}</a>`:esc(c.name||c.cite))).join(" · ")}</div>`:""}</details>`).join("")}`:""}
   ${(A.record_checklist||[]).length?`<h3 style="margin-top:14px">${icon("check")}Record checklist</h3>${A.record_checklist.map(g=>`<h4>${esc(g.case)}</h4><ul class="small" style="padding-left:18px">${g.items.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`).join("")}`:""}`;
}
/* case-file sections (private build): generic renderer for html / img / quote / link / clock / pdf items */
const CF = () => CC.profile.case_files || {groups:[], sections:[]};
function cfSec(id){ return CF().sections.find(x=>x.id===id); }
function cfItems(sec){
  return `<div class="cf">${(sec.items||[]).map((it,i)=>{
    if (it.t==="html") return `<div class="card">${it.html}</div>`;
    if (it.t==="img") return `<figure><img data-m="${esc(it.m)}" alt="${esc(it.cap)}" data-zoom="1"><figcaption>${esc(it.cap)}</figcaption></figure>`;
    if (it.t==="quote") return `<div class="quote${it.flag==="risk"?" risk":""}"><div class="d">${esc(it.date)}</div>“${esc(it.text)}”</div>`;
    if (it.t==="link") return `<a class="lnk" href="${esc(it.url)}" target="_blank" rel="noopener"><b>${esc(it.label)} ↗</b><span>${esc(it.note||"")}</span></a>`;
    if (it.t==="clock") return `<div class="card"><table class="tl">${it.rows.map(r=>`<tr><td>${r.date?esc(fmtLong(r.date)):"<i>TBD</i>"}${r.date?`<br><b>${daysUntil(r.date)>0?daysUntil(r.date)+" days left":daysUntil(r.date)===0?"Today":(-daysUntil(r.date))+" days ago"}</b>`:""}</td><td><b>${esc(r.label)}</b>${r.note?`<br><span class="muted">${esc(r.note)}</span>`:""}</td></tr>`).join("")}</table></div>`;
    if (it.t==="pdf") return `<div class="row" style="margin-bottom:10px"><button class="btn small" data-pdf="${esc(it.m)}">${icon("doc")}${esc(it.label)}</button><button class="btn ghost small" data-pdfdl="${esc(it.m)}" data-name="${esc(it.label)}">${icon("download")}Download</button></div>`;
    return ""; }).join("")}</div>`;
}
function cfTiles(list){ return `<div class="stack">${list.map(x=>`<button class="tile" data-cf="${esc(x.id)}"><span class="ic">${esc(x.icon||"•")}</span><span><b>${esc(x.title)}</b><span class="small">${esc(x.sub||"")}</span></span><span class="chev">›</span></button>`).join("")}</div>`; }
function exhibits(){
  const out = []; for (const sec of CF().sections) for (const it of (sec.items||[])) if (it.t==="img") out.push({sec, it});
  const pdfs = []; for (const sec of CF().sections) for (const it of (sec.items||[])) if (it.t==="pdf") pdfs.push({sec, it});
  const by = {}; for (const x of out) (by[x.sec.title+"|"+x.sec.g] ||= []).push(x);
  const glbl = g => ({fed:"Federal", state:"State", civil:"Civil"}[g]||"");
  return `<p class="small">${out.length} exhibit images and ${pdfs.length} PDFs from the case files, encrypted inside this page. Tap a picture to enlarge.</p>
   ${pdfs.length?`<h4>Documents (PDF)</h4><ul class="list">${pdfs.map(({sec,it})=>`<li class="item"><div class="body"><b>${esc(it.label)}</b><div class="small">${esc(glbl(sec.g))} · ${esc(sec.title)}</div><div class="acts"><button class="btn ghost small" data-pdf="${esc(it.m)}">${icon("doc")}View</button><button class="btn ghost small" data-pdfdl="${esc(it.m)}" data-name="${esc(it.label)}">${icon("download")}Download</button></div></div></li>`).join("")}</ul>`:""}
   ${Object.entries(by).map(([k,list])=>`<h4 style="margin-top:12px">${esc(glbl(list[0].sec.g))} · ${esc(list[0].sec.title)} <span class="small muted">(${list.length})</span></h4><div class="gallery">${list.map(({it},i)=>`<figure><img data-m="${esc(it.m)}" alt="${esc(it.cap)}" data-zoom="1"><figcaption>${esc(it.cap)}</figcaption></figure>`).join("")}</div>`).join("")}
   ${(CF().unembedded||[]).length?`<h4>Listed by name only</h4><ul class="small">${CF().unembedded.map(n=>`<li>${esc(n)}</li>`).join("")}</ul>`:""}`;
}
const ATABS = [["overview","Overview"],["meetings","Meetings"],["fights","Theories"],["motions","Motions"],["research","Research"],["evidence","Evidence"],["files","Case files"]];
function attyArea(){
  const A = CC.profile.attorney_area || {}, rich = !!CC.profile.case_files;
  const qs = [...(A.questions||[]).map(q=>({text:q, sample:CC.profile.sample})), ...S.questions];
  const at = rich ? (CC.attyTab || "overview") : "overview";
  let body = "";
  if (at==="overview"){
    body = `<h3 style="margin-top:12px">${icon("clip")}Client timeline</h3><ul class="timeline">${(A.timeline||[]).map(t=>`<li><div class="d">${esc(/^\d{4}-\d\d-\d\d$/.test(t.date)?fmtLong(t.date):t.date)}</div><div>${esc(t.text)}${t.case?` <span class="chip">${esc(t.case)}</span>`:""}</div></li>`).join("")||"<li>None yet.</li>"}</ul>
   <h3>${icon("doc")}Documents</h3><ul class="list">${(A.documents||[]).map(d=>`<li class="item"><div class="body"><b>${d.url?`<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a>`:esc(d.title)}</b><div class="small">${esc([d.date,d.status].filter(Boolean).join(" · "))}</div></div></li>`).join("")||"<li class='muted small'>None yet.</li>"}</ul>
   <h3 style="margin-top:12px">${icon("hands")}Mitigation packet</h3><ul class="list">${(A.mitigation||[]).map(d=>`<li class="item"><div class="body"><b>${esc(d.title)}</b><div class="small">${esc(d.detail||"")}</div></div><span class="chip ${d.status==="ready"?"verified":""}">${esc(d.status||"to gather")}</span></li>`).join("")||"<li class='muted small'>None yet.</li>"}</ul>
   <h3 style="margin-top:12px">${icon("scales")}Defense contacts</h3>${contactList(contactsBy(["attorney","pd"]))}
   ${(A.counsel_notes||[]).length?`<h3 style="margin-top:12px">${icon("doc")}Notes for counsel</h3>${A.counsel_notes.map(id=>cfSec(id)).filter(Boolean).map(sec=>`<details class="entry"><summary><b>${esc(sec.title)}</b> <span class="small muted">${esc(sec.sub||"")}</span></summary>${cfItems(sec)}</details>`).join("")}`:""}
   ${rich?"":`<h3 style="margin-top:12px">${icon("search")}Similar-cases research</h3>${researchBlock(A)}`}
   <h3 style="margin-top:12px">${icon("info")}Questions for my attorney</h3><ul class="list">${qs.map(q=>`<li class="item"><div class="body"><b style="font-weight:500">${esc(q.text)}</b></div></li>`).join("")}</ul>
   <div class="row" style="margin-top:8px"><input id="q-new" placeholder="Add a question" style="flex:1;min-width:0"><button class="btn small" id="q-add">${icon("plus")}Add</button></div>
   <h3 style="margin-top:14px">${icon("users")}Family contacts (for the attorney)</h3>${contactList(contactsBy(["family"]))}`;
  } else if (at==="meetings"){
    body = `<p class="small">Meeting checklists and questions for each lawyer. Checkboxes reset when you reload — write the answers down.</p>${(A.meetings||[]).map(id=>cfSec(id)).filter(Boolean).map(sec=>`<h3 style="margin-top:12px">${esc(sec.title)}</h3><p class="small">${esc(sec.sub||"")}</p>${cfItems(sec)}`).join("")}`;
  } else if (at==="fights"){
    body = `<p class="small">Defense theories ("fights") from both case files. Research for each theory is under Research.</p>${(A.fights||[]).map(id=>cfSec(id)).filter(Boolean).map(sec=>`<details class="entry"><summary><b>${esc(sec.title)}</b> <span class="small muted">${esc({fed:"Federal",state:"State"}[sec.g]||"")} · ${esc(sec.sub||"")}</span></summary>${cfItems(sec)}</details>`).join("")}`;
  } else if (at==="motions"){
    body = motionsMine(true);
  } else if (at==="research"){
    body = researchBlock(A);
  } else if (at==="evidence"){
    body = exhibits();
  } else if (at==="files"){
    const sec = CC.cfOpen && cfSec(CC.cfOpen);
    body = sec ? `<button class="btn ghost small" id="cf-back">‹ All sections</button><h3 style="margin-top:10px">${esc(sec.title)}</h3><p class="small">${esc(sec.sub||"")}</p>${cfItems(sec)}`
      : CF().groups.map(g=>`<h3 style="margin-top:12px">${esc(g.title)}</h3><p class="small">${esc(g.sub||"")}</p>${cfTiles(CF().sections.filter(x=>x.g===g.id))}`).join("");
  }
  return `<div class="privwrap"><div class="row between"><span class="badge-priv">${icon("lock")}Privileged &amp; confidential</span><button class="btn ghost small" id="atty-lock">${icon("lock")}Lock</button></div>
   <p class="small" style="margin-top:8px">Attorney–client communication prepared for the defense. Not for family, friends, or anyone else. Never discuss any of this on a jail line.</p>
   ${rich?`<div class="seg" style="margin-top:10px">${ATABS.map(([k,l])=>`<button data-atab="${k}" class="${at===k?"on":""}">${l}</button>`).join("")}</div>`:""}
   ${body}</div>`;
}
VIEWS.case = () => {
  const tab = S.caseTab || "glance", role = CC.role;
  const tabs = [["glance","At a glance"],["family","Family"],["attorney","Attorney-only"],["docs","Documents"],["packet","Packet"]].filter(([k])=>!(role==="family" && (k==="attorney"||k==="packet")));
  const cur = tabs.find(t=>t[0]===tab) ? tab : "glance";
  let body = "";
  if (cur==="glance"){
    const rel = CC.profile.release_conditions||[];
    body = caseCards() + (rel.length?`<div class="card"><h3>${icon("clip")}Release conditions to keep</h3><ul class="small" style="padding-left:18px;margin:0">${rel.map(r=>`<li>${esc(r)}</li>`).join("")}</ul><p class="small" style="margin-top:8px">Copied from the release paperwork for reminders. The court's written order controls.</p></div>`:"")
      + `<div class="card"><h3>${icon("scales")}Defense team</h3>${contactList(contactsBy(["attorney","pd"]))}</div>`;
  } else if (cur==="family"){
    const fam = CC.profile.family_area || {};
    body = `<div class="notice navy">${icon("ear")}<div><b>Every jail call is recorded.</b> Talk about family and life — never the case, the charges, or anyone involved. Only calls and mail with the lawyer are private.</div></div>
     <div class="card"><h3>${icon("users")}Family &amp; support contacts</h3>${contactList(contactsBy(["family","bondsman","probation"]))}<button class="btn ghost small" id="addc" style="margin-top:8px">${icon("plus")}Add contact</button></div>
     <div class="card"><h3>${icon("gavel")}How family can help</h3><ul class="small" style="padding-left:18px;margin:0">${(fam.tips||["Court hearings are public — sitting in the gallery shows the judge there's support.","Arrive 30–45 minutes early, bring photo ID, dress neat, phones silent.","Send letters of support through the defense attorney, not to the court or anyone in the case.","Never pass messages to or from anyone involved in the case."]).map(t=>`<li>${esc(t)}</li>`).join("")}</ul></div>
     <div class="card"><h3>${icon("doc")}Note to the family</h3><p class="small">Shared logistics only (rides, dates, what to bring). Screened: names on the no-contact list and witness/victim topics are refused.</p>
       <textarea id="fnote" placeholder="e.g. Need a ride to court Thursday 7:15 AM"></textarea><button class="btn small" id="fnote-add" style="margin-top:8px">Save note</button>
       <ul class="list" style="margin-top:8px">${[...(fam.notes||[]).map(n=>({text:n})), ...S.notes].map(n=>`<li class="item"><div class="body small">${esc(n.text)}</div></li>`).join("")}</ul></div>
     <div class="card"><h3>${icon("key")}Consent &amp; access</h3><p class="small">Who can open what. Family never sees the attorney-only area.</p>
       <ul class="list">${(CC.profile.access||[]).map(a=>`<li class="item"><div class="body"><b>${esc(a.who)}</b><div class="small">${esc(a.can)}</div></div><span class="chip">${esc(a.level)}</span></li>`).join("")}</ul>
       <label class="check" style="margin-top:10px"><input type="checkbox" id="cons-fam" ${S.consent?.family?"checked":""}>I allow my family/support contacts to see my dates, places and contacts (not the attorney-only area).</label></div>
     <div class="card flat"><h3>${icon("ban")}No-contact list</h3><p class="small">Add anyone you're ordered not to contact. The app then refuses to create reminders, contacts or notes about them. It's stored only on this device.</p>
       <div class="row"><input id="nc-new" placeholder="Name" style="flex:1;min-width:0"><button class="btn small" id="nc-add">Add</button></div>
       <div class="row" style="margin-top:8px;gap:6px">${[...(CC.profile.nocontact_display||[]), ...S.nocontact].map(n=>`<span class="chip">${icon("ban")}${esc(n)}</span>`).join("")}</div></div>`;
  } else if (cur==="attorney"){
    body = CC.attyOpen ? attyArea() : `<div class="card"><h3>${icon("lock")}Attorney-only area</h3><p class="small">Privileged material for the defense attorney — kept apart from the family area. Enter the access code you set (or that the client gave the attorney).</p>
      ${CC.profile.sample?`<div class="notice warn">${icon("info")}<div class="small">Demo access code: <b>${esc(CC.profile.attorney_area?.demo_code||"")}</b></div></div>`:""}
      <div class="row"><input id="ac" placeholder="Access code" autocomplete="off" style="flex:1;min-width:0"><button class="btn" id="ac-go">${icon("key")}Open</button></div><p class="small" id="ac-err" style="color:var(--bad)"></p></div>`;
  } else if (cur==="docs"){
    body = docList();
  } else {
    body = `<div class="card"><h3>${icon("doc")}One-click case packet for the attorney</h3><p class="small">A clean PDF the attorney can read without an account: case at a glance, dates, contacts — and, if you include it, the privileged section. Use your phone's share sheet to send it.</p>
      <label class="check"><input type="checkbox" id="pk-priv" ${CC.attyOpen?"":"disabled"}>Include attorney-only section ${CC.attyOpen?"":"(open the attorney-only area first)"}</label>
      <label class="check"><input type="checkbox" id="pk-cons">I am the client (or have the client's permission) and I'm sending this only to the defense attorney of record.</label>
      <button class="btn" id="pk-go" style="margin-top:12px">${icon("download")}Create PDF packet</button>
      <p class="small" style="margin-top:8px">On iPhone: tap Create, then Share → Save to Files or send. On a computer: choose "Save as PDF".</p></div>`;
  }
  return `<div class="pagehead">${icon("folder","lg")}<div><h1>My case</h1><p>Case at a glance, the family area, the attorney-only area, and the PDF packet.</p></div></div>
   <div class="seg">${tabs.map(([k,l])=>`<button data-ctab="${k}" class="${cur===k?"on":""}">${k==="attorney"?icon("lock"):""}${l}</button>`).join("")}</div>${body}`;
};
VIEWS.case.wire = () => {
  $$("[data-ctab]").forEach(b=>b.onclick=()=>{ S.caseTab=b.dataset.ctab; save(); render(); });
  $("#addc")?.addEventListener("click", ()=>contactForm({role:"family"}));
  $("#fnote-add")?.addEventListener("click", ()=>{ const t=$("#fnote").value.trim(); if(!t) return; if(!guardOK(t)) return; S.notes.push({text:t}); save(); render(); toast("Note saved."); });
  $("#cons-fam")?.addEventListener("change", e=>{ S.consent = {...(S.consent||{}), family:e.target.checked, at:new Date().toISOString()}; save(); toast("Saved."); });
  $("#nc-add")?.addEventListener("click", ()=>{ const n=$("#nc-new").value.trim(); if(!n) return; S.nocontact.push(n); save(); buildGuard(); render(); toast("Added to the no-contact list."); });
  $("#ac-go")?.addEventListener("click", async ()=>{ const want = CC.profile.attorney_area?.code_sha256; const got = await sha256($("#ac").value.trim());
    if (!want || got===want){ CC.attyOpen=true; render(); } else $("#ac-err").textContent="That code didn't match."; });
  $("#ac")?.addEventListener("keydown", e=>{ if(e.key==="Enter") $("#ac-go").click(); });
  $("#atty-lock")?.addEventListener("click", ()=>{ CC.attyOpen = !CC.profile.attorney_area?.code_sha256 ? true : false; if(!CC.attyOpen){ render(); toast("Attorney area locked."); } });
  $("#q-add")?.addEventListener("click", ()=>{ const t=$("#q-new").value.trim(); if(!t) return; S.questions.push({text:t}); save(); render(); });
  $$("[data-atab]").forEach(b=>b.onclick=()=>{ CC.attyTab=b.dataset.atab; CC.cfOpen=null; render(); });
  $$("[data-cf]").forEach(b=>b.onclick=()=>{ CC.cfOpen=b.dataset.cf; render(); window.scrollTo(0,0); });
  $("#cf-back")?.addEventListener("click", ()=>{ CC.cfOpen=null; render(); });
  $("#pk-go")?.addEventListener("click", ()=>{ if(!$("#pk-cons").checked) return toast("Confirm who the packet is for first."); CC.printPacket($("#pk-priv").checked); });
};


/* ───────── motions: per-stage checklists + status for the user's own cases ───────── */
const MSTATUS = [["","Not set"],["not yet","Not filed yet"],["requested","Requested by client"],["filed","Filed"],["heard","Heard"],["granted","Granted"],["denied","Denied"],["declined","Attorney decided not to file"],["not needed","Not needed / doesn't apply"]];
const MS_LBL = Object.fromEntries(MSTATUS);
function mstore(){ return CC.profile.persist===false ? CC.mstat : (S.mstat ||= {}); }
function mget(id, base){ return Object.assign({}, base||{}, mstore()[id]||{}); }
function mchip(st){ const v = st.status||""; const cls = /granted|filed|heard/.test(v)?"verified":/denied/.test(v)?"fee":/declined|not needed/.test(v)?"":/requested/.test(v)?"attorney":"";
  return `<span class="chip ${cls}">${esc(MS_LBL[v]||v||"Not set")}</span>`; }
function motionItem(m){
  const st = mget(m.id, m.status_base);
  return `<li class="item"><div class="body"><b>${esc(m.name)}</b> ${mchip(st)}${m.priority && m.priority!==MS_LBL[st.status]?` <span class="chip">${esc(m.priority)}</span>`:""}
   <div class="small">${esc(m.authority||"")}</div><div class="small" style="margin-top:4px">${esc(m.purpose||"")}</div>
   ${m.angle&&CC.role!=="family"?`<div class="small" style="margin-top:4px"><strong>Why for this case:</strong> ${esc(m.angle)}</div>`:""}
   ${m.due||m.deadline||m.when?`<div class="small" style="margin-top:4px"><strong>Deadline:</strong> ${m.due?esc(fmtLong(m.due))+(daysUntil(m.due)>=0?" ("+daysUntil(m.due)+" days)":"")+" · ":""}${esc(m.deadline||m.when||"")}</div>`:""}
   ${st.date||st.reason||st.notes||st.by?`<div class="small" style="margin-top:4px">${st.date?"Checked "+esc(st.date):""}${st.by?" · by "+esc(st.by):""}${st.reason?`<br><strong>Attorney's reason:</strong> ${esc(st.reason)}`:""}${st.notes?`<br><strong>Note:</strong> ${esc(st.notes)}`:""}</div>`:""}
   ${m.record||m.if_missed||m.who||m.trigger||m.definition?`<details class="small"><summary>More</summary>${m.definition?`<p>${esc(m.definition)}</p>`:""}${m.who?`<p><strong>Who:</strong> ${esc(m.who)}</p>`:""}${m.trigger?`<p><strong>Trigger:</strong> ${esc(m.trigger)}</p>`:""}${m.record?`<p><strong>On the record:</strong> ${esc(m.record)}</p>`:""}${m.if_missed?`<p><strong>If missed:</strong> ${esc(m.if_missed)}</p>`:""}</details>`:""}
   <div class="acts">${m.url||m.source?`<a class="btn ghost small" href="${esc(m.url||m.source)}" target="_blank" rel="noopener">${icon("link")}Source</a>`:""}${m.authority?searchBtns(m.authority.split(/[;(]/)[0].trim(), ["cl"]):""}${CC.role!=="family"?`<button class="btn ghost small" data-mstat="${esc(m.id)}">${icon("check")}Update status</button>`:""}</div></div></li>`;
}
function byStage(list, stages){ const g = {}; for (const m of list) (g[m.stage] ||= []).push(m);
  const order = [...(stages||[]), ...Object.keys(g).filter(k=>!(stages||[]).includes(k))];
  return order.filter(k=>g[k]).map(k=>`<h4 style="margin-top:12px;text-transform:capitalize">${esc(k)}</h4><ul class="list">${g[k].map(motionItem).join("")}</ul>`).join(""); }
function motionsMine(){
  const M = CC.profile.motions; if (!M) return `<p class="muted small">No motions tracked yet.</p>`;
  const sys = CC.mSys || M.systems[0].id, cur = M.systems.find(x=>x.id===sys) || M.systems[0];
  const list = M.items.filter(m=>m.system===cur.id), n = st => list.filter(m=>(mget(m.id,m.status_base).status||"")===st).length;
  return `<div class="seg">${M.systems.map(x=>`<button data-msys="${esc(x.id)}" class="${x.id===cur.id?"on":""}">${esc(x.label)}</button>`).join("")}</div>
   <p class="small">${list.length} motions · ${n("requested")} requested by you · ${n("filed")+n("heard")+n("granted")+n("denied")} filed or heard · ${n("declined")} attorney decided not to file. ${CC.profile.persist===false?"Status changes are kept only while this page is open (nothing is written to the device) — update the source file to make them permanent.":""}</p>
   ${byStage(list, cur.stages)}`;
}
VIEWS.guides = () => {
  const G = CC.data.guides || {motions:{}, after:{}}, tab = CC.gTab || "motions";
  const mine = !!CC.profile.motions && CC.role!=="family";
  const sysM = CC.gSysM || Object.keys(G.motions)[0], sysA = CC.gSysA || Object.keys(G.after)[0];
  let body = "";
  if (tab==="motions"){
    const view = CC.gMine===false || !mine ? "list" : "mine";
    const cl = G.motions[sysM] || {items:[], stages:[]};
    body = `${mine?`<div class="seg">${[["mine","My cases"],["list","General checklist"]].map(([k,l])=>`<button data-gmine="${k}" class="${view===k?"on":""}">${l}</button>`).join("")}</div>`:""}
      ${view==="mine" ? `<div class="privwrap">${motionsMine()}</div>` :
       `<div class="seg">${Object.entries(G.motions).map(([k,v])=>`<button data-gsysm="${esc(k)}" class="${k===sysM?"on":""}">${esc(v.label)}</button>`).join("")}</div>
        <p class="small">Motions commonly filed at each stage, in plain English, with the official source. Whether to file any of them is your attorney's decision. Track each one: filed, not filed, or the attorney decided not to — and why.</p>
        ${byStage(cl.items, cl.stages)}`}`;
  } else {
    const A = G.after[sysA] || {}, steps = tab==="lose" ? (A.if_you_lose||[]) : (A.appeal||[]);
    body = `<div class="seg">${Object.entries(G.after).map(([k,v])=>`<button data-gsysa="${esc(k)}" class="${k===sysA?"on":""}">${esc(v.label)}</button>`).join("")}</div>
      <p class="small">${tab==="lose"?"What happens after a guilty verdict or plea, step by step.":"The appeal and post-conviction path, and clearing your record later."} Deadlines are strict — tell your attorney right away if you want to appeal.</p>
      ${steps.map((x,i)=>`<div class="card"><div class="row between"><h3>${i+1}. ${esc(x.title)}</h3>${x.deadline?`<span class="chip fee">${icon("flag")}${esc(x.deadline)}</span>`:""}</div><p class="small">${esc(x.body)}</p>
        <div class="acts">${x.links.map(l=>`<a class="btn ghost small" href="${esc(l.url)}" target="_blank" rel="noopener">${icon("link")}${esc(l.label)}</a>`).join("")}</div></div>`).join("")}
      ${G.verified_notes?`<p class="small muted">${esc(G.verified_notes)} Checked ${esc(G.verified_on||"")}.</p>`:""}`;
  }
  return `<div class="pagehead">${icon("scales","lg")}<div><h1>Guides</h1><p>Motions by stage, what happens if you lose, and how appeals work. Information only — not legal advice.</p></div></div>
   <div class="seg">${[["motions","Motions"],["lose","If you lose"],["appeal","Appeal & record clearing"]].map(([k,l])=>`<button data-gtab="${k}" class="${tab===k?"on":""}">${l}</button>`).join("")}</div>${body}`;
};
VIEWS.guides.wire = () => {
  $$("[data-gtab]").forEach(b=>b.onclick=()=>{ CC.gTab=b.dataset.gtab; render(); });
  $$("[data-gsysm]").forEach(b=>b.onclick=()=>{ CC.gSysM=b.dataset.gsysm; render(); });
  $$("[data-gsysa]").forEach(b=>b.onclick=()=>{ CC.gSysA=b.dataset.gsysa; render(); });
  $$("[data-gmine]").forEach(b=>b.onclick=()=>{ CC.gMine=b.dataset.gmine==="mine"; render(); });
};
function findMotion(id){ return (CC.profile.motions?.items||[]).find(m=>m.id===id) || Object.values(CC.data.guides?.motions||{}).flatMap(x=>x.items).find(m=>m.id===id); }
function motionForm(id){
  const m = findMotion(id); if (!m) return; const st = mget(id, m.status_base);
  const md = modal(`<h3>${icon("check")}${esc(m.name)}</h3>
   <label for="ms-st">Status</label><select id="ms-st">${MSTATUS.map(([v,l])=>`<option value="${esc(v)}" ${st.status===v?"selected":""}>${esc(l)}</option>`).join("")}</select>
   <label for="ms-date">Date checked / filed</label><input id="ms-date" type="date" value="${esc(st.date||ymd(today()))}">
   <label for="ms-reason">Attorney's reason (if not filed, or the ruling)</label><textarea id="ms-reason">${esc(st.reason||"")}</textarea>
   <label for="ms-notes">Why / my note</label><textarea id="ms-notes">${esc(st.notes||"")}</textarea>
   <p class="small">${CC.profile.persist===false?"Private mode: kept only while this page is open.":"Saved on this device only."}</p>
   <div class="row" style="margin-top:10px"><button class="btn" id="ms-save">Save</button><button class="btn ghost" data-close>Cancel</button></div>`);
  $("#ms-save",md).onclick = () => { const v = {status:$("#ms-st").value, date:$("#ms-date").value, reason:$("#ms-reason").value.trim(), notes:$("#ms-notes").value.trim(), by:"updated in app"};
    if (!guardOK(v.reason, v.notes)) return; mstore()[id] = v; save(); md.hidden=true; render(); toast("Status saved."); };
}

/* ───────── documents & signatures ───────── */
function docList(){
  const G = CC.data.guides?.documents || [], P = CC.profile.documents || [], fam = CC.role==="family";
  const all = [...P, ...G].filter(d=>!(fam && (d.priv || d.id==="packet")));
  return `<div class="card"><h3>${icon("doc")}Documents &amp; signatures</h3><p class="small">View or download, or sign on screen and send as a PDF. ${icon("ban")} Never sign a plea, waiver or court form without your attorney.</p>
   <ul class="list">${all.map(d=>`<li class="item"><div class="body"><b>${esc(d.title)}</b>${d.priv?` <span class="chip attorney">${icon("lock")}Privileged</span>`:""}<div class="small">${esc(d.what||d.status||"")}</div>
    <div class="acts">${d.kind==="generated"?`<a class="btn ghost small" href="#case" data-ctab2="packet">${icon("download")}Create packet</a>`:""}
     ${d.kind==="link"||d.url?`<a class="btn ghost small" href="${esc(d.url)}" target="_blank" rel="noopener">${icon("link")}Open</a>`:""}
     ${d.m?`<button class="btn ghost small" data-pdf="${esc(d.m)}">${icon("doc")}View</button><button class="btn ghost small" data-pdfdl="${esc(d.m)}" data-name="${esc(d.title)}">${icon("download")}Download</button>`:""}
     ${d.kind==="sign"?`<button class="btn ghost small" data-docview="${esc(d.id)}">${icon("doc")}View</button><button class="btn small" data-sign="${esc(d.id)}">${icon("check")}Sign &amp; send</button>`:""}
     ${d.docusign_url?`<a class="btn ghost small" href="${esc(d.docusign_url)}" target="_blank" rel="noopener">${icon("link")}Sign in DocuSign</a>`:""}</div></div></li>`).join("")}</ul>
   <p class="small">DocuSign: add a document's <code>docusign_url</code> to show a "Sign in DocuSign" button. This app never creates envelopes or sends anything by itself.</p></div>`;
}
function findDoc(id){ return [...(CC.profile.documents||[]), ...(CC.data.guides?.documents||[])].find(d=>d.id===id); }
function signForm(id, viewOnly){
  const d = findDoc(id); if (!d) return;
  if (viewOnly){ modal(`<h3>${icon("doc")}${esc(d.title)}</h3><pre class="docbody">${esc(d.body||"")}</pre><div class="row"><button class="btn" data-sign2="${esc(id)}">Sign &amp; send</button><button class="btn ghost" data-close>Close</button></div>`);
    $("[data-sign2]").onclick = () => signForm(id); return; }
  const md = modal(`<h3>${icon("check")}Sign: ${esc(d.title)}</h3>
   <label for="sg-body">Fill in the [brackets]</label><textarea id="sg-body" style="min-height:180px">${esc(d.body||"")}</textarea>
   <label for="sg-name">Your full name</label><input id="sg-name" value="${esc(CC.profile.sample?"":CC.profile.person?.name||"")}">
   <label>Sign here</label><canvas id="sg-pad" class="sigpad"></canvas><button class="btn ghost small" id="sg-clear" style="margin-top:6px">Clear signature</button>
   <p class="small">Creates a PDF with your signature, the date and time. Send it from your phone's share sheet, email or text.</p>
   <div class="row" style="margin-top:10px"><button class="btn" id="sg-pdf">${icon("download")}Create signed PDF</button><button class="btn ghost" id="sg-share">${icon("link")}Send…</button><button class="btn ghost" data-close>Cancel</button></div>`);
  const c = $("#sg-pad",md), x = c.getContext("2d"); let strokes = [], cur = null, signedAt = "";
  const fit = () => { const r = c.getBoundingClientRect(); c.width = r.width*2; c.height = 220; paint(); };
  const paint = () => { x.clearRect(0,0,c.width,c.height); x.lineWidth=4; x.lineCap="round"; x.strokeStyle="#0B1F3A"; for (const s of strokes){ x.beginPath(); s.forEach((p,i)=> i? x.lineTo(p[0]*c.width,p[1]*c.height) : x.moveTo(p[0]*c.width,p[1]*c.height)); x.stroke(); } };
  const pt = ev => { const r = c.getBoundingClientRect(); return [(ev.clientX-r.left)/r.width, (ev.clientY-r.top)/r.height]; };
  c.onpointerdown = ev => { c.setPointerCapture(ev.pointerId); cur=[pt(ev)]; strokes.push(cur); };
  c.onpointermove = ev => { if (!cur) return; cur.push(pt(ev)); paint(); };
  c.onpointerup = () => { cur=null; signedAt = new Date().toLocaleString(); };
  setTimeout(fit, 0);
  $("#sg-clear",md).onclick = () => { strokes=[]; signedAt=""; paint(); };
  const ready = () => { const name=$("#sg-name").value.trim(), body=$("#sg-body").value; if (!name || !strokes.length){ toast("Add your name and signature."); return null; }
    if (!guardOK(body, name)) return null; return {name, body}; };
  $("#sg-pdf",md).onclick = () => { const r = ready(); if (!r) return; const img = c.toDataURL("image/png");
    $("#print").innerHTML = `<h1>${esc(d.title)}</h1><pre class="docbody">${esc(r.body)}</pre><div style="margin-top:18pt"><img src="${img}" style="height:60pt"><div style="border-top:1px solid #000;width:3.5in">${esc(r.name)} — signed electronically ${esc(signedAt||new Date().toLocaleString())}</div></div>
      <div class="disc">Created with Court Companion. Information and reminders only — not legal advice. Not affiliated with any court or government agency.</div>`;
    document.body.classList.add("printing"); const done=()=>{document.body.classList.remove("printing"); window.removeEventListener("afterprint",done)}; window.addEventListener("afterprint",done); setTimeout(()=>window.print(),50); };
  $("#sg-share",md).onclick = async () => { const r = ready(); if (!r) return; const text = r.body+"\n\n— "+r.name+" (signed "+(signedAt||new Date().toLocaleString())+")";
    if (navigator.share){ try{ await navigator.share({title:d.title, text}); return; }catch(e){ if (e && e.name==="AbortError") return; } }
    modal(`<h3>Send</h3><p class="small">Attach the signed PDF you saved, or send the text:</p><div class="acts"><a class="btn" href="mailto:?subject=${enc(d.title+" — "+caseRef(null))}&body=${enc(text)}">Email</a><a class="btn ghost" href="sms:?&body=${enc(text)}">Text</a><button class="btn ghost" data-close>Close</button></div>`); };
}

/* ───────── shared wiring: encrypted media (private build), PDFs, zoom ───────── */
CC.mediaURL = async id => { if (!CC._media) CC._media = CC.loadMedia ? CC.loadMedia() : Promise.resolve({}); return (await CC._media)[id]; };
function hydrate(root){
  const imgs = $$("img[data-m]",root).filter(i=>!i.src); if (!imgs.length) return;
  const load = el => { if (el.dataset.done) return; el.dataset.done=1; CC.mediaURL(el.dataset.m).then(u=>{ if (u) el.src=u; else el.alt="Image not available"; }); };
  if (!("IntersectionObserver" in window)) return imgs.forEach(load);
  const io = new IntersectionObserver(es=>es.forEach(e=>{ if (e.isIntersecting){ io.unobserve(e.target); load(e.target); } }), {rootMargin:"600px"});
  imgs.forEach(i=>io.observe(i));
}
function wireCommon(root){
  hydrate(root);
  $$("[data-pdf]",root).forEach(b=>b.onclick=async()=>{ const w = window.open("","_blank"); const u = await CC.mediaURL(b.dataset.pdf); if (!u){ w&&w.close(); return toast("PDF not available."); } if (w) w.location.href=u; else location.href=u; });
  $$("[data-pdfdl]",root).forEach(b=>b.onclick=async()=>{ const u = await CC.mediaURL(b.dataset.pdfdl); if (!u) return toast("PDF not available."); const a=document.createElement("a"); a.href=u; a.download=(b.dataset.name||"document").replace(/[^\w\- ]+/g,"").slice(0,60)+".pdf"; document.body.appendChild(a); a.click(); a.remove(); });
  $$("img[data-zoom]",root).forEach(i=>i.onclick=()=>{ if (!i.src) return; modal(`<img src="${i.src}" alt="" style="width:100%;border-radius:8px"><p class="small">${esc(i.alt)}</p><div class="row"><button class="btn" data-close>Close</button></div>`); });
  $$("[data-mstat]",root).forEach(b=>b.onclick=()=>motionForm(b.dataset.mstat));
  $$("[data-msys]",root).forEach(b=>b.onclick=()=>{ CC.mSys=b.dataset.msys; render(); });
  $$("[data-sign]",root).forEach(b=>b.onclick=()=>signForm(b.dataset.sign));
  $$("[data-docview]",root).forEach(b=>b.onclick=()=>signForm(b.dataset.docview, true));
  $$("[data-ctab2]",root).forEach(b=>b.onclick=()=>{ S.caseTab=b.dataset.ctab2; save(); render(); });
}

/* ───────── PDF packet (print layout; no account needed on the attorney's side) ───────── */
CC.packetHTML = (priv) => {
  const P = CC.profile, A = P.attorney_area || {}, now = new Date();
  const occ = occurrences(today(), 180).filter(o=>["court","attorney","probation","pars","class","service","fee","drugtest"].includes(o.kind));
  const seen = new Set(), dates = occ.filter(o=>{ const k=o.id; if(o.repeat&&o.repeat!=="none"){ if(seen.has(k)) return false; seen.add(k);} return true; });
  const row = c => `<tr><td>${esc(c.name)}</td><td>${esc(ROLE_LBL[c.role]||c.role)}</td><td>${esc(c.phone||"")}${c.email?"<br>"+esc(c.email):""}</td><td>${esc([c.address,c.note].filter(Boolean).join(" · "))}</td></tr>`;
  let h = `<h1>Case Packet — ${esc(P.person?.name||"")}${P.sample?" (SAMPLE)":""}</h1><p>Prepared ${esc(now.toLocaleString())} with Court Companion for the client's defense attorney. ${P.sample?"<b>All names and case numbers in this packet are fictional.</b>":""}</p>
   <h2>Case at a glance</h2><table><tr><th>Case</th><th>Number</th><th>Court</th><th>Charge as filed</th><th>Status</th></tr>${(P.cases||[]).map(k=>{const ch=courthouse(k.county,k.courthouse);return `<tr><td>${esc(k.caption)}</td><td>${esc(k.number)}</td><td>${esc(ch?ch.name+(k.dept?", Dept "+k.dept:"")+" — "+addrOf(ch):k.court_label||"")}</td><td>${esc(k.charge||"")}</td><td>${esc(k.status||"")}${k.release?"<br>Release: "+esc(k.release):""}</td></tr>`}).join("")}</table>
   ${(P.release_conditions||[]).length?`<h2>Release conditions (as recorded by the client)</h2><ul>${P.release_conditions.map(r=>`<li>${esc(r)}</li>`).join("")}</ul>`:""}
   <h2>Upcoming dates &amp; obligations (180 days)</h2><table><tr><th>Date</th><th>Time</th><th>What</th><th>Where</th></tr>${dates.map(o=>`<tr><td>${esc(o.date)}${o.repeat&&o.repeat!=="none"?" (repeats "+esc(o.repeat)+")":""}</td><td>${esc(o.time?fmtTime(o.time):"")}</td><td>${esc(o.title)}</td><td>${esc(placeLine(o))}</td></tr>`).join("")}</table>
   <h2>Defense contacts</h2><table><tr><th>Name</th><th>Role</th><th>Phone / email</th><th>Notes</th></tr>${contactsBy(["attorney","pd"]).map(row).join("")}</table>
   <h2>Supervision, bail &amp; program contacts</h2><table><tr><th>Name</th><th>Role</th><th>Phone / email</th><th>Notes</th></tr>${contactsBy(["probation","bondsman","program"]).map(row).join("")||"<tr><td colspan=4>None recorded.</td></tr>"}</table>
   <h2>Family / support contacts</h2><table><tr><th>Name</th><th>Role</th><th>Phone / email</th><th>Notes</th></tr>${contactsBy(["family"]).map(row).join("")||"<tr><td colspan=4>None recorded.</td></tr>"}</table>`;
  if (priv){
    h += `<div class="pbreak"></div><div class="privhdr">PRIVILEGED &amp; CONFIDENTIAL — ATTORNEY–CLIENT COMMUNICATION — PREPARED AT THE REQUEST OF / FOR DEFENSE COUNSEL</div>
     <h2>Client timeline</h2><table><tr><th>Date</th><th>Event</th></tr>${(A.timeline||[]).map(t=>`<tr><td>${esc(t.date)}</td><td>${esc(t.text)}</td></tr>`).join("")}</table>
     <h2>Documents</h2><table><tr><th>Document</th><th>Date</th><th>Status</th></tr>${(A.documents||[]).map(d=>`<tr><td>${esc(d.title)}</td><td>${esc(d.date||"")}</td><td>${esc(d.status||"")}</td></tr>`).join("")}</table>
     <h2>Mitigation packet</h2><table><tr><th>Item</th><th>Detail</th><th>Status</th></tr>${(A.mitigation||[]).map(d=>`<tr><td>${esc(d.title)}</td><td>${esc(d.detail||"")}</td><td>${esc(d.status||"to gather")}</td></tr>`).join("")}</table>
     <h2>Similar-cases research (leads only — verify before relying)</h2><table><tr><th>Authority</th><th>Theory / why it may matter</th><th>Checked?</th></tr>${(A.research||[]).map(r=>`<tr><td>${esc(r.cite)}${r.effect?" — "+esc(r.effect):""}${r.url?`<br><a href="${esc(r.url)}">${esc(r.url)}</a>`:""}</td><td>${esc(r.theory||r.why||"")}${r.use?"<br>"+esc(r.use):""}</td><td>${r.verified?"Verified":"UNVERIFIED"}</td></tr>`).join("")}</table>
     <h2>Questions for my attorney</h2><ol>${[...(A.questions||[]), ...S.questions.map(q=>q.text)].map(q=>`<li>${esc(q)}</li>`).join("")}</ol>`;
    if (CC.profile.motions){ const M = CC.profile.motions;
      h += `<h2>Motions and status</h2>${M.systems.map(sy=>`<h3>${esc(sy.label)}</h3><table><tr><th>Stage</th><th>Motion</th><th>Status</th><th>Deadline</th><th>Why for this case</th></tr>${M.items.filter(m=>m.system===sy.id).map(m=>{ const st=mget(m.id,m.status_base); return `<tr><td>${esc(m.stage)}</td><td>${esc(m.name)}<br><small>${esc(m.authority||"")}</small></td><td>${esc(MS_LBL[st.status||""]||st.status||"")}${st.date?"<br>"+esc(st.date):""}${st.reason?"<br>Reason: "+esc(st.reason):""}${st.notes?"<br>"+esc(st.notes):""}</td><td>${esc([m.due,m.deadline].filter(Boolean).join(" — "))}</td><td>${esc(m.angle||"")}</td></tr>`; }).join("")}</table>`).join("")}`; }
    const secs = ids => (ids||[]).map(id=>cfSec(id)).filter(Boolean);
    if ((A.fights||[]).length) h += `<h2>Defense theories</h2><ol>${secs(A.fights).map(x=>`<li><b>${esc(x.title)}</b> — ${esc(x.sub||"")}</li>`).join("")}</ol>`;
    for (const x of secs(A.meetings)) h += `<h2>Meeting: ${esc(x.title)}</h2><div>${x.items.filter(i=>i.t==="html").map(i=>i.html).join("")}</div>`;
    for (const x of secs(A.counsel_notes)) h += `<h2>${esc(x.title)}</h2><div>${x.items.filter(i=>i.t==="html").map(i=>i.html).join("")}</div>`;
    if ((A.angles||[]).length) h += `<h2>Research angles</h2><table><tr><th>Angle</th><th>Argument</th><th>Motion / risk</th></tr>${A.angles.map(g=>`<tr><td>${esc(g.title)}<br><small>${esc(g.case||"")}</small></td><td>${esc(g.argument||"")}</td><td>${esc(g.motion||"")}${g.risk?"<br>Risk: "+esc(g.risk):""}</td></tr>`).join("")}</table>`;
    if (CC.profile.case_files){ const ex = []; for (const sec of CF().sections) for (const it of sec.items||[]) if (it.t==="img"||it.t==="pdf") ex.push([({fed:"Federal",state:"State",civil:"Civil"}[sec.g]||"")+" · "+sec.title, it.t==="img"?it.cap:"PDF: "+it.label]);
      h += `<h2>Exhibit index (${ex.length})</h2><table><tr><th>#</th><th>Section</th><th>Exhibit</th></tr>${ex.map((e,i)=>`<tr><td>${i+1}</td><td>${esc(e[0])}</td><td>${esc(e[1])}</td></tr>`).join("")}</table><p>Images and PDFs are in the client's encrypted case app; ask the client for copies.</p>`; }
  }
  h += `<div class="disc">Court Companion provides information and reminders only and is not legal advice. Not affiliated with any court or government agency. Dates and places were entered by the client or copied from public court sources; confirm everything with the court record. The app does not contact witnesses or alleged victims and does not relay messages to anyone.</div>`;
  return h;
};
CC.printPacket = (priv) => { $("#print").innerHTML = CC.packetHTML(priv); document.body.classList.add("printing"); const done=()=>{document.body.classList.remove("printing"); window.removeEventListener("afterprint",done)}; window.addEventListener("afterprint",done); setTimeout(()=>window.print(), 50); };

VIEWS.settings = () => {
  const B = CC.brand, ob = CC.outbox(72).slice(0,6);
  return `<div class="pagehead">${icon("gear","lg")}<div><h1>Settings &amp; about</h1><p>Who's using the app, your data, and how it works.</p></div></div>
  <div class="card"><h3>${icon("users")}Viewing as</h3><div class="seg" style="margin:0">${[["client","Client"],["family","Family member"],["attorney","Attorney"]].map(([k,l])=>`<button data-role="${k}" class="${CC.role===k?"on":""}">${l}</button>`).join("")}</div>
   <p class="small" style="margin-top:8px">Family view hides private notes, the attorney-only area and the packet. Attorney view still needs the access code.</p></div>
  ${CC.profile.sample?`<div class="card"><h3>${icon("bond")}White-label preview</h3><p class="small">A bail bonds company can brand the app for its own clients — its name, colors, license and phone on every screen, plus "Your bail agent" in the directory.</p>
    <div class="row"><a class="btn ${B.whitelabel?"ghost":""}" href="?brand=golden-gate#home">Golden Gate Bail Bonds — SAMPLE</a><a class="btn ghost" href="?#home">Standard version</a></div></div>`:""}
  <div class="card"><h3>${icon("phone")}Text / Telegram reminder outbox (preview)</h3><p class="small">Not connected. Nothing is ever sent from this app. When a server is added, these are the messages it would send (next 72 hours):</p>
   <ul class="small" style="padding-left:18px">${ob.map(o=>`<li><b>${esc(new Date(o.send_at).toLocaleString())}</b> — ${esc(o.text)}</li>`).join("")||"<li>Nothing due.</li>"}</ul></div>
  <div class="card"><h3>${icon("key")}Whose case</h3><p class="small">${CC.profile.sample?"You're looking at the sample case.":"You're using your own case, saved on this device."}</p>
   <div class="row"><button class="btn ${CC.profile.sample?"":"ghost"}" id="mycase">${icon("plus")}${(()=>{try{return localStorage.getItem("cc:profile:mine")}catch(e){return null}})()?(CC.profile.sample?"Open my case":"Start over with a new case"):"Set up my case"}</button>${CC.profile.sample?"":`<button class="btn ghost" id="demo">See the sample case</button>`}</div></div>
  <div class="card"><h3>${icon("info")}Walkthrough tips</h3><p class="small">A short explanation pops up the first time you open each section.</p><button class="btn ghost" onclick="CC.tourReset()">Show the tips again</button></div>
  <div class="card"><h3>${icon("folder")}Your data</h3><p class="small">${CC.profile.persist===false?"Private mode: your case data lives only inside the encrypted page. Only done-checkmarks are remembered on this device.":"Everything you add stays in this browser on this device. Nothing is uploaded."}</p>
   <div class="row"><button class="btn ghost" id="exp">${icon("download")}Export my data (JSON)</button><button class="btn ghost" id="ics2">${icon("calendar")}Calendar (.ics)</button><button class="btn ghost" id="wipe">${icon("x")}Erase from this device</button></div></div>
  <div class="card"><h3>${icon("shield")}Ground rules</h3><ul class="small" style="padding-left:18px;margin:0">
   <li><b>Not legal advice.</b> Court Companion gives information and reminders. Only a licensed attorney who knows your case can advise you.</li>
   <li><b>No contact with witnesses or alleged victims.</b> The app won't create contacts, reminders or notes about them and never relays messages.</li>
   <li><b>Privilege.</b> The attorney-only area is separate from the family area. Don't share it with anyone but your attorney.</li>
   <li><b>Jail calls are recorded.</b> Only legal calls and legal mail are private.</li>
   <li><b>Consent.</b> Family and attorney access is opt-in with access codes.</li>
   <li><b>Not affiliated with any court or government agency.</b> No official seals are used. Always confirm dates with the court.</li></ul></div>`;
};
VIEWS.settings.wire = () => {
  $$("[data-role]").forEach(b=>b.onclick=()=>{ CC.role=b.dataset.role; S.role=CC.role; if(CC.role==="family") CC.attyOpen=false; save(); render(); toast("Viewing as "+b.textContent+"."); });
  $("#mycase").onclick = () => { let has=null; try{ has=localStorage.getItem("cc:profile:mine"); }catch(e){} if (CC.profile.sample && has) CC.useMine(); else CC.intake(); };
  if ($("#demo")) $("#demo").onclick = () => CC.useDemo();
  $("#exp").onclick = () => download("court-companion-data.json", JSON.stringify({exported:new Date().toISOString(), events:S.events, contacts:S.contacts, questions:S.questions, notes:S.notes, nocontact:S.nocontact}, null, 2), "application/json");
  $("#ics2").onclick = () => CC.exportICS();
  $("#wipe").onclick = () => { if (confirm("Erase everything this app saved on this device?")){ try{localStorage.removeItem(KEY)}catch(e){} load(); buildGuard(); render(); toast("Erased."); } };
};

/* ───────── shell ───────── */
const NAV = [["home","Home","home"],["court","Court","courthouse"],["tasks","Reminders","bell"],["directory","Directory","book"],["guides","Guides","scales"],["case","My case","folder"],["toolkit","Toolkit","key"]];
function render(){
  let r = (location.hash||"#home").slice(1); if (!VIEWS[r]) r = "home";
  $("#tabs").innerHTML = NAV.map(([k,l,i])=>`<a href="#${k}" class="${r===k?"on":""}" ${r===k?'aria-current="page"':""}>${icon(i)}<span>${l}</span></a>`).join("");
  const v = $("#view"); v.innerHTML = VIEWS[r](); VIEWS[r].wire && VIEWS[r].wire(); wireItems(v); wireCommon(v);
  $$(".seg",v).forEach(sg=>{ const on=$("button.on",sg); if(on) sg.scrollLeft = Math.max(0, on.offsetLeft - sg.clientWidth/2 + on.offsetWidth/2); });
}
function applyBrand(){
  const B = CC.brand, root = document.documentElement.style;
  if (B.accent) root.setProperty("--accent", B.accent);
  if (B.gold) root.setProperty("--brand-gold", B.gold);
  $("#bname").textContent = B.name; $("#bsub").textContent = B.sub || "";
  $("#mode").textContent = CC.profile.mode_label || ""; $("#mode").hidden = !CC.profile.mode_label;
  $("#poweredby").hidden = !B.whitelabel;
  document.title = B.name + (B.whitelabel ? "" : "");
  const mc = document.querySelector('meta[name="theme-color"]'); if (mc) mc.content = B.accent || "#0B1F3A";
}
function disclaimer(){
  if (S.seenDisclaimer) return;
  modal(`<h3>${icon("scales")}Before you start</h3><p><b>${esc(CC.brand.name)}</b> keeps your court dates, obligations and contacts in one place and reminds you about them.</p>
   <ul class="small" style="padding-left:18px"><li>It is <b>information and reminders only — not legal advice</b>. Ask your attorney about your case.</li><li>It is <b>not affiliated with any court or government agency</b>. Always confirm dates with the court.</li><li>It will <b>never contact or pass messages</b> to witnesses or alleged victims.</li><li><b>Jail calls are recorded.</b> Don't discuss your case on them.</li></ul>
   <button class="btn block" id="agree">I understand</button>`);
  $("#agree").onclick = () => { S.seenDisclaimer = new Date().toISOString(); save(); $("#modal").hidden = true; if (CC.tour) setTimeout(()=>CC.tour((location.hash||"#home").slice(1)), 200); };
}
/* Hooks for add-on modules (js/toolkit.js): views, nav and shared helpers. */
CC.VIEWS = VIEWS; CC.render = () => render();
CC._ = { $, $$, esc, enc, modal, toast, download, guardOK, screen, searchBtns, actBtns, ymd, today, parseD, fmtLong, digits, store: () => S, save: () => save(), signForm, caseRef };
CC.start = async (profile, inline) => {
  // Demo profiles may use relative dates ("+5" = five days from today) so the sample never goes stale.
  const rel = v => (typeof v==="string" && /^[+-]\d+$/.test(v)) ? ymd(new Date(today().getTime()+parseInt(v,10)*864e5)) : v;
  for (const e of (profile.events||[])){ e.date = rel(e.date); if (e.until) e.until = rel(e.until); }
  for (const t of (profile.attorney_area?.timeline||[])) t.date = rel(t.date);
  for (const d of (profile.attorney_area?.documents||[])) d.date = rel(d.date);
  CC.profile = profile; CC.inline = inline || null; KEY = "cc:v1:"+profile.id; load();
  CC.role = S.role || "client";
  if (!profile.attorney_area?.code_sha256 && profile.attorney_area) CC.attyOpen = true;
  CC.brand = Object.assign({name:"Court Companion", sub:"Court dates · reminders · help"}, profile.brand || {});
  const bp = new URLSearchParams(location.search).get("brand");
  if (bp && profile.sample && /^[a-z0-9-]+$/.test(bp)){ try{ Object.assign(CC.brand, await J("data/demo/brand-"+bp+".json"), {whitelabel:true}); const bc = CC.brand.contact; if (bc && !(profile.contacts||[]).some(c=>c.id===bc.id)) profile.contacts = [...(profile.contacts||[]), bc]; }catch(e){} }
  const st = await J("data/states/ca/state.json"); CC.data.state = st;
  for (const id of (st.counties_available||[])){ try{ CC.data.counties[id] = await J("data/states/ca/counties/"+id+".json"); }catch(e){ console.warn("county data missing", id); } }
  st.counties_available = (st.counties_available||[]).filter(id=>CC.data.counties[id]);
  CC.data.federal = await J("data/federal/cacd.json"); CC.data.guard = await J("data/guardrails.json");
  try{ CC.data.guides = await J("data/guides/ca.json"); }catch(e){ console.warn("guides missing"); }
  buildGuard(); applyBrand(); if (CC.onStart) await CC.onStart(); render(); disclaimer(); scheduleAlerts();
  window.addEventListener("hashchange", () => { render(); window.scrollTo(0,0); });
  $("#gear").onclick = () => { location.hash = "#settings"; };
  document.documentElement.dataset.ready = "1";
};
})();
