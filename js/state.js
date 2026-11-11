"use strict";
// データの保存・読み込み（localStorage）
/* ========== データ ========== */
const KEY="agri-ledger-v1";
const DB_LISTS=["fields","plantings","expenses","sales","assets","accounts","plots"]; // id を持つ記録の一覧
let db=load();
function load(){
  try{const s=localStorage.getItem(KEY);if(s)return fixDb(JSON.parse(s));}catch(e){console.error(e);}
  return empty();
}
// 読み込んだデータ（ブラウザの保存分・バックアップ・共有ファイル）を、アプリが扱える形に整える。
// 一覧が配列でない・設定が無いなど、壊れた部分は空の値に直す（画面全体が動かなくなるのを防ぐ）
function fixDb(o){
  const d=Object.assign(empty(),o&&typeof o=="object"?o:{});
  DB_LISTS.forEach(k=>{d[k]=Array.isArray(d[k])?d[k].filter(r=>r&&typeof r=="object"):[];});
  if(!d.settings||typeof d.settings!="object")d.settings=empty().settings;
  if(!d.cropColors||typeof d.cropColors!="object")d.cropColors={};
  // 次に使う番号(seq)は、すでに使われている番号より必ず大きくする（番号の重複を防ぐ）
  const maxId=Math.max(0,...DB_LISTS.flatMap(k=>d[k].map(r=>+r.id||0)));
  d.seq=Math.max(+d.seq||1,maxId+1);
  return d;
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
