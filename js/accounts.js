"use strict";
// 口座連動（残高の計算・口座の未設定チェック）
/* ===== 口座連動：経費は口座から引き落とし、売上・収入は口座に加算する =====
   現在の残高 ＝ 開始残高 ＋ その口座に紐づく収入 － その口座に紐づく経費（全期間）
   残高そのものは書き換えず、記録の追加・編集・削除のたびに計算し直す */
function acctBal(a){
  try{
    const inc=db.sales.filter(s=>s.accountId==a.id&&!NOCASH.includes(s.kind)).reduce((t,r)=>t+(+r.amount||0),0);
    const out=db.expenses.filter(e=>e.accountId==a.id).reduce((t,r)=>t+expAmt(r),0);
    return (+a.balance||0)+inc-out;
  }catch(e){return +a.balance||0;}
}
const totalBal=()=>db.accounts.reduce((s,a)=>s+acctBal(a),0);
const hasAcct=r=>db.accounts.some(a=>a.id==r.accountId);
const acctOpts=sel=>db.accounts.map(a=>`<option value="${a.id}" ${a.id==sel?"selected":""}>${esc(a.name)}（残高 ${yen(acctBal(a))}円）</option>`).join("");
// 口座が未設定（または削除済みの口座を指している）経費・売上。家事消費・事業消費はお金が動かないので対象外
function unassigned(){
  try{
    return{exp:db.expenses.filter(e=>!hasAcct(e)),
           sal:db.sales.filter(s=>!NOCASH.includes(s.kind)&&!hasAcct(s))};
  }catch(e){return{exp:[],sal:[]};}
}
function acctBanner(){
  const u=unassigned(), n=u.exp.length+u.sal.length;
  if(!n)return "";
  const act=db.accounts.length
    ?`<button class="b" onclick="assignAcct()">口座を選んで一括で割り当てる</button>`
    :`<button class="b" onclick="tab='accounts';render()">先に口座を登録する</button>`;
  return `<div class="card" style="border:2px solid var(--warn)"><b class="warn">⚠ 口座が未設定の記録が${n}件あります</b>（経費${u.exp.length}件・売上${u.sal.length}件）
    <p class="hint">口座の残高に反映されていません。割り当てると、その口座から引き落とし／その口座に加算されます。あとから1件ずつ「編集」で口座を変えることもできます。</p>${act}</div>`;
}
