"use strict";
// 一覧画面（経費・売上・作付などの表）
/* 一覧や表の「入力がない場所」はハイフンで表示する */
const hy=v=>(v===""||v==null||v===false)?"-":v;
// 一覧の見出しに出す項目名（入力画面用の長い説明「（…）」「 ※…」は取り除く。畑では米向けの言葉を外す）
function colLabel(c){
  let l=c.l.split("（")[0].split(" ※")[0];
  if(mode=="hat"&&c.k=="yield")l="収量(kg)";
  return l;
}
// 一覧の表の見出し行と、記録1件ぶんの行（経費の検索表示 expfilter.js でも同じものを使う）
const listHead=cols=>`<tr class="hd">${cols.map(c=>`<th class="${c.t=="number"?"n":""}">${esc(colLabel(c))}${c.g?q(c.g):""}</th>`).join("")}<th></th></tr>`;
function listRow(name,cols,r){
  const dup=name=="expenses"||name=="sales"; // 経費・売上は「複製」できる
  return `<tr>${cols.map(c=>`<td class="${c.t=="number"?"n":""}" data-label="${esc(colLabel(c))}">${cell(name,c,r)}</td>`).join("")}
      <td class="act">${dup?`<button class="g" onclick="edit('${name}',null,${+r.id})">複製</button> `:""}<button class="g" onclick="edit('${name}',${+r.id})">編集</button> <button class="g d" onclick="del('${name}',${+r.id})">削除</button></td></tr>`;
}
function cell(ent,c,r){
  const v=r[c.k];
  try{
    let out;
    // 経費の検索中は、ヒットした部分に <mark> を付けて表示する（expfilter.js）
    if(ent=="expenses"&&typeof expCellMark=="function"){const m=expCellMark(c,r);if(m!==null)return m;}
    if(c.calc=="bal")out=yen(acctBal(r)); // 口座の現在残高（計算値）
    else if(c.calc=="cover")out=esc(coverText(r)); // 被覆資材（マルチ・藁）
    else if(c.t=="field"){const f=db.fields.find(x=>x.id==v);out=esc(f?f.name:"");}
    else if(c.t=="plot"){const pl=(db.plots||[]).find(x=>x.id==v);out=esc(pl?pl.name:"");}
    else if(c.t=="planting"){const p=db.plantings.find(x=>x.id==v);out=p?esc(plantLabel(p)):"共通";}
    else if(c.t=="account"){const a=db.accounts.find(x=>x.id==v);out=a?esc(a.name):"";}
    else if(c.t=="area")out=v===""||v==null?"":`${esc(v)}a（${tanbaStr(v)}）`;
    else if(c.t=="check")out=v?"✔":"";
    else if(c.raw)out=esc(v); // 年産など、カンマを付けない数字
    else if(c.t=="number"&&v!==""&&v!=null)out=yen(v);
    else out=esc(v);
    return hy(out);
  }catch(e){return "-";}
}

function listView(name){
  // 経費は、検索・絞り込み付きの専用の表示（expfilter.js）を使う。失敗したら従来の表示に戻す
  if(name=="expenses"&&typeof expView=="function"){
    try{return expView();}
    catch(e){try{console.error(e);toast("経費の検索表示でエラーが出たため、通常の一覧を表示しています："+(e.message||e));}catch(_){}}
  }
  const E=ENT[name];let rows=name=="accounts"?[...db[name]]:db[name].filter(inMode); // 口座は田・畑・全体で共通
  const title=name=="fields"?MODE_NAME[mode]+"の一覧":E.title;
  if(name=="expenses"||name=="sales")rows=rows.filter(r=>inYear(r.date));
  if(name=="plantings")rows=rows.filter(r=>r.year==year);
  if(name=="expenses"||name=="sales")rows=[...rows].sort(byDateDesc);
  const cols=TABLE_COLS[name].filter(k=>!(mode=="hat"&&k=="rent")&&!(mode!="hat"&&(k=="plotId"||k=="cover"))).map(k=>E.cols.find(c=>c.k==k));
  let total="";
  if(name=="expenses"||name=="sales")total=`<span><b>${year}年 合計：${yen(rows.reduce((s,r)=>s+(+r.amount||0),0))} 円</b>（${rows.length}件）</span>`;
  if(name=="accounts")total=`<span><b>現在の貯金額 合計：${yen(rows.reduce((s,r)=>s+acctBal(r),0))} 円</b>（${rows.length}口座）</span>`;
  let hint="";
  if(name=="accounts")hint=`<p class="hint">通帳の残高や手元の現金を、口座ごとに「開始残高」として登録します。経費・売上を入力するときに口座を選ぶと、経費は口座から引き落とされ、売上・収入は口座に加算されて「現在の残高」が自動で変わります。ここの合計が「全体の集計」に「現在の貯金額」として出ます。<br>※口座どうしのお金の移動（引き出し・カード引き落としなど）の入力はまだありません。必要なときは開始残高を直してください。</p>`;
  if(name=="sales")hint=`<p class="hint">売上・収入は、選んだ口座に加算されます（家事消費・事業消費は現金が動かないので口座は不要です）。「複製」で同じ内容を日付を変えて追加できます。</p>`;
  if(name=="expenses")hint=`<p class="hint">経費は、選んだ口座から引き落とされます。「複製」で同じ内容を日付を変えて追加できます。苗の購入は勘定科目「種苗費」で登録し、品種・数量・単価・購入先を入れてください。作付と紐づけると品種別・圃場別の原価が計算されます。</p>`;
  if(name=="assets")hint=`<p class="hint">取得価額10万円未満は通常は経費（農具費など）で処理します。10万円以上〜30万円未満は青色申告なら一括経費にする特例があります（年間合計300万円まで）。ここには数年かけて償却するものを登録します（定額法で計算）。</p>`;
  if(name=="fields")hint=`<p class="hint">面積はa（アール）で保存し、町・反・畝でも入力・表示できます。換算：
    <select onchange="db.settings.unit=this.value;save();render()">
     <option value="exact" ${db.settings.unit!="approx"?"selected":""}>尺貫法どおり（1反＝約991.7㎡＝約9.92a）</option>
     <option value="approx" ${db.settings.unit=="approx"?"selected":""}>概算（1反＝10a）</option></select>
    　1町＝10反、1反＝10畝。登記簿の面積は㎡なので、1a＝100㎡で入力してください。</p>`;
  if(name=="plantings")hint=`<p class="hint">先に「田んぼ」または「畑」を登録してください。ここで品種（作物）・苗の入手先・収量を管理します。畑の作物も登録できます。</p>`;
  return `<div class="card"><div class="bar"><h2 style="margin:0">${title}</h2>
    <button class="b" onclick="edit('${name}')">＋ 追加</button>${total}
    ${(name=="expenses"||name=="sales")?`<button class="g" onclick="csv('${name}')">CSV出力（${year}年）</button>`:""}</div>${hint}
    <div class="scroll"><table class="lt">${listHead(cols)}
    ${rows.map(r=>listRow(name,cols,r)).join("")
      ||`<tr><td colspan="${cols.length+1}" class="hint">データがありません</td></tr>`}
    </table></div></div>`;
}
