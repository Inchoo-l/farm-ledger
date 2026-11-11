"use strict";
// 区画マップの「履歴（時間軸）」：横＝時間（年・月）、縦＝作物
/* ========== 履歴（時間軸） ==========
   ・畑ごとの作付を、作物の行に横棒で並べる（植付日 → 収穫日。収穫日が無ければ収穫予定日。どちらも無ければ今日まで）
   ・作物の色は地図と同じ（名前ごとに別の色）。同じ作物が同時期に別の区画にあれば、行の中で段を分ける
   ・棒の上に、作業日（元肥・追肥・土寄せ・間引き）を丸い印で出す。棒を押すと作付の編集画面が開く
   ・「◀ 1年前」「全期間」などで、昔にさかのぼれる */
let mapTLStart=null,mapTLSpan=24,mapTLPlot=0,mapTLScroll=null; // mapTLScroll＝次の描画で横スクロールをどこへ動かすか（"today"＝今日が見える位置 / "left"＝左端）
const TL_SPANS=[[12,"1年",72],[24,"2年",48],[36,"3年",34],[60,"5年",22],[120,"10年",12]]; // [月数, 名前, 1か月の幅(px)]
const TL_LH=26,TL_BAR=22,TL_HH=44;

const tlOk=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||"");
const tlDim=d=>new Date(+d.slice(0,4),+d.slice(5,7),0).getDate(); // その月の日数
const tlPos=d=>+d.slice(0,4)*12+(+d.slice(5,7)-1)+(+d.slice(8,10)-1)/tlDim(d);   // 月単位の位置（その日の始まり）
const tlPosEnd=d=>tlPos(d)+1/tlDim(d);                                           // その日の終わり
function tlNowStart(){return (new Date().getFullYear()-Math.floor(mapTLSpan/12)+1)*12;} // 今年の終わりまでが見える位置
function mapTLShift(n){mapTLStart=(mapTLStart==null?tlNowStart():mapTLStart)+n;mapTLScroll="left";render();}
function mapTLNow(){mapTLStart=tlNowStart();mapTLScroll="today";render();}
function mapTLSetSpan(n){
  const c=(mapTLStart==null?tlNowStart():mapTLStart)+mapTLSpan/2;
  mapTLSpan=+n;mapTLStart=Math.floor((c-mapTLSpan/2)/12)*12;mapTLScroll="left";render();
}
function mapTLAll(){ // この畑の作付が全部入る期間にする
  const cur=mapCur();if(!cur)return;
  const ds=db.plantings.filter(p=>p.fieldId==cur.id).flatMap(p=>[p.plantDate,p.harvestDate,p.harvestPlan]).filter(tlOk);
  if(!ds.length){mapTLNow();return;}
  const lo=Math.min(...ds.map(tlPos)),hi=Math.max(...ds.map(tlPosEnd),tlPos(today()));
  mapTLStart=Math.floor(lo/12)*12;
  const need=hi-mapTLStart;
  mapTLSpan=(TL_SPANS.find(s=>s[0]>=need)||TL_SPANS[TL_SPANS.length-1])[0];
  mapTLScroll="left";render();
}
function mapTLYear(y){mapTLStart=+y*12;mapTLScroll="left";render();}
// 描画のあと、時間軸の横スクロールを動かす（今日の線が見える位置など）
function mapTLApplyScroll(){
  const s=document.querySelector(".tlscroll");
  if(!s||!mapTLScroll)return;
  if(mapTLScroll=="left")s.scrollLeft=0;
  else{const t=s.querySelector(".tltoday");if(t)s.scrollLeft=Math.max(0,+t.getAttribute("x1")-s.clientWidth*0.6);else s.scrollLeft=0;}
  mapTLScroll=null;
}

function mapTimeline(cur){
  if(mapTLStart==null)mapTLStart=tlNowStart();
  const S=mapTLStart,N=mapTLSpan,E=S+N,sp=TL_SPANS.find(s=>s[0]==N)||TL_SPANS[1],mw=sp[2],W=N*mw;
  const plotsOf=mapPlots(cur);
  const all=db.plantings.filter(p=>p.fieldId==cur.id&&(!mapTLPlot||p.plotId==mapTLPlot));
  const todayP=tlPos(today());
  // 棒にする作付（植付日が入っているもの）
  const bars=[],undated=[];
  all.forEach(p=>{
    if(!tlOk(p.plantDate)){undated.push(p);return;}
    const s=tlPos(p.plantDate),endD=tlOk(p.harvestDate)?p.harvestDate:tlOk(p.harvestPlan)?p.harvestPlan:null;
    let e=endD?tlPosEnd(endD):(s<=todayP?Math.max(s+0.3,todayP+0.05):s+0.3);
    if(e<s+0.1)e=s+0.3; // 収穫日が植付日より前に入っているときも、細い棒で見えるように
    bars.push({p,s,e,real:tlOk(p.harvestDate),open:!endD,crop:mapCrop(p)});
  });
  const vis=bars.filter(b=>b.e>S&&b.s<E);
  // 作物ごとの行（同時期に重なるものは段を分ける）
  const byCrop={};
  vis.forEach(b=>(byCrop[b.crop]=byCrop[b.crop]||[]).push(b));
  const rows=Object.keys(byCrop).map(crop=>{
    const list=byCrop[crop].sort((a,b)=>a.s-b.s),ends=[];
    list.forEach(b=>{let l=ends.findIndex(x=>b.s>=x-0.001);if(l<0){l=ends.length;ends.push(0);}ends[l]=b.e;b.lane=l;});
    return{crop,list,lanes:ends.length,h:ends.length*TL_LH+8,first:list[0].s};
  }).sort((a,b)=>a.first-b.first||a.crop.localeCompare(b.crop,"ja"));
  const H=TL_HH+rows.reduce((t,r)=>t+r.h,0);
  const X=v=>Math.max(0,Math.min(W,(v-S)*mw));

  // 見出し（年・月）と縦の目盛り線
  let g="";
  for(let y=Math.floor(S/12);y<=Math.floor((E-1)/12);y++){
    const a=X(Math.max(S,y*12)),b=X(Math.min(E,(y+1)*12));
    g+=`<rect x="${a}" y="0" width="${b-a}" height="22" class="tlyr"/>`;
    // 横にスクロールしても何年か分かるように、年の名前を3か月ごとにくり返し出す（棒が細いときは1月だけ）
    for(let i=Math.max(S,y*12);i<Math.min(E,(y+1)*12);i++){
      if(i==Math.max(S,y*12)||(mw>=22&&i%3==0))g+=`<text x="${(i-S)*mw+6}" y="16" class="tly">${y}年</text>`;
    }
  }
  for(let i=S;i<E;i++){
    const x=(i-S)*mw,m=i%12+1;
    if(mw>=18)g+=`<text x="${x+mw/2}" y="38" text-anchor="middle" class="tlm">${mw>=34?m+"月":m}</text>`;
    g+=`<line x1="${x}" y1="${i%12==0?0:22}" x2="${x}" y2="${H}" class="tlgrid ${i%12==0?"yr":""}"/>`;
  }
  g+=`<line x1="0" y1="${TL_HH}" x2="${W}" y2="${TL_HH}" class="tlgrid yr"/>`;
  // 行ごとの横線と棒
  let y0=TL_HH;
  rows.forEach(r=>{
    y0+=r.h;
    g+=`<line x1="0" y1="${y0}" x2="${W}" y2="${y0}" class="tlgrid"/>`;
  });
  y0=TL_HH;
  rows.forEach(r=>{
    r.list.forEach(b=>{
      const p=b.p,col=mapColor(b.crop),tc=mapText(col),pl=plotsOf.find(x=>x.id==p.plotId);
      const x1=X(b.s),x2=X(b.e),bw=Math.max(3,x2-x1),y=y0+4+b.lane*TL_LH;
      const endD=tlOk(p.harvestDate)?p.harvestDate:tlOk(p.harvestPlan)?p.harvestPlan:"";
      const label=`${pl?pl.name:"区画なし"}　${mapMD(p.plantDate)}〜${endD?mapMD(endD):""}`;
      const cv=coverOf(p),cvTxt=mapCvN(p)?"［"+coverText(p)+"］":"";
      const tip=`${b.crop}（${pl?pl.name:"区画なし"}）\n植付 ${p.plantDate}\n${p.harvestDate?"収穫 "+p.harvestDate:p.harvestPlan?"収穫予定 "+p.harvestPlan+"（収穫日の入力なし）":"収穫日・収穫予定日の入力なし"}${mapWorkText(p)?"\n"+mapWorkText(p):""}\n被覆資材：${coverText(p)}`;
      // 被覆資材（マルチ・藁）は、棒の上に斜線の模様を重ねる（地図と同じ模様）
      const ov=(cv.mulch?`<rect x="${x1}" y="${y}" width="${bw}" height="${TL_BAR}" rx="4" fill="url(#patMulch)" pointer-events="none"/>`:"")+(cv.straw?`<rect x="${x1}" y="${y}" width="${bw}" height="${TL_BAR}" rx="4" fill="url(#patStraw)" pointer-events="none"/>`:"");
      g+=`<g class="tlb" onclick="edit('plantings',${p.id})"><title>${esc(tip)}</title>
        <rect x="${x1}" y="${y}" width="${bw}" height="${TL_BAR}" rx="4" fill="${col}" ${b.real?"":`fill-opacity=".72" stroke="${col}" stroke-width="2" stroke-dasharray="5 3"`}/>${ov}
        <svg x="${x1}" y="${y}" width="${bw}" height="${TL_BAR}"><text x="6" y="${TL_BAR/2+4.5}" class="tlt" style="fill:${tc}">${esc(label+cvTxt)}</text></svg></g>`;
      if(mw>=20)MAP_WORK.forEach(([k,,sh])=>{ // 作業日の印（元・追・土1・土2・間）
        if(!tlOk(p[k]))return;
        const px=(tlPos(p[k])+0.5/tlDim(p[k])-S)*mw;
        if(px<0||px>W)return;
        g+=`<g class="tlk"><title>${esc(MAP_WORK.find(w=>w[0]==k)[1]+" "+p[k])}</title><circle cx="${px}" cy="${y+TL_BAR/2}" r="9.5"/><text x="${px}" y="${y+TL_BAR/2+3.5}" text-anchor="middle">${sh}</text></g>`;
      });
    });
    y0+=r.h;
  });
  // 今日の線
  if(todayP>=S&&todayP<=E){const x=(todayP-S)*mw;g+=`<line x1="${x}" y1="22" x2="${x}" y2="${H}" class="tltoday"/><text x="${Math.min(x+3,W-26)}" y="${H-4}" class="tltd">今日</text>`;}

  // 左の作物名の列（行の高さは右の図とそろえる）
  const names=`<div class="tlhead" style="height:${TL_HH}px"></div>`+rows.map(r=>`<div class="tln" style="height:${r.h}px" title="${esc(r.crop)}"><i style="background:${mapColor(r.crop)}"></i><span>${esc(r.crop)}</span></div>`).join("");
  const minY=Math.min(new Date().getFullYear()-1,...db.plantings.filter(p=>p.fieldId==cur.id&&tlOk(p.plantDate)).map(p=>+p.plantDate.slice(0,4)));
  const years=[];for(let y=minY;y<=new Date().getFullYear()+1;y++)years.push(y);
  const outside=bars.length-vis.length;
  return `<div class="bar">
      <button class="g" onclick="mapTLShift(-12)">◀ 1年前</button>
      <label style="margin:0">開始 <select onchange="mapTLYear(this.value)">${years.map(y=>`<option value="${y}" ${y==Math.floor(S/12)?"selected":""}>${y}年</option>`).join("")}</select></label>
      <button class="g" onclick="mapTLShift(12)">1年後 ▶</button>
      <button class="g" onclick="mapTLNow()">今に戻す</button>
      <button class="g" onclick="mapTLAll()">全期間</button>
      <label style="margin:0">表示 <select onchange="mapTLSetSpan(this.value)">${TL_SPANS.map(s=>`<option value="${s[0]}" ${s[0]==N?"selected":""}>${s[1]}</option>`).join("")}</select></label>
      <label style="margin:0">区画 <select onchange="mapTLPlot=+this.value;render()"><option value="0">すべて</option>${plotsOf.map(p=>`<option value="${p.id}" ${p.id==mapTLPlot?"selected":""}>${esc(p.name)}</option>`).join("")}</select></label></div>
    <p class="hint">「${esc(cur.name)}」の作付の履歴です。横が時間（年・月）、縦が作物。棒を押すと作付の編集画面が開きます。実線は収穫日あり、点線は収穫予定（収穫日の入力なし）です。同じ名前の作物は同じ色になります。</p>
    ${rows.length?`<div class="tl"><div class="tlnames">${names}</div><div class="scroll tlscroll"><svg class="tlsvg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="作付の履歴"><defs>${mapDefs()}</defs>${g}</svg></div></div>`
      :`<p class="hint">この期間に表示できる作付はありません。${all.length?"「◀ 1年前」や「全期間」で期間を変えてみてください。":"「🌱 作付」タブか、地図の区画から作付を追加してください。"}</p>`}
    <div style="margin-top:8px">${MAP_WORK.map(w=>`<span class="maplg"><b class="tlkey">${w[2]}</b>${w[1]}</span>`).join("")}
      <span class="maplg"><i class="cvsw mulch"></i>マルチ（紺の斜線）</span><span class="maplg"><i class="cvsw straw"></i>藁（黄の斜線）</span><span class="maplg"><i class="cvsw both"></i>マルチ＋藁</span></div>
    ${outside?`<p class="hint">表示期間の外にも ${outside}件の作付があります（「全期間」で見られます）。</p>`:""}
    ${undated.length?`<p class="hint">植付日が未入力のため、時間軸に出せない作付：${undated.map(p=>`<button class="g" onclick="edit('plantings',${p.id})">${esc(plantLabel(p))}</button>`).join(" ")}</p>`:""}`;
}
