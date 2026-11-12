// データの保存・読み込み（localStorage） "use strict";
/* ========== データ ========== */
const KEY="agri-ledger-v1";
const localSave={at:null,error:""};
let db=load();
if(db.backupDirty===undefined)db.backupDirty=!!db.dirty;
function load(){
  try{const s=localStorage.getItem(KEY);if(s)return Object.assign(empty(),JSON.parse(s));}catch(e){}
  return empty();
}
function empty(){return{fields:[],plantings:[],expenses:[],sales:[],assets:[],accounts:[],settings:{deduction:null},plots:[],cropColors:{},yearly:{},lastBackup:null,seq:1};}
function persistLocal(){
  try{
    localStorage.setItem(KEY,JSON.stringify(db));
    localSave.at=new Date();localSave.error="";
    return true;
  }catch(e){
    localSave.error="この端末への保存に失敗しました。画面を閉じずにバックアップを保存してください。";
    return false;
  }
}
// 管理用の項目とキーの並び順を除き、帳簿の内容を比較する（同じ版数の競合も検出）。
function ledgerSignature(data){
  const o=Object.assign(empty(),data);
  for(const k of ["rev","dirty","backupDirty","lastBackup","_backup"])delete o[k];
  return JSON.stringify(o,(k,v)=>v&&typeof v=="object"&&!Array.isArray(v)
    ?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
}
// clean=true: 復元直後。共有ファイルへ反映されるまでは dirty を残す。
// remote=true: 共有ファイルから読み込んだ内容の保存（版数を進めず、ファイルへの書き戻しもしない）
function save(clean,remote,noHist){
  if(!remote&&!noHist)pushHist(); // 変更前の状態を「元に戻す」用に残す
  if(!remote)db.rev=(db.rev||0)+1; // 他のパソコンとの更新の前後を判断するための版数
  db.dirty=!remote;
  db.backupDirty=!clean;
  persistLocal();
  if(!remote)queueWrite();
}
// ダウンロード要求が成功した時点を記録する。OS側での保存完了はブラウザから確認できない。
function recordBackup(snapshot){
  db.lastBackup=snapshot.lastBackup;
  db.backupDirty=ledgerSignature(db)!==ledgerSignature(snapshot);
  persistLocal();updateSyncUI();
}
function uid(){
  // 古いバックアップの連番が欠けていても、登録済みの番号を再利用しない。
  let next=Number.isSafeInteger(+db.seq)&&+db.seq>0?+db.seq:1;
  for(const k of ["fields","plots","plantings","accounts","expenses","sales","assets"]){
    for(const r of db[k]||[]){if(Number.isSafeInteger(+r.id)&&+r.id>=next)next=+r.id+1;}
  }
  if(!Number.isSafeInteger(next)||!Number.isSafeInteger(next+1))throw new Error("登録番号の上限に達しました");
  db.seq=next+1;return next;
}
