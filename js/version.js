"use strict";
// アプリのバージョン（番号を変えるのはこのファイルだけ。変更内容は「更新履歴.md」に書く）
/* ========== バージョン ========== */
// 番号の付け方（左から 大.中.小）
//   大：保存データの形が変わるなど、古いバックアップをそのまま読めなくなる変更・全体の作り直し
//   中：新しい機能や画面の追加、操作のしかたが変わる変更
//   小：不具合の修正、見た目や文言の小さな調整、中身の整理
const APP_NAME="帳簿アプリ";
const APP_VERSION="1.2.1";
// 画面に出す文字（例：帳簿アプリ Ver.1.2.1）。番号の形がおかしいときは、名前だけを返す
function appVersionText(){
  if(!/^\d+\.\d+\.\d+$/.test(APP_VERSION)){
    console.error("バージョンの形が正しくありません（例：1.2.3）",APP_VERSION);
    return APP_NAME;
  }
  return `${APP_NAME} Ver.${APP_VERSION}`;
}
// 画面の下にバージョンを出す。表示先が無い・書き込めないときも、アプリ本体は止めない
function showAppVersion(){
  try{
    const el=document.getElementById("appVer");
    if(!el)return false;
    el.textContent=appVersionText();
    return true;
  }catch(e){
    console.error("バージョンを表示できませんでした",e);
    return false;
  }
}
