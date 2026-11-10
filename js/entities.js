// 経費科目・入力項目の定義・田んぼ/畑/全体の切り替え "use strict";
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
const ENT={
 fields:{title:"田んぼ",cols:[
  {k:"name",l:"圃場名",req:1},{k:"area",l:"面積（a／町・反・畝のどれで入力してもOK）",t:"area",req:1},
  {k:"tenure",l:"区分",t:"select",o:["自作地","借地"]},{k:"rent",l:"年間小作料(円)",t:"number"},{k:"note",l:"メモ"}]},
 plantings:{title:"作付（品種・苗）",cols:[
  {k:"year",l:"年産",t:"number",req:1,def:()=>year},
  {k:"fieldId",l:"圃場",t:"field",req:1},
  {k:"plotId",l:"区画（畑の中の区画マップで使います）",t:"plot"},
  {k:"variety",l:"品種・作物（例：コシヒカリ／ネギ）",req:1},
  {k:"purpose",l:"用途",t:"select",o:["野菜・畑作","主食用米","飼料用米","加工用米","酒造好適米","備蓄米","その他"]},
  {k:"seedSource",l:"苗の入手先（購入先 / 自家育苗）"},
  {k:"seedQty",l:"苗の数量（枚・箱）",t:"number"},
  {k:"plantDate",l:"植付日（田植え・種まき・定植）",t:"date"},{k:"harvestPlan",l:"収穫予定日（目安・地図に「あと◯日」と出ます）",t:"date"},{k:"harvestDate",l:"収穫日（実際）",t:"date"},
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
 assets:{title:"減価償却資産",cols:[
  {k:"name",l:"資産名（トラクター等）",req:1},{k:"acquireDate",l:"取得日（使い始めた日）",t:"date",req:1},
  {k:"cost",l:"取得価額(円)",t:"number",req:1},{k:"life",l:"耐用年数(年)",t:"number",req:1},
  {k:"ratio",l:"事業専用割合(%)",t:"number",def:()=>100},{k:"note",l:"メモ"}]},
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
 accounts:["name","type","balance","cur","asOf","note"]};
