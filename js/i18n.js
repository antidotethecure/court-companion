/* Court Companion — languages. The menu, the first-run notice and the safety warnings are translated by hand here.
   Everything else is translated ON THE PHONE with the browser's built-in translator when it has one (Chrome's
   on-device Translator API) — nothing is sent to a translation server, so case details stay private. Otherwise the
   app shows how to use the phone's own "Translate page". Court terms can translate imperfectly: when in doubt,
   ask the court for a free interpreter. */
(function(){
"use strict";
const LANGS = [["en","English"],["es","Español"],["zh","中文"],["vi","Tiếng Việt"],["ko","한국어"],["tl","Tagalog"],["th","ไทย"]];
const NAV = {
 es:{home:"Inicio",court:"Corte",tasks:"Recordatorios",directory:"Directorio",guides:"Guías",case:"Mi caso",toolkit:"Herramientas"},
 zh:{home:"首页",court:"法院",tasks:"提醒",directory:"通讯录",guides:"指南",case:"我的案件",toolkit:"工具箱"},
 vi:{home:"Trang chủ",court:"Tòa án",tasks:"Nhắc nhở",directory:"Danh bạ",guides:"Hướng dẫn",case:"Hồ sơ của tôi",toolkit:"Công cụ"},
 ko:{home:"홈",court:"법원",tasks:"알림",directory:"연락처",guides:"안내",case:"내 사건",toolkit:"도구"},
 tl:{home:"Home",court:"Korte",tasks:"Paalala",directory:"Direktoryo",guides:"Gabay",case:"Kaso ko",toolkit:"Toolkit"},
 th:{home:"หน้าแรก",court:"ศาล",tasks:"การแจ้งเตือน",directory:"รายชื่อติดต่อ",guides:"คู่มือ",case:"คดีของฉัน",toolkit:"เครื่องมือ"}};
const SAFE = {
 es:["Solo información y recordatorios — no es asesoría legal. Pregúntele a su abogado sobre su caso.","Las llamadas desde la cárcel se graban. No hable de su caso en ellas.","Nunca contacte a un testigo ni a la presunta víctima.","Tiene derecho a un intérprete gratis en la corte. Pídalo."],
 zh:["仅提供信息和提醒——不是法律建议。有关您的案件请咨询您的律师。","监狱电话会被录音。不要在电话中谈论您的案件。","切勿联系证人或所谓的受害人。","您有权在法庭上获得免费口译员。请提出要求。"],
 vi:["Chỉ là thông tin và nhắc nhở — không phải tư vấn pháp lý. Hãy hỏi luật sư về vụ án của bạn.","Các cuộc gọi từ nhà tù đều bị ghi âm. Đừng nói về vụ án qua điện thoại đó.","Không bao giờ liên lạc với nhân chứng hoặc người bị cho là nạn nhân.","Bạn có quyền có thông dịch viên miễn phí tại tòa. Hãy yêu cầu."],
 ko:["정보와 알림만 제공하며 법률 조언이 아닙니다. 사건에 대해서는 변호사에게 문의하세요.","구치소 전화는 녹음됩니다. 통화 중에 사건 이야기를 하지 마세요.","증인이나 피해자로 주장되는 사람에게 절대 연락하지 마세요.","법원에서 무료 통역을 받을 권리가 있습니다. 요청하세요."],
 tl:["Impormasyon at paalala lamang — hindi legal na payo. Tanungin ang iyong abogado tungkol sa iyong kaso.","Nire-record ang mga tawag mula sa kulungan. Huwag pag-usapan ang kaso mo roon.","Huwag kailanman kontakin ang saksi o ang sinasabing biktima.","May karapatan ka sa libreng interpreter sa korte. Hilingin ito."],
 th:["เป็นข้อมูลและการแจ้งเตือนเท่านั้น ไม่ใช่คำแนะนำทางกฎหมาย โปรดสอบถามทนายความเกี่ยวกับคดีของคุณ","การโทรจากเรือนจำถูกบันทึกเสียง อย่าพูดถึงคดีของคุณทางโทรศัพท์นั้น","ห้ามติดต่อพยานหรือผู้ที่ถูกกล่าวว่าเป็นผู้เสียหายโดยเด็ดขาด","คุณมีสิทธิ์ได้รับล่ามฟรีในศาล โปรดร้องขอ"]};
const HOWTO = {
 es:"Para traducir todo: en iPhone (Safari) toque «aA» → «Traducir». En Android (Chrome) toque ⋮ → «Traducir».",
 zh:"翻译整个页面：iPhone（Safari）点击“aA”→“翻译”。Android（Chrome）点击 ⋮ →“翻译”。",
 vi:"Để dịch toàn bộ: iPhone (Safari) chạm “aA” → “Dịch”. Android (Chrome) chạm ⋮ → “Dịch”.",
 ko:"전체 번역: iPhone(Safari)에서 'aA' → '번역'. Android(Chrome)에서 ⋮ → '번역'.",
 tl:"Para isalin lahat: sa iPhone (Safari) pindutin ang “aA” → “Translate”. Sa Android (Chrome) pindutin ang ⋮ → “Translate”.",
 th:"แปลทั้งหน้า: iPhone (Safari) แตะ “aA” → “แปล” Android (Chrome) แตะ ⋮ → “แปล”"};
let lang = "en"; try{ lang = localStorage.getItem("cc:lang") || (navigator.language||"en").slice(0,2); }catch(e){}
if (!LANGS.some(l=>l[0]===lang)) lang = "en";
let tr = null, busy = false;
async function translator(){
  if (lang === "en" || !("Translator" in self)) return null;
  if (tr && tr.lang === lang) return tr.t;
  try{ const ok = await Translator.availability({sourceLanguage:"en", targetLanguage:lang}); if (ok === "unavailable") return null;
    tr = {lang, t: await Translator.create({sourceLanguage:"en", targetLanguage:lang})}; return tr.t; }catch(e){ return null; }
}
async function translateView(){
  const root = document.getElementById("view"); if (!root || busy) return; const t = await translator(); if (!t) return; busy = true;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {acceptNode: n => n.nodeValue.trim().length > 1 && !n.parentElement.closest("input,textarea,script,style,[data-notr]") ? 1 : 2});
  const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  for (const n of nodes){ try{ n.nodeValue = await t.translate(n.nodeValue); }catch(e){ break; } }
  busy = false;
}
function apply(){
  document.documentElement.lang = lang;
  if (lang !== "en"){ const m = NAV[lang]||{}; document.querySelectorAll("#tabs a").forEach(a=>{ const k = a.getAttribute("href").slice(1), s = a.querySelector("span"); if (m[k] && s) s.textContent = m[k]; }); }
  const v = document.getElementById("view"); if (!v) return;
  let b = document.getElementById("i18n-safe");
  if (lang !== "en" && SAFE[lang]){ if (!b){ b = document.createElement("div"); b.id = "i18n-safe"; b.className = "notice navy"; b.setAttribute("data-notr",""); }
    b.innerHTML = `<div><ul class="small" style="margin:0;padding-left:18px">${SAFE[lang].map(x=>`<li>${x}</li>`).join("")}</ul>${"Translator" in self ? "" : `<div class="small" style="margin-top:6px">${HOWTO[lang]}</div>`}</div>`;
    v.prepend(b); translateView(); }
}
window.CCi18n = { LANGS, get lang(){ return lang; }, set(l){ lang = l; try{ localStorage.setItem("cc:lang", l); }catch(e){} location.reload(); }, apply };
document.addEventListener("DOMContentLoaded", () => {
  const sel = document.getElementById("langsel"); if (sel){ sel.innerHTML = LANGS.map(([k,l])=>`<option value="${k}" ${k===lang?"selected":""}>${l}</option>`).join(""); sel.onchange = () => window.CCi18n.set(sel.value); }
  const v = document.getElementById("view"); if (v) new MutationObserver(m => { if (m.some(x=>[...x.addedNodes].some(n=>n.id!=="i18n-safe"))) setTimeout(apply, 0); }).observe(v, {childList:true}); });
})();
