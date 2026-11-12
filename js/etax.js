"use strict";
// e-Tax入力ガイド（決算書の項目順に金額を表示・コピー）
/* ========== e-Tax 入力ガイド（決算書の項目順に金額を並べ、コピーできる） ========== */
const yr=()=>db.yearly&&db.yearly[year]||{};
function setYr(k,v){db.yearly=db.yearly||{};db.yearly[year]=Object.assign({},yr(),{[k]:Math.max(0,+v||0)});save();render();}
// 集計とe-Taxで同じ計算を使う。赤字は0円に丸めず、控除だけを黒字額までに制限する。
function ledgerTotals(filter=()=>true,whole=true){
  const ex=db.expenses.filter(e=>inYear(e.date)&&filter(e));
  const sl=db.sales.filter(s=>inYear(s.date)&&filter(s));
  const y=yr(),cat=Object.create(null);CATS.forEach(c=>cat[c]=0);
  ex.forEach(e=>cat[e.category]=(cat[e.category]||0)+expAmt(e));
  const assets=db.assets.filter(filter).map(a=>({a,...depreciation(a,year)}));
  const dep=assets.reduce((s,r)=>s+r.biz,0);
  const invOpen=whole?(+y.invOpen||0):0,invClose=whole?(+y.invClose||0):0,fam=whole?(+y.fam||0):0;
  const incomeTotal=sl.reduce((s,r)=>s+(+r.amount||0),0)+invClose-invOpen;
  const expTotal=ex.reduce((s,e)=>s+expAmt(e),0)+dep+fam;
  const diff=incomeTotal-expTotal;
  const ded=Math.min(Math.max(0,+db.settings.deduction||0),Math.max(0,diff));
  return{ex,sl,cat,assets,dep,invOpen,invClose,fam,incomeTotal,expTotal,diff,ded,shotoku:diff-ded};
}
async function copyVal(v,btn){
  const done=()=>{const o=btn.dataset.o||btn.textContent;btn.dataset.o=o;btn.textContent="✔ コピーしました";setTimeout(()=>btn.textContent=o,1200);};
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){await navigator.clipboard.writeText(String(v));done();return;}
  }catch(_){} // 権限エラーなどは従来方式で再試行する
  const t=document.createElement("textarea");t.value=v;document.body.appendChild(t);t.select();
  let ok=false;
  try{ok=document.execCommand("copy");}catch(_){}finally{t.remove();}
  if(ok)done();else alert("コピーできませんでした。表示されている金額を選択してコピーしてください。");
}
function etaxData(){
  const d=ledgerTotals(),{ex,sl}=d;
  const sum=ks=>sl.filter(s=>ks.includes(s.kind)).reduce((a,s)=>a+(+s.amount||0),0);
  Object.assign(d,{hanbai:sum(["出荷売上（JA等）","直売・相対売上"]),kaji:sum(["家事消費"]),jigyo:sum(["事業消費"]),
    zatsu:sum(["補助金・交付金","その他の収入"])});
  d.assets=d.assets.filter(r=>/^\d{4}-/.test(String(r.a.acquireDate||""))&&+r.a.acquireDate.slice(0,4)<=year); // 取得年は文字から読む（new Date() は時差でずれることがある）
  // 作物別の収入明細
  const crops=Object.create(null);
  db.plantings.filter(p=>p.year==year).forEach(p=>{
    const f=db.fields.find(x=>x.id==p.fieldId)||{};
    const c=crops[p.variety]=crops[p.variety]||{area:0,yield:0,rev:0};
    c.area+=+f.area||0;c.yield+=+p.yield||0;
    c.rev+=sl.filter(s=>s.plantingId==p.id).reduce((a,s)=>a+(+s.amount||0),0);
  });
  d.crops=crops;
  // 地代・賃借料の支払先別
  d.rents=Object.create(null);
  ex.filter(e=>e.category=="小作料・賃借料").forEach(e=>{const k=e.vendor||"（取引先なし）";d.rents[k]=(d.rents[k]||0)+expAmt(e);});
  d.noVendor=ex.filter(e=>!String(e.vendor||"").trim()).length;
  return d;
}
function etaxView(){
  const d=etaxData(), y=yr();
  const row=(l,v,g,bold)=>`<tr><td>${bold?"<b>":""}${l}${g?q(g):""}${bold?"</b>":""}</td>
    <td class="n" style="${v?"":"color:var(--sub)"}">${bold?"<b>":""}${yen(v)}${bold?"</b>":""}</td>
    <td><button class="g" onclick="copyVal(${Math.round(v)},this)">コピー</button></td></tr>`;
  const num=(k,l,g)=>`<label>${l}${g?q(g):""}</label><input type="number" min="0" value="${y[k]||0}" onchange="setYr('${k}',this.value)">`;
  const warns=[];
  if(db.settings.deduction==null)warns.push("控除額が未設定です。「全体の集計」で選んでください。現在は控除なしで概算しています。");
  if(d.noVendor)warns.push(`取引先が空欄の経費が${d.noVendor}件あります。`);
  if((+db.settings.deduction||0)>=550000)warns.push("控除額が55万円・65万円になっています。貸借対照表（決算書の3ページ目）が必要です。このアプリでは作れないので、10万円にするか会計ソフトを併用してください。");
  return `
  <div class="card"><h2>🖥 e-Tax入力ガイド（${year}年分・青色申告決算書 農業所得用）</h2>
    <p>国税庁の「確定申告書等作成コーナー」で、決算書の入力画面を開き、下の表を<b>上から順に</b>見ながら、右の「コピー」ボタンで金額を貼り付けてください。</p>
    <ol class="hint"><li>国税庁サイトの「確定申告書等作成コーナー」を開き、青色申告決算書（農業所得用）の作成を選びます。</li>
      <li>画面の項目名と下の表の項目名を見比べて、同じ項目にコピーした金額を貼り付けます。</li>
      <li>項目名は年によって変わることがあります。一致しない項目は、国税庁のその年の記載要領で対応先を確認してください。</li></ol>
    ${warns.map(w=>`<p class="warn">⚠ ${w}</p>`).join("")}
  </div>

  <div class="card"><h2>① アプリに入っていない金額を入力</h2>
    <p class="hint">この3つは売上や経費の入力からは分からないので、ここで入れてください。入れると「全体の集計」にも反映されます。</p>
    <div class="kpi" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
      <div>${num("invOpen","期首の農産物の棚卸高（前年末に残っていた分・円）","棚卸高")}</div>
      <div>${num("invClose","期末の農産物の棚卸高（今年末に残っている分・円）","棚卸高")}</div>
      <div>${num("fam","専従者給与（家族に払った給料・円）","専従者給与")}</div>
    </div></div>

  <div class="card"><h2>② 収入金額</h2><div class="scroll"><table class="et">
    <tr><th>決算書の項目</th><th class="n">金額(円)</th><th></th></tr>
    ${row("販売金額（JA出荷・直売）",d.hanbai,"出荷売上（JA等）")}
    ${row("家事消費の金額",d.kaji,"家事消費")}
    ${row("事業消費の金額",d.jigyo,"事業消費")}
    ${row("雑収入（補助金・交付金など）",d.zatsu,"補助金・交付金")}
    ${row("期首の農産物棚卸高",d.invOpen,"棚卸高")}
    ${row("期末の農産物棚卸高",d.invClose,"棚卸高")}
    ${row("収入金額の計（販売＋家事＋事業＋雑収入＋期末－期首）",d.incomeTotal,"収入金額",true)}
  </table></div></div>

  <div class="card"><h2>③ 経費</h2><div class="scroll"><table class="et">
    <tr><th>決算書の項目</th><th class="n">金額(円)</th><th></th></tr>
    ${CATS.map(c=>row(c,d.cat[c],c)).join("")}
    ${row("専従者給与",d.fam,"専従者給与")}
    ${row("減価償却費（下の④の合計）",d.dep,"減価償却")}
    ${row("経費の計",d.expTotal,"必要経費",true)}
  </table></div></div>

  <div class="card"><h2>④ 減価償却費の計算</h2><div class="scroll"><table>
    <tr><th>資産</th><th>取得年月</th><th class="n">取得価額</th><th>償却方法</th><th class="n">耐用年数</th><th class="n">償却率${q("償却率")}</th><th class="n">償却月数</th><th class="n">本年分の償却費</th><th class="n">事業専用割合</th><th class="n">必要経費に入れる額</th><th></th><th class="n">未償却残高</th></tr>
    ${d.assets.map(r=>`<tr><td>${esc(r.a.name)}</td><td>${hy(esc((r.a.acquireDate||"").slice(0,7)))}</td><td class="n">${yen(r.a.cost)}</td><td>定額法</td><td class="n">${esc(r.a.life)}</td><td class="n">${r.rate.toFixed(3)}</td><td class="n">${r.months}</td><td class="n">${yen(r.dep)}</td><td class="n">${esc(r.a.ratio===""||r.a.ratio==null?100:r.a.ratio)}%</td><td class="n"><b>${yen(r.biz)}</b></td><td><button class="g" onclick="copyVal(${r.biz},this)">コピー</button></td><td class="n">${yen(r.rest)}</td></tr>`).join("")||`<tr><td colspan="12" class="hint">登録された資産はありません</td></tr>`}
  </table></div></div>

  <div class="card"><h2>⑤ 差引金額と所得金額</h2><div class="scroll"><table class="et">
    <tr><th>決算書の項目</th><th class="n">金額(円)</th><th></th></tr>
    ${row("差引金額（収入金額－経費）",d.diff,"差引金額")}
    ${row("青色申告特別控除額",d.ded,"青色申告特別控除")}
    ${row("所得金額（差引金額－特別控除額）",d.shotoku,"農業所得",true)}
  </table></div></div>

  <div class="card"><h2>⑥ 収入金額の明細（作物別）</h2><div class="scroll"><table>
    <tr><th>作物・品種</th><th class="n">作付面積</th><th class="n">収量(kg)</th><th class="n">収入(売上と紐づけた分)</th></tr>
    ${Object.entries(d.crops).map(([k,c])=>`<tr><td>${esc(k)}</td><td class="n">${c.area?`${esc(c.area)}a（${tanbaStr(c.area)}）`:"-"}</td><td class="n">${c.yield?yen(c.yield):"-"}</td><td class="n">${yen(c.rev)}</td></tr>`).join("")||`<tr><td colspan="4" class="hint">作付が未登録です</td></tr>`}
  </table></div><p class="hint">売上を作付に紐づけていないと、ここの収入は0円になります。</p></div>

  <div class="card"><h2>⑦ 地代・賃借料の内訳（支払先別）</h2><div class="scroll"><table class="et">
    <tr><th>支払先</th><th class="n">金額(円)</th><th></th></tr>
    ${Object.entries(d.rents).map(([k,v])=>row(esc(k),v)).join("")||`<tr><td colspan="3" class="hint">小作料・賃借料の経費はありません</td></tr>`}
  </table></div></div>`;
}
