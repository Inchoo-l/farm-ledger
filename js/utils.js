"use strict";
// 共通の小さな道具（日付・金額・文字の安全化など）
/* ========== ユーティリティ ========== */
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}; // 端末の日付（日本時間のずれ防止）
const yen=n=>(Math.round(n||0)).toLocaleString("ja-JP");
// 数量・単価は金額合計と違い、小数を保持して表示する。
const numberText=(c,v)=>c.step?Number(v).toLocaleString("ja-JP",{maximumFractionDigits:20}):yen(v);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const $=id=>document.getElementById(id);
let year=new Date().getFullYear(), tab="dash";
const inYear=d=>d&&d.slice(0,4)==String(year);
const expAmt=e=>Number(e.amount)||0;
// 作付に紐づいていない記録か（紐づけ先の作付がすでに削除されている場合も「共通」として扱う）
const noPlanting=r=>!r.plantingId||!db.plantings.some(p=>p.id==r.plantingId);
// 日付の新しい順（同じ日付なら、あとから入力したものを上に）。編集や再描画のたびに並びが変わらないようにする
const byDateDesc=(a,b)=>String(b.date||"").localeCompare(String(a.date||""))||(+b.id||0)-(+a.id||0);
