// 画面全体の描画・タブ・青色申告の条件チェック "use strict";
/* ========== 描画 ========== */
const tabsFor=()=>mode=="all"
  ?[["dash","📊 全体の集計（申告用）"],["accounts","🏦 貯金・口座"],["etax","🖥 e-Tax入力ガイド"],["glossary","📖 用語集"],["data","💾 バックアップ"]]
  :mode=="hat"
  ?[["map","🗺 区画マップ"],["plantings","🌱 作付"],["expenses","🧾 経費"],["sales","💰 売上・収入"],["accounts","🏦 貯金・口座"],["dash","📊 畑の集計"],["fields","🥬 畑の一覧"],["glossary","📖 用語集"]] // 畑にも経費・売上・口座（田んぼ・畑・全体で共通）・集計を出す。減価償却は田んぼ側だけ
  :[["dash","📊 集計"],["expenses","🧾 経費"],["sales","💰 売上・収入"],["accounts","🏦 貯金・口座"],["plantings","🌱 作付・苗"],["fields",mode=="hat"?"🥬 畑の一覧":"🗾 田んぼの一覧"],["assets","🚜 減価償却（高い機械）"],["glossary","📖 用語集"]];
let statusOpen=false;
try{statusOpen=localStorage.getItem("agri-status-open")==="1";}catch(e){}
function toggleStatus(){
  statusOpen=!statusOpen;
  try{localStorage.setItem("agri-status-open",statusOpen?"1":"0");}catch(e){}
  render();
}
function render(){
  if(!tabsFor().some(t=>t[0]==tab))tab=tabsFor()[0][0];
  document.body.className=mode;
  $("modes").innerHTML=[["rice","🌾 田んぼ"],["hat","🥬 畑"],["all","📋 全体"]].map(([k,l])=>`<button class="${k==mode?"on":""}" onclick="mode='${k}';tab='${k=="hat"?"map":"dash"}';render()">${l}</button>`).join("");
  $("year").innerHTML=yearList().map(y=>`<option ${y==year?"selected":""}>${y}</option>`).join("");
  $("nav").innerHTML=tabsFor().map(([k,l])=>`<button class="${k==tab?"on":""}" onclick="tab='${k}';render()">${l}</button>`).join("");
  updateSyncUI();updateUndoUI();
  const probs=checkBlue(), st=$("status");
  st.style.display=mode=="hat"?"none":""; // 畑タブでは青色申告メッセージを出さない
  st.className=probs.length?"checklist":"";
  // 入力チェックは税務要件の判定ではない。見出しで折りたためる。
  st.innerHTML=probs.length
    ?`<button type="button" class="sthead" aria-expanded="${statusOpen}" onclick="toggleStatus()">
        <span>申告に向けた確認事項（${year}年分・${probs.length}件）</span><span>${statusOpen?"▲ たたむ":"▼ 内容を見る"}</span></button>
      ${statusOpen?`<ul>${probs.map(p=>`<li>${p}</li>`).join("")}</ul><button class="g" onclick="mode='all';tab='dash';render()">控除額・承認状況を設定する</button>`:""}`
    :`✔ ${year}年分：アプリ内の入力チェックが完了しました（税務上の適用要件は別途確認）`;
  const v=$("view");
  let html;
  if(tab=="dash")html=dash();
  else if(tab=="data")html=dataView();
  else if(tab=="glossary")html=glossView();
  else if(tab=="etax")html=etaxView();
  else if(tab=="map")html=mapView();
  else html=listView(tab);
  // 口座が未設定の経費・売上があれば、画面の上に知らせる
  // （畑モードでは、経費・売上のタブにだけ出す）
  v.innerHTML=(tab=="glossary"||tab=="data"||tab=="map"||(mode=="hat"&&tab!="expenses"&&tab!="sales")?"":acctBanner())+html;
}
function yearList(){
  const s=new Set([new Date().getFullYear(),year]);
  [...db.expenses,...db.sales].forEach(r=>r.date&&s.add(+r.date.slice(0,4)));
  db.plantings.forEach(p=>p.year&&s.add(+p.year));
  return [...s].sort((a,b)=>b-a);
}
/* 青色申告の条件チェック（不足項目の一覧を返す） */
function checkBlue(){
  const p=[];
  const ex=db.expenses.filter(e=>inYear(e.date));
  const sl=db.sales.filter(s=>inYear(s.date));
  if(db.settings.deduction==null)p.push("控除額が未設定です（「全体の集計」で申告方法に合う金額を選んでください）");
  if(!db.settings.approved)p.push("「青色申告承認申請書」の提出・承認が未確認です（集計タブの設定でチェックしてください）");
  if(!db.fields.length)p.push("田んぼ・畑が未登録です");
  if(!db.plantings.some(x=>x.year==year))p.push(`${year}年産の作付（品種）が未登録です`);
  if(!sl.length)p.push("売上・収入が1件も入力されていません");
  if(!ex.length)p.push("経費が1件も入力されていません");
  const noVendor=ex.filter(e=>!String(e.vendor||"").trim()).length;
  if(noVendor)p.push(`取引先が空欄の経費が${noVendor}件あります（帳簿には取引の相手方が必要です）`);
  const noBuyer=sl.filter(s=>(s.kind=="出荷売上（JA等）"||s.kind=="直売・相対売上")&&!String(s.buyer||"").trim()).length;
  if(noBuyer)p.push(`出荷先が空欄の売上が${noBuyer}件あります`);
  if((+db.settings.deduction||0)>=550000)p.push("55万円・65万円の控除には、貸借対照表を含む複式簿記の帳簿が必要です。このアプリだけでは満たせないため、会計ソフトを使うか控除額を10万円にしてください");
  return p;
}
$("year").onchange=e=>{year=+e.target.value;render();};
