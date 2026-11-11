"use strict";
// 元に戻す／やり直す（Ctrl+Z／Ctrl+Y）とメッセージ表示
/* ========== 元に戻す／やり直す（Ctrl+Z／Ctrl+Y） ==========
   データを保存するたびに、直前の状態の写し（スナップショット）を残す。
   版数・バックアップ日などの管理用の値は、写しに含めない（変化とみなさない）。 */
const hist={undo:[],redo:[],last:null,max:50};
const snapOf=()=>JSON.stringify(db,(k,v)=>(k==="rev"||k==="dirty"||k==="lastBackup")?undefined:v);
hist.last=snapOf();
function pushHist(){
  const s=snapOf();
  if(s===hist.last)return; // 中身が変わっていない（バックアップ操作など）
  hist.undo.push(hist.last);
  if(hist.undo.length>hist.max)hist.undo.shift();
  hist.redo=[];
  hist.last=s;
}
function resetHist(){hist.undo=[];hist.redo=[];hist.last=snapOf();}
function applySnap(s){
  const o=JSON.parse(s), keep={rev:db.rev||0,seq:db.seq,lastBackup:db.lastBackup};
  db=fixDb(o);
  db.seq=Math.max(keep.seq||1,db.seq||1); // 取り消しても、使った番号を再利用しない
  db.lastBackup=keep.lastBackup;db.rev=keep.rev;
  hist.last=s;
  save(false,false,true); // 履歴には積まず、共有ファイルへは書き込む
  render();
}
function undo(){
  if(document.getElementById("dlg").open||!hist.undo.length)return;
  hist.redo.push(hist.last);applySnap(hist.undo.pop());toast("↩ 元に戻しました");
}
function redo(){
  if(document.getElementById("dlg").open||!hist.redo.length)return;
  hist.undo.push(hist.last);applySnap(hist.redo.pop());toast("↪ やり直しました");
}
function updateUndoUI(){
  const u=document.getElementById("undoBtn"),r=document.getElementById("redoBtn");
  if(u){u.disabled=!hist.undo.length;u.title=hist.undo.length?`直前の変更を取り消します（あと${hist.undo.length}回）`:"取り消せる変更はありません";}
  if(r){r.disabled=!hist.redo.length;r.title=hist.redo.length?"取り消した変更をやり直します":"やり直せる変更はありません";}
}
let toastT=null;
function toast(msg){
  const t=document.getElementById("toast");if(!t)return;
  t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>{t.hidden=true;},2000);
}
// キーボード：Ctrl+Z で元に戻す、Ctrl+Y（または Ctrl+Shift+Z）でやり直す。
// 文字を入力している欄では、ブラウザ標準の文字の取り消しを優先する
document.addEventListener("keydown",e=>{
  if(!(e.ctrlKey||e.metaKey)||e.altKey)return;
  const t=e.target,tag=t&&t.tagName;
  if(tag=="INPUT"||tag=="TEXTAREA"||tag=="SELECT"||(t&&t.isContentEditable))return;
  const k=(e.key||"").toLowerCase();
  if(k=="z"&&!e.shiftKey){e.preventDefault();undo();}
  else if(k=="y"||(k=="z"&&e.shiftKey)){e.preventDefault();redo();}
});
