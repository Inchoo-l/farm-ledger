// 減価償却の計算（定額法） "use strict";
/* ========== 減価償却（定額法） ========== */
function depreciation(a,y){
  const d=new Date(a.acquireDate);if(isNaN(d))return{dep:0,biz:0,rest:a.cost};
  const sy=d.getFullYear(), sm=d.getMonth()+1;
  if(y<sy)return{dep:0,biz:0,rest:a.cost};
  const rate=Math.round(1000/a.life)/1000; // 国の償却率表と同じく小数第3位まで
  let acc=0,dep=0,mo=0;
  for(let yy=sy;yy<=y;yy++){
    const months=yy==sy?13-sm:12;
    let x=Math.floor(a.cost*rate*months/12);
    if(acc+x>a.cost-1)x=Math.max(0,a.cost-1-acc);
    acc+=x;if(yy==y){dep=x;mo=months;}
  }
  const ratio=(a.ratio===""?100:a.ratio)/100;
  return{dep,biz:Math.round(dep*ratio),rest:a.cost-acc,rate,months:mo};
}
