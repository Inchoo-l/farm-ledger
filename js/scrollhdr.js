// 上のヘッダー（田んぼ／畑／全体のタブを含む）を、スクロールに合わせて出し入れする "use strict";
/* ========== ヘッダーの出し入れ ==========
   ・下へスクロールすると上へ引っ込み、上へスクロールするとまた出てくる。ページの一番上では常に出ている
   ・小さな揺れで点滅しないよう、一定の距離（THRESHOLD）以上動いたときだけ切り替える
   ・ヘッダーは position:sticky のまま transform で動かすので、場所は変わらず、下の内容はガタつかない
   ・入力画面（ダイアログ）が開いている間は動かさない（閉じたあと、今のスクロール位置に合わせ直す）
   ・キーボード操作でヘッダーの中にフォーカスが入ったときは、出す */
(function(){
  const THRESHOLD=10;   // この距離（px）以上スクロールしたときだけ切り替える
  const TOP=8;          // これより上は「ページの一番上」とみなして、常に出す
  let lastY=0,hidden=false,ticking=false;
  const hdr=()=>document.querySelector("header");
  const dlgOpen=()=>{const d=document.getElementById("dlg");return !!(d&&d.open);};
  function set(h){
    try{
      if(h===hidden)return;
      const el=hdr();if(!el)return;
      hidden=h;
      el.classList.toggle("hdr-hide",h);
    }catch(e){console.error(e);}
  }
  function update(){
    ticking=false;
    try{
      if(dlgOpen())return;                         // 入力中は動かさない
      const y=Math.max(0,window.pageYOffset||document.documentElement.scrollTop||0);
      if(y<=TOP){set(false);lastY=y;return;}        // 一番上（iPhone の引っ張りで y がマイナスになる場合も含む）
      const d=y-lastY;
      if(Math.abs(d)<THRESHOLD)return;              // 小さな揺れは無視（lastY は動かさない＝少しずつの移動も積み上げて判定）
      set(d>0);                                    // 下へ＝隠す／上へ＝出す
      lastY=y;
    }catch(e){console.error(e);}
  }
  window.addEventListener("scroll",()=>{if(!ticking){ticking=true;requestAnimationFrame(update);}},{passive:true});
  // ヘッダーの中にキーボードでフォーカスが入ったら出す
  document.addEventListener("focusin",e=>{try{const el=hdr();if(el&&el.contains(e.target))set(false);}catch(_){}});
  // 入力画面を閉じたら、今のスクロール位置に合わせ直す
  document.addEventListener("close",e=>{if(e.target&&e.target.id=="dlg"){lastY=window.pageYOffset||0;update();}},true);
  // モード切替などでページの高さが変わって一番上に戻ったときも、出す
  window.addEventListener("resize",()=>{if((window.pageYOffset||0)<=TOP)set(false);});
})();
