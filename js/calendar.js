"use strict";
// 入力画面のカレンダー
/* ===== 入力画面のカレンダー（日付欄を押すと下に開き、日を押すと入力されて閉じる） ===== */
function calRender(inp,box,ym){
  try{
    const m0=/^(\d{4})-(\d{2})-(\d{2})$/.exec(inp.value);
    const t=today();
    // 表示する年月：ボタンで指定された月 → 入力済みの日付の月 → 今月 の順
    const y=ym?ym.y:(m0?+m0[1]:+t.slice(0,4));
    const m=ym?ym.m:(m0?+m0[2]:+t.slice(5,7));
    const first=new Date(y,m-1,1).getDay(), days=new Date(y,m,0).getDate();
    const p2=n=>String(n).padStart(2,"0");
    let cells="日月火水木金土".split("").map(w=>`<span>${w}</span>`).join("")+"<span></span>".repeat(first);
    for(let d=1;d<=days;d++){
      const iso=`${y}-${p2(m)}-${p2(d)}`, dow=(first+d-1)%7;
      cells+=`<button type="button" class="${iso==inp.value?"sel ":""}${iso==t?"td ":""}${dow==0?"sun":dow==6?"sat":""}" data-d="${iso}">${d}</button>`;
    }
    box.innerHTML=`<div class="ch"><button type="button" class="g" data-n="-1">◀</button><b>${y}年${m}月</b><button type="button" class="g" data-n="1">▶</button></div>
      <div class="cg">${cells}</div>
      <div class="ch" style="margin:8px 0 0"><button type="button" class="g" data-t="1">今日</button><span style="flex:1"></span><button type="button" class="g" data-x="1">閉じる</button></div>`;
    box.hidden=false;
    box.onclick=ev=>{
      const b=ev.target.closest&&ev.target.closest("button");
      if(!b)return;
      ev.preventDefault();
      if(b.dataset.d||b.dataset.t){
        const value=b.dataset.d||today();
        if(inp.value!==value){
          inp.value=value;
          inp.dispatchEvent(new Event("input",{bubbles:true}));
          inp.dispatchEvent(new Event("change",{bubbles:true}));
        }
        box.hidden=true;
      }
      else if(b.dataset.x){box.hidden=true;}                           // 閉じる
      else if(b.dataset.n){                                            // 前月・翌月
        let ny=y,nm=m+(+b.dataset.n);
        if(nm<1){nm=12;ny--;}else if(nm>12){nm=1;ny++;}
        calRender(inp,box,{y:ny,m:nm});
      }
    };
  }catch(e){box.hidden=true;}
}
function calInit(inp,box){
  if(!inp||!box)return;
  const open=()=>calRender(inp,box);
  inp.addEventListener("focus",open);
  inp.addEventListener("click",open);
  // 手で日付を打ち込んでいる間は、カレンダーもその月に追従させる
  inp.addEventListener("input",()=>{if(!box.hidden)calRender(inp,box);});
}
