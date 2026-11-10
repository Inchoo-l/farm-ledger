// 起動処理（閉じる前の警告・最初の描画） "use strict";
// JSONに保存していない変更がある状態でタブ/ブラウザを閉じようとしたら警告
window.addEventListener("beforeunload",e=>{
  if(db.dirty){e.preventDefault();e.returnValue="";}
});

render();
syncInit();
