"use strict";
// 経費科目・入力項目の定義・田んぼ/畑/全体の切り替え
/* 青色申告決算書（農業所得用）の経費科目 */
const CATS=["租税公課","種苗費","素畜費","肥料費","飼料費","農具費","農薬衛生費","諸材料費","修繕費","動力光熱費","作業用衣料費","農業共済掛金","荷造運賃手数料","雇人費","小作料・賃借料","利子割引料","土地改良費","貸倒金","雑費"];
const SALE_KINDS=["出荷売上（JA等）","直売・相対売上","家事消費","事業消費","補助金・交付金","その他の収入"];
// 現金の動きがない売上区分（自分で食べた・事業で使った分）は口座の増減に含めない
const NOCASH=["家事消費","事業消費"];

/* ========== エンティティ定義 ========== */
const plantLabel=p=>{const f=db.fields.find(x=>x.id==p.fieldId),pl=(db.plots||[]).find(x=>x.id==p.plotId);return `${p.year} ${f?f.name:"(圃場不明)"}${pl?" "+pl.name:""} ${p.variety}`;};
/* 被覆資材（マルチ・藁）は作物（作付）ごとに持つ。
   作付に mulch / straw の記録がない古いデータは、以前の「区画ごとのチェック」を引き継いで表示する（データ自体は書き換えない）。
   どちらも無ければ「なし」。 */
const coverOf=p=>{
  try{
    if(p.mulch!==undefined||p.straw!==undefined)return{mulch:!!p.mulch,straw:!!p.straw};
    const pl=(db.plots||[]).find(x=>x.id==p.plotId);
    return{mulch:!!(pl&&pl.mulch),straw:!!(pl&&pl.straw)};
  }catch(e){return{mulch:false,straw:false};}
};
const coverText=p=>{const c=coverOf(p);return [c.mulch?"マルチ":"",c.straw?"藁":""].filter(Boolean).join("・")||"なし";};

/* ===== 入水記録（田んぼの水管理） =====
   「入水した」記録：始めた時刻と水深、止めた時刻と水深（止めた分は、あとから編集で入れてもよい）
   「水深だけ測った」記録：入水していないときの水深。続けて測ると減水深（1日に下がる水深）がわかる
   ※記録はGoogleドライブの共有ファイルにも入り、Colabの「入水時間の予測」で読み込む */
const WATER_KINDS=["入水した","水深だけ測った（入水なし）"];
const isInflow=r=>r.wkind!==WATER_KINDS[1];
const nowTime=()=>{const d=new Date();return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;};
const hmMin=s=>{const m=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s||""));return m?+m[1]*60+ +m[2]:null;}; // "07:30" → 450（分）
// 入水した時間（分）。止めた時刻が始めた時刻より前なら、日付をまたいだとみなす。そろっていなければ null
function waterMinutes(r){
  if(!isInflow(r))return null;
  const a=hmMin(r.start),b=hmMin(r.end);
  if(a==null||b==null)return null;
  const d=(b-a+1440)%1440;
  return d>0?d:null;
}
const hasNum=v=>v!==""&&v!=null&&Number.isFinite(Number(v));
// 1時間あたりに上がった水深（cm/時）。入水した時間と前後の水深がそろっていなければ null
function waterRate(r){
  const d=waterMinutes(r);
  if(d==null||!hasNum(r.depthBefore)||!hasNum(r.depthAfter))return null;
  return (Number(r.depthAfter)-Number(r.depthBefore))/(d/60);
}
function waterDurText(r){
  const d=waterMinutes(r);
  if(d==null)return isInflow(r)&&r.start&&!r.end?"止めた時刻が未入力":"";
  return `${Math.floor(d/60)}時間${String(d%60).padStart(2,"0")}分`;
}
const waterRateText=r=>{const v=waterRate(r);return v==null?"":`${v>=0?"+":""}${v.toFixed(1)}cm/時`;};
// 記録の日付と時刻を、比べられる時刻（ミリ秒）にする
function waterTime(date,hm,nextDay){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date||"")),t=hmMin(hm);
  if(!m||t==null)return null;
  return new Date(+m[1],+m[2]-1,+m[3]+(nextDay?1:0),Math.floor(t/60),t%60).getTime();
}
/* 減水深（cm/日）：同じ圃場で、入水していない間に続けて測った2つの水深から求める。
   雨の記録がある・目安（記憶）の水深・間隔が3時間未満か4日を超える組は、正確でないので使わない */
function waterLossRates(fieldId){
  const pts=[];
  for(const r of (db.waterlogs||[]).filter(x=>x.fieldId==fieldId)){
    const ok=(r.rain||"なし")=="なし"&&(r.measured||"実測")=="実測";
    const s=waterTime(r.date,r.start);
    if(s!=null&&hasNum(r.depthBefore))pts.push({t:s,depth:+r.depthBefore,ok,from:!isInflow(r),to:true});
    if(isInflow(r)){
      const m=waterMinutes(r);
      // 止めた記録がない入水は、そこから先の水深の変化がわからない（始めた時点の点は from:false なので、そこで区切られる）
      if(m==null||!hasNum(r.depthAfter)||s==null)continue;
      pts.push({t:s+m*60000,depth:+r.depthAfter,ok,from:true,to:false});
    }
  }
  pts.sort((a,b)=>a.t-b.t);
  const out=[];
  for(let i=1;i<pts.length;i++){
    const p=pts[i-1],q=pts[i],h=(q.t-p.t)/3600000;
    if(!p.from||!q.to||!p.ok||!q.ok||h<3||h>96)continue; // 間に入水がある組・条件の悪い組は使わない
    const loss=(p.depth-q.depth)/h*24;
    if(loss>=0)out.push(loss);
  }
  return out;
}
function waterLossText(fieldId){
  const v=waterLossRates(fieldId).sort((a,b)=>a-b);
  if(!v.length)return "";
  const mid=v.length%2?v[(v.length-1)/2]:(v[v.length/2-1]+v[v.length/2])/2; // 真ん中の値（中央値）
  return `${mid.toFixed(1)}cm/日（${v.length}回分）`;
}
const ENT={
 fields:{title:"田んぼ",cols:[
  {k:"name",l:"圃場名",req:1},{k:"area",l:"面積（a／町・反・畝のどれで入力してもOK）",t:"area",req:1},
  {k:"tenure",l:"区分",t:"select",o:["自作地","借地"]},{k:"rent",l:"年間小作料(円)",t:"number"},{k:"note",l:"メモ"}]},
 plantings:{title:"作付",cols:[
  {k:"year",l:"年産",t:"number",req:1,min:1,max:9999,raw:1,def:()=>year}, // raw＝一覧でカンマを付けない（2,026 にしない）
  {k:"fieldId",l:"圃場",t:"field",req:1},
  {k:"plotId",l:"区画（畑の中の区画マップで使います）",t:"plot"},
  {k:"variety",l:"品種・作物（例：コシヒカリ／ネギ）",req:1},
  {k:"purpose",l:"用途",t:"select",o:["野菜・畑作","主食用米","飼料用米","加工用米","酒造好適米","備蓄米","その他"]},
  {k:"seedSource",l:"苗の入手先（購入先 / 自家育苗）"},
  {k:"seedQty",l:"苗の数量（枚・箱）",t:"number"},
  {k:"plantDate",l:"植付日（田植え・種まき・定植）",t:"date"},{k:"harvestPlan",l:"収穫予定日（目安・地図に「あと◯日」と出ます）",t:"date"},{k:"harvestDate",l:"収穫日",t:"date"},
  {k:"yield",l:"収量(kg・玄米)",t:"number"},
  // 被覆資材（畑モードだけ表示。区画マップで、作物の帯に模様がかかります。両方・どちらもなしも選べます）
  {k:"mulch",l:"被覆資材：マルチをしている",t:"check",hat:1},
  {k:"straw",l:"被覆資材：藁（わら）を敷いている",t:"check",hat:1},
  {k:"cover",l:"被覆資材",calc:"cover",hat:1}, // 一覧に出すだけの計算列（入力欄にはならない）
  // 畑の作業日（畑モードだけ表示。区画マップの「履歴」に印として出ます）
  {k:"baseFert",l:"元肥をした日",t:"date",hat:1},{k:"topdress",l:"追肥をした日",t:"date",hat:1},
  {k:"hill1",l:"土寄せ 1回目の日",t:"date",hat:1},{k:"hill2",l:"土寄せ 2回目の日",t:"date",hat:1},
  {k:"thinning",l:"間引きをした日",t:"date",hat:1},
  {k:"note",l:"メモ"}]},
 plots:{title:"区画",cols:[
  {k:"fieldId",l:"畑",t:"field",req:1},
  {k:"name",l:"区画名（例：A区・北側・手前）",req:1},
  // ※藁・マルチは作物ごとの設定に変わりました（plots.straw / plots.mulch は古いデータの引き継ぎ用に残すだけ）
  {k:"note",l:"メモ"}]},
 expenses:{title:"経費",cols:[
  {k:"date",l:"日付",t:"date",req:1,def:()=>today()},
  {k:"category",l:"勘定科目",t:"select",o:CATS,req:1},
  {k:"desc",l:"摘要（品名）",req:1},
  {k:"variety",l:"品種（苗・種籾の購入時）"},
  {k:"vendor",l:"取引先",req:1},
  {k:"qty",l:"数量",t:"number",step:"0.01"},{k:"unitPrice",l:"単価(円)（数量×単価で金額を自動計算）",t:"number",step:"0.01"},
  {k:"amount",l:"金額(円・税込)（数量と単価を入れれば自動計算）",t:"number",req:2}, // req:2 = ※は付けるが、数量×単価でも可
  {k:"accountId",l:"引き落とし口座",t:"account",req:1},
  {k:"plantingId",l:"どの作付の費用か（共通費は空欄）",t:"planting"},
  {k:"invoice",l:"適格請求書（インボイス）あり",t:"check"},
  {k:"note",l:"メモ（領収書の保管場所など）"}]},
 sales:{title:"売上・収入",cols:[
  {k:"date",l:"日付",t:"date",req:1,def:()=>today()},
  {k:"kind",l:"区分",t:"select",o:SALE_KINDS,req:1},
  {k:"buyer",l:"出荷先・取引先"},{k:"variety",l:"品種"},
  {k:"qty",l:"数量(kg)",t:"number",step:"0.1"},
  {k:"amount",l:"金額(円)",t:"number",req:1},
  {k:"accountId",l:"入金口座",t:"account",req:1},
  {k:"plantingId",l:"作付との紐づけ",t:"planting"},{k:"note",l:"メモ"}]},
 accounts:{title:"貯金・口座",cols:[
  {k:"name",l:"口座名・場所（例：JA普通預金／手元の現金）",req:1},
  {k:"type",l:"種類",t:"select",o:["普通預金","定期預金","現金（手元）","クレジットカード","その他"]},
  {k:"balance",l:"開始残高(円) ※以降の収入・支出で自動で増減",t:"number",req:1},
  {k:"cur",l:"現在の残高(円)",t:"number",calc:"bal"},
  {k:"asOf",l:"開始残高の日付",t:"date",def:()=>today()},{k:"note",l:"メモ"}]},
 waterlogs:{title:"入水記録",cols:[ // wt:1＝「入水した」ときだけ使う項目（水深だけの記録では入力欄を隠す）
  {k:"date",l:"日付",t:"date",req:1,def:()=>today()},
  {k:"fieldId",l:"圃場",t:"field",req:1},
  {k:"wkind",l:"記録の種類",t:"select",o:WATER_KINDS,req:1}, // 売上の「区分」(kind)と別の名前にする（説明表示などが混ざらないように）
  {k:"start",l:"時刻（入水を始めた時刻／水深を測った時刻）",t:"time",req:1,def:()=>nowTime()},
  {k:"depthBefore",l:"水深(cm)（入水を始める前／測った水深）",t:"number",step:"0.1",min:0,max:100,req:1},
  {k:"end",l:"入水を止めた時刻（あとで編集して入れてもOK）",t:"time",wt:1},
  {k:"depthAfter",l:"止めたときの水深(cm)（あとで編集して入れてもOK）",t:"number",step:"0.1",min:0,max:100,wt:1},
  {k:"gate",l:"給水口の開き具合",t:"select",o:["","全開","半分","少し"],wt:1},
  {k:"canal",l:"水路の水量",t:"select",o:["","多い","普通","少ない"],wt:1},
  {k:"spread",l:"田んぼ全体に水が広がった",t:"check",wt:1},
  {k:"rain",l:"雨",t:"select",o:["なし","小雨","強い雨"]},
  {k:"measured",l:"水深の測り方",t:"select",o:["実測","目安（記憶）"]},
  {k:"hours",l:"入水した時間",calc:"wdur"}, // 一覧に出すだけの計算列
  {k:"rate",l:"1時間に上がった水深",calc:"wrate"},
  {k:"note",l:"メモ"}]},
 assets:{title:"減価償却資産",cols:[
  {k:"name",l:"資産名（トラクター等）",req:1},{k:"acquireDate",l:"取得日（使い始めた日）",t:"date",req:1},
  {k:"cost",l:"取得価額(円)",t:"number",req:1,min:1},{k:"life",l:"耐用年数(年)",t:"number",req:1,min:1},
  {k:"ratio",l:"事業専用割合(%)",t:"number",min:0,max:100,def:()=>100},{k:"note",l:"メモ"}]},
};
/* ===== 田んぼ / 畑 / 全体 の切り替え =====
   すべてのデータに div("田"|"畑") を持たせ、今のモードのものだけ表示する。
   div が無い古いデータは「田」、kind=="畑" の圃場は「畑」として扱う。 */
let mode="rice"; // rice | hat | all
const DIV=()=>mode=="hat"?"畑":"田";
const divOf=r=>r.div||(r.kind=="畑"?"畑":"田");
const inMode=r=>mode=="all"||divOf(r)==DIV();
const MODE_NAME={rice:"田んぼ",hat:"畑",all:"全体"};
const TABLE_COLS={ // 一覧に出す列
 fields:["name","area","tenure","rent"],
 plantings:["year","fieldId","plotId","variety","purpose","seedSource","seedQty","plantDate","harvestPlan","yield","cover"],
 expenses:["date","category","desc","variety","vendor","amount","accountId","plantingId","invoice"],
 sales:["date","kind","buyer","variety","qty","amount","accountId"],
 assets:["name","acquireDate","cost","life","ratio"],
 accounts:["name","type","balance","cur","asOf","note"],
 waterlogs:["date","fieldId","wkind","start","depthBefore","end","depthAfter","hours","rate","gate","canal","rain","spread","measured"]};
