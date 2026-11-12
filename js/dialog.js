// 入力画面の共通部品（科目ごとの項目の出し分け・日付チェック） "use strict";
/* ========== 入力ダイアログ ========== */
// 経費の勘定科目ごとに、必要な入力項目だけを表示する
const QTY_CATS=["種苗費","素畜費","肥料費","飼料費","農具費","農薬衛生費","諸材料費","動力光熱費"]; // 数量×単価が自然な科目
const NOLINK_CATS=["租税公課","作業用衣料費","農業共済掛金","利子割引料","貸倒金","雑費"];          // 特定の作付に紐づけにくい科目
const NOINVOICE_CATS=["租税公課","農業共済掛金","利子割引料","雇人費","貸倒金"];                    // インボイスと無関係な科目
const NOPAY_CATS=["貸倒金"];                                                                       // 実際には支払いがない科目
function expShow(k,cat){
  switch(k){
    case "variety":return cat=="種苗費";
    case "qty":case "unitPrice":return QTY_CATS.includes(cat);
    case "plantingId":return !NOLINK_CATS.includes(cat);
    case "invoice":return !NOINVOICE_CATS.includes(cat);
    case "pay":return !NOPAY_CATS.includes(cat);
    default:return true;
  }
}
function applyCat(cat){
  document.querySelectorAll("#frm .fld").forEach(d=>{
    const on=expShow(d.dataset.k,cat);
    d.hidden=!on;
    d.querySelectorAll("input,select,textarea").forEach(i=>i.disabled=!on); // 無効にすると入力チェックと送信の対象外になる
  });
  const v=document.querySelector("#frm [name=variety]");
  const rq=document.querySelector("#frm .fld[data-k=variety] .rq");
  const need=cat=="種苗費";
  if(v)v.required=need;
  if(rq)rq.hidden=!need; // 種苗費のときだけ品種が必須
}
// 実在する日付（YYYY-MM-DD）かどうか（2月31日などを弾く）
function validDate(s){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if(!m)return false;
  const d=new Date(+m[1],+m[2]-1,+m[3]);
  return d.getFullYear()==+m[1]&&d.getMonth()==+m[2]-1&&d.getDate()==+m[3];
}
// HTMLの必須チェックに加え、空白だけの文字・数値の範囲・参照先も検証する。
function recordError(o,cols){
  for(const c of cols){
    const v=o[c.k],blank=v==null||String(v).trim()==="";
    if(c.req===1&&blank)return `「${c.l}」を入力してください`;
    if(blank)continue;
    if(c.t=="number"||c.t=="area"){
      if(!Number.isFinite(Number(v))||Math.abs(Number(v))>Number.MAX_SAFE_INTEGER)return `「${c.l}」に有効な数値を入力してください`;
      if(c.min!=null&&+v<c.min||c.max!=null&&+v>c.max)return `「${c.l}」が入力できる範囲を超えています`;
      if(c.t=="number"&&!c.step&&!Number.isInteger(+v))return `「${c.l}」は整数で入力してください`;
    }
    const table={field:"fields",plot:"plots",planting:"plantings",account:"accounts"}[c.t];
    if(table&&!db[table].some(r=>r.id==v))return `「${c.l}」の選択先が見つかりません。選び直してください`;
    if(c.t=="plot"&&o.fieldId&&!db.plots.some(p=>p.id==v&&p.fieldId==o.fieldId))return "選んだ区画は、この圃場に属していません";
  }
  return "";
}
// 入力画面の共通の枠：上にタイトル、中身（ここだけスクロール）、下にキャンセル／確定ボタンを常に表示
// ※Enterキーで送信されるボタンが「確定」になるよう、HTML上は確定を先に置き、見た目だけ左右を入れ替えている
function dlgFrame(title,body,okLabel){
  return `<h2>${title}</h2><div class="fbody">${body}</div>
    <div class="fbar"><button class="b" value="ok">${okLabel||"確定"}</button><button class="g" value="cancel" formnovalidate>キャンセル</button></div>`;
}
