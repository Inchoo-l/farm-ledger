"use strict";
// 減価償却の計算（定額法）
/* ========== 減価償却（定額法） ========== */
function depreciation(a,y){
  const cost=+a.cost||0, life=+a.life||0;
  const none={dep:0,biz:0,rest:cost,rate:0,months:0};
  // 取得日は「YYYY-MM-DD」の文字から年と月を取り出す（new Date() は時差で前日になることがあるため使わない）
  const m=/^(\d{4})-(\d{2})/.exec(String(a.acquireDate||""));
  if(!m||!(life>0)||!(cost>0))return none;
  const sy=+m[1], sm=+m[2];
  if(y<sy)return none;
  // 国の償却率表（定額法）は 1÷耐用年数 を小数第3位まで「切り上げ」た値（例：3年=0.334、9年=0.112、12年=0.084）
  const rate=Math.ceil(1000/life-1e-9)/1000;
  let acc=0,dep=0,mo=0;
  for(let yy=sy;yy<=y;yy++){
    const months=yy==sy?13-sm:12;
    let x=Math.floor(cost*rate*months/12);
    if(acc+x>cost-1)x=Math.max(0,cost-1-acc); // 最後は備忘価額の1円を残す
    acc+=x;if(yy==y){dep=x;mo=months;}
  }
  const ratio=Math.max(0,Math.min(100,a.ratio===""||a.ratio==null?100:+a.ratio||0))/100;
  return{dep,biz:Math.round(dep*ratio),rest:cost-acc,rate,months:mo};
}
