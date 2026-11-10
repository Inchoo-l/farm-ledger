// 経費の絞り込みと検索（経費タブの上の検索ボックスと絞り込みパネル） "use strict";
/* ========== 経費の検索・絞り込み ==========
   ・絞り込み（日付・勘定科目・摘要・品種・取引先・金額・口座・作付・インボイス）は、すべて「かつ(AND)」で組み合わせる
   ・検索は、経費のすべての項目（メモなど一覧に出していない項目も）が対象。スペースで区切ると、すべての語を含む行だけ（AND）
   ・全角／半角・大文字／小文字・ひらがな／カタカナの違いは同じものとして探す。金額はカンマの有無どちらでも探せる
   ・ヒットした部分には <mark> を付ける。表示用の文字は、1区切りずつ HTML エスケープしてから <mark> で包む
     （正規表現は使わず indexOf で探すので、「.」「(」などの記号が入っても誤動作しない）
   ・条件は画面を切り替えたり、編集・削除したあとも保つ（ページを開き直すと戻る）
   ・年分の絞り込み（ヘッダーの「年分」）とも併用する */
const expF={q:"",from:"",to:"",cats:[],desc:"",variety:"",vendor:"",min:"",max:"",acct:"",plant:"",inv:"",open:null};

/* ----- 文字のそろえ方 ----- */
// 1区切り（半角カナ＋濁点などは2文字で1区切り）を、そろえた文字にする
function expNormUnit(u){
  let s=u;
  try{s=u.normalize("NFKC");}catch(e){}   // 全角英数・半角カナなどを標準の形に
  s=s.toLowerCase();                       // 大文字→小文字
  return s.replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60)); // カタカナ→ひらがな
}
// 文字列を、そろえた文字列に直し、各文字が元の文字列のどこにあったかも返す（<mark> の位置を元の文字に戻すため）
// dropComma=true のときは、カンマを取り除く（金額用）
function expNormMap(src,dropComma){
  const s=String(src??""),chars=Array.from(s);
  let norm="",pos=0;
  const from=[],to=[]; // そろえた文字ごとの、元の文字列での始まりと終わり
  for(let i=0;i<chars.length;i++){
    let u=chars[i];
    if(i+1<chars.length&&(chars[i+1]==="ﾞ"||chars[i+1]==="ﾟ")){u+=chars[i+1];i++;} // 半角カナ＋濁点
    const start=pos;pos+=u.length;
    if(dropComma&&(u===","||u==="，"))continue;
    const n=expNormUnit(u);
    for(const ch of n){for(let k=0;k<ch.length;k++){norm+=ch[k];from.push(start);to.push(pos);}}
  }
  return{norm,from,to};
}
// 検索語を、スペース（全角も可）で区切る
function expTokens(q){
  try{return expNormMap(String(q||"").replace(/[\s　]+/g," ").trim()).norm.split(" ").filter(Boolean);}catch(e){return [];}
}
// 元の文字列の中で、語(tokens)がある範囲 [始まり,終わり) を集める
function expRanges(text,tokens,numeric){
  const m=expNormMap(text,numeric),r=[];
  tokens.forEach(t0=>{
    const t=numeric?t0.replace(/,/g,""):t0;
    if(!t)return;
    let i=m.norm.indexOf(t);
    while(i>=0){r.push([m.from[i],m.to[i+t.length-1]]);i=m.norm.indexOf(t,i+t.length);}
  });
  return r.sort((a,b)=>a[0]-b[0]);
}
// 文字列を HTML にして、ranges の部分を <mark> で包む
function expMarkHtml(text,ranges){
  const s=String(text??"");
  if(!ranges.length)return esc(s);
  let out="",at=0;
  ranges.forEach(([a,b])=>{
    if(b<=at)return;           // 重なった範囲は、先に出した分に含める
    a=Math.max(a,at);
    out+=esc(s.slice(at,a))+"<mark>"+esc(s.slice(a,b))+"</mark>";
    at=b;
  });
  return out+esc(s.slice(at));
}

/* ----- 経費1件の「項目ごとの文字」（画面に出す形と同じ） ----- */
function expText(c,r,forSearch){ // forSearch=true のときは、検索用に言葉を足す（インボイスのチェックなど）
  const v=r[c.k];
  if(c.t=="field"){const f=db.fields.find(x=>x.id==v);return f?f.name:"";}
  if(c.t=="plot"){const p=(db.plots||[]).find(x=>x.id==v);return p?p.name:"";}
  if(c.t=="planting"){const p=db.plantings.find(x=>x.id==v);return p?plantLabel(p):"共通";}
  if(c.t=="account"){const a=db.accounts.find(x=>x.id==v);return a?a.name:"";}
  if(c.t=="check")return v?(forSearch?"✔ インボイス 適格請求書":"✔"):"";
  if(c.t=="number"&&v!==""&&v!=null)return yen(v);
  return v==null?"":String(v);
}
const expIsNum=c=>c.t=="number"; // 金額・数量・単価（カンマの有無どちらでも探す）
const expShown=()=>TABLE_COLS.expenses; // 一覧に出している項目

/* ----- 検索 ----- */
const expSearchActive=()=>expTokens(expF.q).length>0;
// 行が、すべての語を（どれかの項目に）含むか
function expRowMatch(r,tokens){
  const cols=ENT.expenses.cols.filter(c=>!c.calc);
  return tokens.every(t=>cols.some(c=>{
    const num=expIsNum(c),text=num&&r[c.k]!==""&&r[c.k]!=null?String(r[c.k]):expText(c,r,true);
    return expRanges(text,[t],num).length>0||(num&&expRanges(expText(c,r),[t],true).length>0);
  }));
}
// 一覧の1マスの表示（検索中は <mark> 付き）。検索していなければ null を返して、通常の表示にまかせる
function expCellMark(c,r){
  try{
    const tokens=expTokens(expF.q);
    if(!tokens.length||!expShown().includes(c.k))return null;
    if(c.t=="check"){ // インボイスは「✔」のまま、検索にヒットしたときだけマーカーを付ける
      return r[c.k]&&expRanges(expText(c,r,true),tokens,false).length?"<mark>✔</mark>":null;
    }
    const num=expIsNum(c),text=expText(c,r);
    let out=expMarkHtml(text,expRanges(text,tokens,num));
    if(c.k=="desc"){ // 摘要のマスの下に、一覧に出していない項目（メモなど）のヒット箇所を出す
      const hits=expHiddenHits(r,tokens);
      if(hits)out+=hits;
    }
    return hy(out);
  }catch(e){console.error(e);return null;}
}
// 一覧に出していない項目で語がヒットしたもの →「メモ：…」の形
function expHiddenHits(r,tokens){
  const shown=expShown();
  const lines=ENT.expenses.cols.filter(c=>!c.calc&&!shown.includes(c.k)).map(c=>{
    const num=expIsNum(c),raw=r[c.k];
    if(raw===""||raw==null)return "";
    const text=expText(c,r),rg=expRanges(text,tokens,num);
    if(!rg.length)return "";
    // 長い文は、最初のヒットの前後だけを出す
    let a=0,b=text.length,pre="",post="";
    if(text.length>70){a=Math.max(0,rg[0][0]-20);b=Math.min(text.length,rg[0][0]+50);pre=a>0?"…":"";post=b<text.length?"…":"";}
    const sub=text.slice(a,b),rr=rg.map(x=>[x[0]-a,x[1]-a]).filter(x=>x[1]>0&&x[0]<sub.length).map(x=>[Math.max(0,x[0]),Math.min(sub.length,x[1])]);
    const label=c.l.split("（")[0].split(" ※")[0];
    return `<div class="hit">${esc(label)}：${pre}${expMarkHtml(sub,rr)}${post}</div>`;
  }).filter(Boolean);
  return lines.join("");
}

/* ----- 絞り込み ----- */
const expNormStr=s=>expNormMap(s).norm;
function expFilterRows(rows){
  const tokens=expTokens(expF.q);
  const dq=expNormStr(expF.desc.trim()),vq=expNormStr(expF.variety.trim()),nq=expNormStr(expF.vendor.trim());
  const min=expF.min===""?null:+expF.min,max=expF.max===""?null:+expF.max;
  return rows.filter(r=>{
    if(expF.from&&!(r.date&&r.date>=expF.from))return false;
    if(expF.to&&!(r.date&&r.date<=expF.to))return false;
    if(expF.cats.length&&!expF.cats.includes(r.category))return false;
    if(dq&&!expNormStr(r.desc).includes(dq))return false;
    if(vq&&!expNormStr(r.variety).includes(vq))return false;
    if(nq&&!expNormStr(r.vendor).includes(nq))return false;
    const amt=expAmt(r);
    if(min!=null&&!isNaN(min)&&amt<min)return false;
    if(max!=null&&!isNaN(max)&&amt>max)return false;
    if(expF.acct==="none"){if(hasAcct(r))return false;}
    else if(expF.acct!==""&&String(r.accountId)!==expF.acct)return false;
    if(expF.plant==="common"){if(r.plantingId)return false;}
    else if(expF.plant!==""&&String(r.plantingId)!==expF.plant)return false;
    if(expF.inv==="yes"&&!r.invoice)return false;
    if(expF.inv==="no"&&r.invoice)return false;
    if(tokens.length&&!expRowMatch(r,tokens))return false;
    return true;
  });
}
// 条件が何個入っているか（絞り込みパネルの見出しに出す）
function expCount(){
  return ["q","from","to","desc","variety","vendor","min","max","acct","plant","inv"].filter(k=>String(expF[k]).trim()!=="").length+(expF.cats.length?1:0);
}
const expActive=()=>expCount()>0;

/* ----- 画面 ----- */
// 年分で絞った経費（今のモードのもの）
const expYearRows=()=>[...db.expenses.filter(r=>inYear(r.date)&&inMode(r))].sort((a,b)=>a.date<b.date?1:-1);

// 件数・合計・表（検索や絞り込みのたびに、ここだけ描き直す。入力欄は触らないので、文字を打ち続けられる）
function expResult(){
  const all=expYearRows(),rows=expFilterRows(all);
  const cols=TABLE_COLS.expenses.map(k=>ENT.expenses.cols.find(c=>c.k==k));
  const total=rows.reduce((s,r)=>s+(+r.amount||0),0);
  const head=`<div class="bar"><span><b>${year}年 合計：${yen(total)} 円</b>（${rows.length}件${expActive()?`／全${all.length}件中`:""}）</span></div>`;
  const body=rows.map(r=>`<tr>${cols.map(c=>`<td class="${c.t=="number"?"n":""}" data-label="${esc(c.l.split("（")[0].split(" ※")[0])}">${cell("expenses",c,r)}</td>`).join("")}
      <td class="act"><button class="g" onclick="edit('expenses',null,${r.id})">複製</button> <button class="g" onclick="edit('expenses',${r.id})">編集</button> <button class="g d" onclick="del('expenses',${r.id})">削除</button></td></tr>`).join("");
  const empty=all.length
    ?`<tr><td colspan="${cols.length+1}" class="hint">条件に合う経費がありません。<button class="g" onclick="expClear()">条件をクリア</button></td></tr>`
    :`<tr><td colspan="${cols.length+1}" class="hint">データがありません</td></tr>`;
  return `${head}<div class="scroll"><table class="lt"><tr class="hd">${cols.map(c=>`<th class="${c.t=="number"?"n":""}">${c.l.split("（")[0].split(" ※")[0]}${c.g?q(c.g):""}</th>`).join("")}<th></th></tr>${body||empty}</table></div>`;
}

function expPanel(){
  const open=expF.open==null?!mapMobile():expF.open; // 初めは、PCは開く・スマホは閉じる
  const n=expCount();
  const plantings=db.plantings.filter(inMode).sort((a,b)=>(b.year||0)-(a.year||0));
  const inp=(k,label,type,extra)=>`<label class="fl">${label}<input type="${type||"text"}" value="${esc(expF[k])}" ${extra||""} oninput="expSet('${k}',this.value)" onchange="expSet('${k}',this.value)"></label>`;
  return `<div class="expsearch">
    <div class="sbox"><input id="expQ" type="search" placeholder="🔍 検索（メモ等も対象・スペースでAND）" value="${esc(expF.q)}" autocomplete="off" aria-label="経費を検索"
      oninput="expSet('q',this.value)" oncompositionend="expSet('q',this.value)">
      ${expActive()?`<button class="g" onclick="expClear()">条件をクリア</button>`:""}</div>
    <details id="expDet" ${open?"open":""} ontoggle="expF.open=this.open">
      <summary>絞り込み${n?`（${n}件の条件）`:""}</summary>
      <div class="expf">
        ${inp("from","日付（開始）","date")}${inp("to","日付（終了）","date")}
        ${inp("desc","摘要（一部でも）")}${inp("variety","品種（一部でも）")}${inp("vendor","取引先（一部でも）")}
        ${inp("min","金額（最小）","number",'inputmode="numeric" min="0"')}${inp("max","金額（最大）","number",'inputmode="numeric" min="0"')}
        <label class="fl">口座<select onchange="expSet('acct',this.value)"><option value="">すべて</option><option value="none" ${expF.acct==="none"?"selected":""}>未設定</option>${db.accounts.map(a=>`<option value="${a.id}" ${String(a.id)===expF.acct?"selected":""}>${esc(a.name)}</option>`).join("")}</select></label>
        <label class="fl">作付<select onchange="expSet('plant',this.value)"><option value="">すべて</option><option value="common" ${expF.plant==="common"?"selected":""}>共通（作付に紐づけなし）</option>${plantings.map(p=>`<option value="${p.id}" ${String(p.id)===expF.plant?"selected":""}>${esc(plantLabel(p))}</option>`).join("")}</select></label>
        <label class="fl">インボイス<select onchange="expSet('inv',this.value)"><option value="">すべて</option><option value="yes" ${expF.inv==="yes"?"selected":""}>あり</option><option value="no" ${expF.inv==="no"?"selected":""}>なし</option></select></label>
      </div>
      <div class="expcats"><span class="hint">勘定科目（複数選べます）：</span>${CATS.map(c=>`<label class="chk"><input type="checkbox" ${expF.cats.includes(c)?"checked":""} onchange="expToggleCat(this.dataset.c,this.checked)" data-c="${esc(c)}"> ${esc(c)}</label>`).join("")}</div>
      <p class="hint">条件は「かつ」で組み合わせます。ヘッダーの「年分」とも併用されます（${year}年の経費の中から探します）。</p>
    </details></div>`;
}

function expView(){
  // 田んぼ⇄畑でモードを切り替えたとき、そのモードにない作付の絞り込みが残っていたら外す
  if(expF.plant&&expF.plant!=="common"&&!db.plantings.some(p=>inMode(p)&&String(p.id)===expF.plant))expF.plant="";
  return `<div class="card"><div class="bar"><h2 style="margin:0">${ENT.expenses.title}</h2>
    <button class="b" onclick="edit('expenses')">＋ 追加</button>
    <button class="g" onclick="csv('expenses')">CSV出力（${year}年）</button></div>
    <p class="hint">経費は、選んだ口座から引き落とされます。「複製」で同じ内容を日付を変えて追加できます。苗の購入は勘定科目「種苗費」で登録し、品種・数量・単価・購入先を入れてください。作付と紐づけると品種別・圃場別の原価が計算されます。</p>
    ${expPanel()}
    <div id="expRes">${expResult()}</div></div>`;
}

/* ----- 入力に合わせて、結果だけ更新する ----- */
let expTimer=null;
function expRefresh(){
  try{
    const res=$("expRes");
    if(!res){render();return;}
    res.innerHTML=expResult();
    const det=$("expDet"),sm=det&&det.querySelector("summary");
    if(sm){const n=expCount();sm.textContent="絞り込み"+(n?`（${n}件の条件）`:"");}
    // 「条件をクリア」ボタンの出し入れ
    const box=document.querySelector(".expsearch .sbox"),btn=box&&box.querySelector("button");
    if(box&&expActive()&&!btn)box.insertAdjacentHTML("beforeend",`<button class="g" onclick="expClear()">条件をクリア</button>`);
    if(box&&!expActive()&&btn)btn.remove();
  }catch(e){console.error(e);alert("経費の検索表示を更新できませんでした："+(e.message||e));}
}
function expSet(k,v){
  try{
    if(!(k in expF))return;
    expF[k]=v;
    clearTimeout(expTimer);
    expTimer=setTimeout(expRefresh,k=="q"?120:60); // 打っている途中は少し待ってから反映する
  }catch(e){alert("条件を保存できませんでした："+(e.message||e));}
}
function expToggleCat(c,on){
  try{
    const s=new Set(expF.cats);on?s.add(c):s.delete(c);
    expF.cats=CATS.filter(x=>s.has(x)); // 科目の並び順をそろえる
    expRefresh();
  }catch(e){alert("条件を保存できませんでした："+(e.message||e));}
}
function expClear(){
  try{
    const open=expF.open;
    Object.assign(expF,{q:"",from:"",to:"",cats:[],desc:"",variety:"",vendor:"",min:"",max:"",acct:"",plant:"",inv:"",open});
    render();
  }catch(e){alert("条件をクリアできませんでした："+(e.message||e));}
}
