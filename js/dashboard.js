"use strict";
// 集計画面（収支・原価計算）
/* ========== 集計 ========== */
function dash(){
  const ex=db.expenses.filter(e=>inYear(e.date)&&inMode(e));
  const sl=db.sales.filter(s=>inYear(s.date)&&inMode(s));
  const byCat={};CATS.forEach(c=>byCat[c]=0);
  ex.forEach(e=>byCat[e.category]=(byCat[e.category]||0)+expAmt(e));
  // 小作料は圃場マスタの年額も参考表示（二重計上を避けるため経費合計には含めない）
  const depRows=db.assets.filter(inMode).map(a=>({a,...depreciation(a,year)}));
  const depTotal=depRows.reduce((s,r)=>s+r.biz,0);
  // 棚卸高・専従者給与は農場全体の数字なので「全体」タブでのみ反映する
  const yv=yr();
  const inv=mode=="all"?(+yv.invClose||0)-(+yv.invOpen||0):0;
  const fam=mode=="all"?(+yv.fam||0):0;
  const exTotal=ex.reduce((s,e)=>s+expAmt(e),0)+depTotal+fam;
  const income=sl.reduce((s,r)=>s+(+r.amount||0),0)+inv;
  const ded=+db.settings.deduction||0;
  const before=income-exTotal;
  const incomeAfter=Math.max(0,before-Math.min(ded,Math.max(0,before)));
  const byKind=SALE_KINDS.map(k=>[k,sl.filter(s=>s.kind==k).reduce((s,r)=>s+(+r.amount||0),0)]);

  // 作付別原価
  const pl=db.plantings.filter(p=>p.year==year&&inMode(p));
  // 田んぼ・畑ごとの内訳は、全体モードの上の「申告用の合計との照合」（dashDivSection）に出す（同じ表を2か所に出さない）
  const common=ex.filter(noPlanting).reduce((s,e)=>s+expAmt(e),0)+depTotal;
  const totalArea=pl.reduce((s,p)=>s+(+(db.fields.find(f=>f.id==p.fieldId)||{}).area||0),0);
  const prow=pl.map(p=>{
    const f=db.fields.find(x=>x.id==p.fieldId)||{};
    const area=+f.area||0;
    const direct=ex.filter(e=>e.plantingId==p.id).reduce((s,e)=>s+expAmt(e),0);
    const share=totalArea?common*area/totalArea:0; // 共通費は面積比で按分
    const cost=direct+share;
    const rev=sl.filter(s=>s.plantingId==p.id).reduce((s,r)=>s+(+r.amount||0),0);
    const y=+p.yield||0;
    return{p,f,area,direct,share,cost,rev,y};
  });
  const warnNoLink=ex.filter(e=>e.category=="種苗費"&&noPlanting(e)).length;
  const catMax=Math.max(1,...Object.values(byCat));
  const barMax=Math.max(income,exTotal,1);
  const steps=[["1","口座を登録","お金の出し入れをする口座",db.accounts.length>0,"accounts"],
    ["2","圃場を登録","田んぼ・畑の名前と広さ",db.fields.some(inMode),"fields"],
    ["3","作付を登録","いつ・何の品種を植えたか",pl.length>0,"plantings"],
    ["4","経費を入力","買った物・払ったお金",ex.length>0,"expenses"],
    ["5","売上を入力","売った・もらったお金",sl.length>0,"sales"]];
  const stepsCard=mode=="all"?"":`<div class="card"><h2>はじめかた <span class="hint">（押すと入力画面へ進みます）</span></h2><div class="steps">
    ${steps.map(([n,t,s,done,tb])=>`<div class="step ${done?"done":""}" onclick="tab='${tb}';render()"><b>${done?"✔":n}　${t}</b><small>${s}</small></div>`).join("")}</div></div>`;

  return `
  ${stepsCard}
  ${mode=="all"?dashDivSection():""}
  <div class="card"><h2>${MODE_NAME[mode]} ${year}年分 収支の概算${mode=="all"?"（申告用の合計：田んぼ＋畑）":""}</h2>
    <div class="kpi">
      <div><small>💰 収入金額${q("収入金額")}<br>売った・もらったお金</small><b>${yen(income)} 円</b></div>
      <div><small>🧾 必要経費${q("必要経費")}<br>使ったお金</small><b>${yen(exTotal)} 円</b></div>
      <div><small>📈 差引金額${q("差引金額")}<br>収入－経費＝もうけ</small><b class="${before<0?"warn":""}">${yen(before)} 円</b></div>
      ${mode=="all"?`<div><small>🎁 青色申告特別控除${q("青色申告特別控除")}<br>もうけから引いてもらえる額</small><b>${yen(Math.min(ded,Math.max(0,before)))} 円</b></div>
      <div><small>🏛 農業所得${q("農業所得")}<br>税金の計算のもと（概算）</small><b>${yen(incomeAfter)} 円</b></div>
      <div><small>🏦 現在の貯金額${q("貯金額")}<br>${db.accounts.length}口座の合計</small><b>${yen(totalBal())} 円</b></div>`:""}
    </div>
    <div style="margin-top:12px">
      <div class="brow"><span class="l">収入</span><div class="trk"><i style="width:${income/barMax*100}%"></i></div><b>${yen(income)} 円</b></div>
      <div class="brow"><span class="l">経費</span><div class="trk"><i class="cost" style="width:${exTotal/barMax*100}%"></i></div><b>${yen(exTotal)} 円</b></div>
      <p class="hint" style="margin:4px 0 0">${before>=0?"収入のほうが多いので、もうけが出ています。":"<span class='warn'>経費のほうが多く、赤字になっています。</span>"}</p>
    </div>
    ${mode=="all"?"":`<p class="hint">青色申告特別控除と農業所得は、田んぼと畑を合算する「📋 全体」タブで確認します。</p>`}
    ${mode!="all"?"":`<p class="hint">控除額の設定：<select onchange="db.settings.deduction=+this.value;save();render()">
      ${[[650000,"65万円（e-Tax＋複式簿記）"],[550000,"55万円"],[100000,"10万円（簡易簿記）"],[0,"なし"]].map(([v,l])=>`<option value="${v}" ${v==ded?"selected":""}>${l}</option>`).join("")}</select>
      　<label style="display:inline;margin:0"><input type="checkbox" ${db.settings.approved?"checked":""} onchange="db.settings.approved=this.checked;save();render()" style="width:auto"> 青色申告承認申請書を提出し承認済み</label>${q("青色申告承認申請書")}${q("複式簿記")}
      　※概算です。実際の申告は税務署・税理士・会計ソフトで確認してください。</p>`}
    ${warnNoLink?`<p class="warn">⚠ 作付に紐づいていない「種苗費」が${warnNoLink}件あります（品種別の原価に反映されません）。</p>`:""}
  </div>

  <div class="card"><h2>収入の内訳${q("収入金額")}</h2><div class="scroll"><table>
    ${byKind.map(([k,v])=>`<tr><td>${k}</td><td class="n">${yen(v)}</td></tr>`).join("")}
    ${mode=="all"?`<tr><td>農産物の棚卸高の増減（期末－期首）${q("棚卸高")}</td><td class="n">${yen(inv)}</td></tr>`:""}
    <tr><th>合計</th><th class="n">${yen(income)}</th></tr></table></div>
    <p class="hint">家事消費（自家消費した米）や補助金・交付金も収入に含めて申告します。</p></div>

  <div class="card"><h2>経費の内訳（何にいくら使ったか）${q("勘定科目")}</h2><div class="scroll"><table>
    ${CATS.map(c=>`<tr><td>${c}${q(c)}</td><td class="n">${yen(byCat[c])}</td><td style="width:45%">${byCat[c]>0?`<span class="hb cost" style="width:${byCat[c]/catMax*100}%"></span>`:""}</td></tr>`).join("")}
    ${mode=="all"?`<tr><td>専従者給与${q("専従者給与")}</td><td class="n">${yen(fam)}</td><td></td></tr>`:""}
    <tr><td>減価償却費（事業分）${q("減価償却")}</td><td class="n">${yen(depTotal)}</td><td></td></tr>
    <tr><th>合計</th><th class="n">${yen(exTotal)}</th><th></th></tr></table></div></div>

  <div class="card"><h2>作付別 原価計算（${year}年産）${q("原価")}</h2><div class="scroll"><table>
    <tr><th>作付</th><th class="n">面積(a)</th><th class="n">直接費${q("直接費")}</th><th class="n">共通費配賦${q("按分")}</th><th class="n">原価計</th><th class="n">10aあたり原価</th><th class="n">収量(kg)</th><th class="n">反収(kg/10a)${q("反収")}</th><th class="n">60kgあたり原価${q("60kgあたり原価")}</th><th class="n">売上紐づけ</th></tr>
    ${prow.map(r=>`<tr><td>${esc(plantLabel(r.p))}</td><td class="n">${r.area?esc(r.area):"-"}</td><td class="n">${yen(r.direct)}</td><td class="n">${yen(r.share)}</td><td class="n"><b>${yen(r.cost)}</b></td>
      <td class="n">${r.area?yen(r.cost/r.area*10):"-"}</td><td class="n">${r.y?yen(r.y):"-"}</td><td class="n">${r.area&&r.y?yen(r.y/r.area*10):"-"}</td>
      <td class="n">${r.y?yen(r.cost/r.y*60):"-"}</td><td class="n">${yen(r.rev)}</td></tr>`).join("")||`<tr><td colspan="10" class="hint">この年産の作付が未登録です</td></tr>`}
    </table></div>
    <p class="hint">直接費＝作付に紐づけた経費。共通費（紐づけなし経費＋減価償却費）は面積比で按分しています。1俵＝60kg。</p>
    ${varietySummary(prow)}</div>

  <div class="card"><h2>苗・種苗の購入一覧（${year}年）</h2><div class="scroll"><table>
    <tr><th>日付</th><th>品種</th><th>摘要</th><th>取引先</th><th class="n">数量</th><th class="n">単価</th><th class="n">金額</th></tr>
    ${ex.filter(e=>e.category=="種苗費").sort((a,b)=>-byDateDesc(a,b)).map(e=>`<tr><td>${hy(esc(e.date))}</td><td>${hy(esc(e.variety))}</td><td>${hy(esc(e.desc))}</td><td>${hy(esc(e.vendor))}</td><td class="n">${hy(esc(e.qty))}</td><td class="n">${e.unitPrice?yen(e.unitPrice):"-"}</td><td class="n">${yen(e.amount)}</td></tr>`).join("")||`<tr><td colspan="7" class="hint">なし</td></tr>`}
    </table></div></div>

  ${mode=="hat"?"":`<div class="card"><h2>減価償却費（${year}年）${q("減価償却")}</h2><div class="scroll"><table>
    <tr><th>資産</th><th>取得日</th><th class="n">取得価額</th><th class="n">耐用年数</th><th class="n">本年償却費</th><th class="n">事業分</th><th class="n">期末残高</th></tr>
    ${depRows.map(r=>`<tr><td>${esc(r.a.name)}</td><td>${hy(esc(r.a.acquireDate))}</td><td class="n">${yen(r.a.cost)}</td><td class="n">${esc(r.a.life)}</td><td class="n">${yen(r.dep)}</td><td class="n">${yen(r.biz)}</td><td class="n">${yen(r.rest)}</td></tr>`).join("")||`<tr><td colspan="7" class="hint">なし</td></tr>`}
    </table></div></div>`}`;
}

/* ===== 全体モード：田んぼと畑を別々に集計して並べる =====
   それぞれ、区分(div)が合う記録だけで計算する。田んぼの数字に畑は混ざらず、畑の数字に田んぼは混ざらない。
   棚卸高の増減・専従者給与は農場全体の数字なので、ここには含めず、下の「申告用の合計との照合」で足し合わせる。 */
function dashCalc(d){
  const inD=r=>divOf(r)==d;
  const ex=db.expenses.filter(e=>inYear(e.date)&&inD(e));
  const sl=db.sales.filter(s=>inYear(s.date)&&inD(s));
  const sum=(a,f)=>a.reduce((s,r)=>s+f(r),0);
  const byCat={};CATS.forEach(c=>byCat[c]=0);
  ex.forEach(e=>byCat[e.category]=(byCat[e.category]||0)+expAmt(e));
  const dep=sum(db.assets.filter(inD),a=>depreciation(a,year).biz);
  const exTotal=sum(ex,expAmt)+dep;
  const income=sum(sl,r=>+r.amount||0);
  const byKind=SALE_KINDS.map(k=>[k,sum(sl.filter(s=>s.kind==k),r=>+r.amount||0)]);
  const otherKind=income-sum(byKind,x=>x[1]);          // 区分が一覧にない収入（あれば別行で出す）
  const otherCat=sum(ex,expAmt)-sum(CATS,c=>byCat[c]); // 科目が一覧にない経費（あれば別行で出す）
  // 作付別の原価：dash() と同じ考え方（共通費＝紐づけなし経費＋減価償却費を、面積比で按分）
  const pl=db.plantings.filter(p=>p.year==year&&inD(p));
  const common=sum(ex.filter(noPlanting),expAmt)+dep;
  const areaOf=p=>+(db.fields.find(f=>f.id==p.fieldId)||{}).area||0;
  const totalArea=sum(pl,areaOf);
  const prow=pl.map(p=>{
    const direct=sum(ex.filter(e=>e.plantingId==p.id),expAmt);
    const share=totalArea?common*areaOf(p)/totalArea:0;
    return{p,direct,share,cost:direct+share,rev:sum(sl.filter(s=>s.plantingId==p.id),r=>+r.amount||0)};
  });
  return{ex,sl,byCat,dep,exTotal,income,diff:income-exTotal,byKind,otherKind,otherCat,prow,common};
}
function dashDivCard(label,icon,c){
  const rows=CATS.filter(k=>c.byCat[k]).map(k=>`<tr><td>${k}</td><td class="n">${yen(c.byCat[k])}</td></tr>`).join("");
  return `<div class="card dcol"><h2>${icon} ${label} ${year}年分</h2>
    <div class="kpi">
      <div><small>💰 収入</small><b>${yen(c.income)} 円</b></div>
      <div><small>🧾 経費</small><b>${yen(c.exTotal)} 円</b></div>
      <div><small>📈 差引</small><b class="${c.diff<0?"warn":""}">${yen(c.diff)} 円</b></div></div>
    <h3 class="dh">収入の内訳</h3><div class="scroll"><table>
      ${c.byKind.map(([k,v])=>`<tr><td>${k}</td><td class="n">${yen(v)}</td></tr>`).join("")}
      ${c.otherKind?`<tr><td>その他（区分なし）</td><td class="n">${yen(c.otherKind)}</td></tr>`:""}
      <tr><th>合計</th><th class="n">${yen(c.income)}</th></tr></table></div>
    <h3 class="dh">経費の内訳（科目別）</h3><div class="scroll"><table>
      ${rows||`<tr><td colspan="2" class="hint">経費の入力はありません</td></tr>`}
      ${c.otherCat?`<tr><td>その他（科目なし）</td><td class="n">${yen(c.otherCat)}</td></tr>`:""}
      <tr><td>減価償却費（事業分）</td><td class="n">${yen(c.dep)}</td></tr>
      <tr><th>合計</th><th class="n">${yen(c.exTotal)}</th></tr></table></div>
    <h3 class="dh">作付別 原価（${year}年産）</h3><div class="scroll"><table>
      <tr><th>作付</th><th class="n">直接費</th><th class="n">共通費配賦</th><th class="n">原価計</th><th class="n">売上紐づけ</th></tr>
      ${c.prow.map(r=>`<tr><td>${esc(plantLabel(r.p))}</td><td class="n">${yen(r.direct)}</td><td class="n">${yen(r.share)}</td><td class="n"><b>${yen(r.cost)}</b></td><td class="n">${yen(r.rev)}</td></tr>`).join("")||`<tr><td colspan="5" class="hint">この年産の作付が未登録です</td></tr>`}
    </table></div></div>`;
}
function dashDivSection(){
  try{
    const a=dashCalc("田"),b=dashCalc("畑");
    const yv=yr(),inv=(+yv.invClose||0)-(+yv.invOpen||0),fam=+yv.fam||0;
    // 全体の合計は、区分に関係なく全記録から別に数える（区分の抜けや食い違いがあれば気づけるように）
    const allInc=db.sales.filter(s=>inYear(s.date)).reduce((s,r)=>s+(+r.amount||0),0)+inv;
    const allExp=db.expenses.filter(e=>inYear(e.date)).reduce((s,e)=>s+expAmt(e),0)+db.assets.reduce((s,x)=>s+depreciation(x,year).biz,0)+fam;
    const sumInc=a.income+b.income+inv,sumExp=a.exTotal+b.exTotal+fam;
    const ok=Math.round(sumInc)===Math.round(allInc)&&Math.round(sumExp)===Math.round(allExp);
    return `<h2 class="dsec">田んぼと畑の別々の集計（${year}年分）</h2>
      <div class="dgrid">${dashDivCard("田んぼ","🌾",a)}${dashDivCard("畑","🥬",b)}</div>
      <div class="card"><h2>申告用の合計との照合</h2><div class="scroll"><table>
        <tr><th></th><th class="n">収入</th><th class="n">経費</th><th class="n">差引</th></tr>
        <tr><td>🌾 田んぼ</td><td class="n">${yen(a.income)}</td><td class="n">${yen(a.exTotal)}</td><td class="n">${yen(a.diff)}</td></tr>
        <tr><td>🥬 畑</td><td class="n">${yen(b.income)}</td><td class="n">${yen(b.exTotal)}</td><td class="n">${yen(b.diff)}</td></tr>
        <tr><td>全体だけの項目（棚卸高の増減／専従者給与）${q("棚卸高")}</td><td class="n">${yen(inv)}</td><td class="n">${yen(fam)}</td><td class="n">${yen(inv-fam)}</td></tr>
        <tr><th>合計（申告用）</th><th class="n">${yen(sumInc)}</th><th class="n">${yen(sumExp)}</th><th class="n">${yen(sumInc-sumExp)}</th></tr></table></div>
        <p class="hint ${ok?"":"warn"}">${ok?"✔ 下の「申告用の合計」と一致しています。":`⚠ 区分（田・畑）が付いていない記録などで、全記録の合計（収入 ${yen(allInc)} 円・経費 ${yen(allExp)} 円）と合いません。`}</p></div>
      <h2 class="dsec">申告用の合計（従来どおり）</h2>`;
  }catch(e){
    console.error(e);
    return `<div class="card"><p class="warn">田んぼと畑の別々の集計を作れませんでした：${esc(e.message||e)}</p></div>`;
  }
}
function varietySummary(prow){
  const m={};
  prow.forEach(r=>{const k=r.p.variety;m[k]=m[k]||{area:0,cost:0,y:0};m[k].area+=r.area;m[k].cost+=r.cost;m[k].y+=r.y;});
  const ks=Object.keys(m);if(!ks.length)return"";
  return `<h2 style="margin-top:14px">品種別まとめ</h2><div class="scroll"><table>
   <tr><th>品種</th><th class="n">面積(a)</th><th class="n">原価計</th><th class="n">10aあたり</th><th class="n">収量(kg)</th><th class="n">60kgあたり</th></tr>
   ${ks.map(k=>{const v=m[k];return `<tr><td>${esc(k)}</td><td class="n">${v.area?esc(v.area):"-"}</td><td class="n">${yen(v.cost)}</td><td class="n">${v.area?yen(v.cost/v.area*10):"-"}</td><td class="n">${v.y?yen(v.y):"-"}</td><td class="n">${v.y?yen(v.cost/v.y*60):"-"}</td></tr>`}).join("")}</table></div>`;
}
