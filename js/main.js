"use strict";
// 起動処理（閉じる前の警告・最初の描画）
// 端末への保存失敗や共有ファイルへの未反映があるときだけ、閉じる前に知らせる。
window.addEventListener("beforeunload",e=>{
  if(localSave.error||(sync.fh&&db.dirty)){e.preventDefault();e.returnValue="";}
});

render();
syncInit();
