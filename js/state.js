// データの保存・読み込み（localStorage） "use strict";
/* ========== データ ========== */
const KEY="agri-ledger-v1";
let db=load();
function load(){
  try{const s=localStorage.getItem(KEY);if(s)return Object.assign(empty(),JSON.parse(s));}catch(e){}
  return empty();
}
function empty(){return{fields:[],plantings:[],expenses:[],sales:[],assets:[],accounts:[],settings:{deduction:650000},plots:[],cropColors:{},lastBackup:null,seq:1};}
function persistLocal(){try{localStorage.setItem(KEY,JSON.stringify(db));}catch(e){alert("保存に失敗しました。バックアップをダウンロードしてください。");}}
// clean=true: バックアップ直後（未保存の変更なし）。それ以外は変更ありとして記録
// remote=true: 共有ファイルから読み込んだ内容の保存（版数を進めず、ファイルへの書き戻しもしない）
function save(clean,remote,noHist){
  if(!remote&&!noHist)pushHist(); // 変更前の状態を「元に戻す」用に残す
  if(!remote)db.rev=(db.rev||0)+1; // 他のパソコンとの更新の前後を判断するための版数
  db.dirty=!clean;
  persistLocal();
  if(!remote)queueWrite();
}
const uid=()=>db.seq++;
