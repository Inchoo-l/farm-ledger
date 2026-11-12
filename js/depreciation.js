// 減価償却の計算（定額法） "use strict";
/* ========== 減価償却（定額法） ========== */
function depreciation(a,y){
  const cost=Number(a.cost),life=Number(a.life);
  const zero={dep:0,biz:0,rest:Number.isFinite(cost)?Math.max(0,cost):0,rate:0,months:0};
  const ratio=a.ratio===""||a.ratio==null?1:Number(a.ratio)/100;
  if(!Number.isFinite(cost)||cost<=0||!Number.isInteger(life)||life<=0||!Number.isFinite(ratio)||ratio<0||ratio>1||!Number.isInteger(y))return zero;
  const d=new Date(a.acquireDate);if(isNaN(d))return zero;
  const sy=d.getFullYear(), sm=d.getMonth()+1;
  if(y<sy)return zero;
  const rate=Math.round(1000/life)/1000; // 小数第3位まで
  let acc=0,dep=0,mo=0;
  for(let yy=sy;yy<=y;yy++){
    const months=yy==sy?13-sm:12;
    let x=Math.floor(cost*rate*months/12);
    if(acc+x>cost-1)x=Math.max(0,cost-1-acc);
    acc+=x;if(yy==y){dep=x;mo=months;}
  }
  return{dep,biz:Math.round(dep*ratio),rest:cost-acc,rate,months:mo};
}
