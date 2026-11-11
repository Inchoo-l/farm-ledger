"use strict";
// 区画マップ（畑ごとの地図に区画を並べ、今の作付と日数を表示）
/* ========== 区画マップ ==========
   ・「畑の一覧」に登録した畑 ＝ 1枚のマップ（右上のダウンリストで切り替える）
   ・その畑の中を分けた「区画」(db.plots) を、地図に四角として置く（位置・大きさ・色は区画に保存）
   ・作付(plantings)は plotId で区画に紐づく。作物の帯の色は「作物名」ごとに自動で決まる（同じ名前なら同じ色）
   ・基準日を変えると、その日に何を植えていたかが見られる。「履歴（時間軸）」タブは maptl.js
   ・収穫予定日を3日過ぎた作付は、地図には出さない（収穫日を入れていない場合）
   ・藁・マルチ（被覆資材）は作物ごとに設定する。作物の帯の上に、紺の斜線（マルチ）・黄の斜線（藁）が半透明で重なり、
     角に「マ」「藁」の丸い印も出る。被覆資材のある帯は、同じ区画の中で前に出す
   ・スマホ幅（720px以下）では、地図全体を画面の幅に収める。方角の文字とコンパスは地図の外の余白に置き、文字は大きく・長い名前は「…」で省略する */
const MAPW=1000,MAPH=640,MAPSNAP=10;
const MAP_SEED=["#2e7d32","#1565c0","#8e24aa","#c2185b","#d84315","#00796b","#6d4c41","#546e7a"]; // 最初の8作物はこの色
const MAP_GRACE=3;                     // 収穫予定日からこの日数を超えたら地図に出さない
const MAP_RIM=6;                       // 藁・マルチの枠の太さ
const MAP_RIMS=[["straw","#dcb25c","藁"],["mulch","#1a2a6c","マルチ"]]; // 藁色・紺色
const MAP_WORK=[["baseFert","元肥","元"],["topdress","追肥","追"],["hill1","土寄せ1回目","土1"],["hill2","土寄せ2回目","土2"],["thinning","間引き","間"]];
let mapSel=null,mapEdit=false,mapDate=today(),mapDrag=null,mapCurId=null,mapSub="map";

const mapDays=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/864e5); // a から b までの日数
const mapMD=d=>d?`${+d.slice(5,7)}/${+d.slice(8,10)}`:"";
const mapCrop=p=>String(p.variety||"").trim()||"（作物未入力）";
const mapCoarse=()=>{try{return matchMedia("(pointer:coarse)").matches;}catch(e){return false;}}; // 指で操作する端末か

/* ----- 画面の幅に合わせた地図の見え方（スマホ幅だけ変える。PC表示は今までどおり） -----
   m: スマホ幅か / k: 文字などを大きくする倍率 / sc: 地図1単位が何pxで表示されるか / vb: SVGの表示範囲(viewBox) */
const mapMobile=()=>{try{return matchMedia("(max-width:720px)").matches;}catch(e){return false;}};
const MAP_PCGEO={m:false,k:1,sc:1,vb:[0,0,MAPW,MAPH]};
let mapGeoLast=MAP_PCGEO;
function mapGeo(){
  try{
    if(!mapMobile())return MAP_PCGEO;
    const vb=[-36,-100,MAPW+72,MAPH+100+46]; // 上・左右・下の余白に、方角の文字とコンパスを置く（区画と重ならない）
    const cw=Math.max(240,Math.min(innerWidth,720)-44); // 地図に使える横幅(px)＝画面の幅から余白を引いたもの
    const sc=cw/vb[2];
    return{m:true,k:Math.max(1,Math.min(2.6,0.72/sc)),sc,vb};
  }catch(e){return MAP_PCGEO;}
}
// 長い名前を、幅(maxW)に入る長さで「…」にする（全角は1文字ぶん、半角は約0.56文字ぶんで数える）
function mapFitText(s,maxW,fs){
  try{
    s=String(s??"");
    const w=ch=>/[\u0000-ÿ｡-ﾟ]/.test(ch)?0.56*fs:fs;
    let total=0;for(const ch of s)total+=w(ch);
    if(total<=maxW)return s;
    let out="",used=0;
    for(const ch of s){if(used+w(ch)+fs>maxW)break;out+=ch;used+=w(ch);}
    return out?out+"…":(maxW>=fs?"…":"");
  }catch(e){return String(s??"");}
}

/* ----- 被覆資材（マルチ・藁）の模様。作物の帯の上に半透明で重ねるので、作物の色と文字は読める -----
   マルチ＝紺の斜線（右下がり）／藁＝黄の斜線（右上がり）。どちらも細い白線を添えて、暗い背景でも見えるようにする */
function mapDefs(){
  return `<pattern id="patMulch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4.5" height="10" fill="#1a237e" fill-opacity=".6"/><rect x="4.5" width="1.2" height="10" fill="#fff" fill-opacity=".75"/></pattern>
    <pattern id="patStraw" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="4.5" height="10" fill="#e0a800" fill-opacity=".7"/><rect x="4.5" width="1.2" height="10" fill="#fff" fill-opacity=".7"/></pattern>`;
}
const mapCvN=p=>{const c=coverOf(p);return (c.mulch?1:0)+(c.straw?1:0);};
// 帯の全面にかぶせる模様（被覆資材がなければ空）
function mapCoverOverlay(p,rx){
  const c=coverOf(p);
  return (c.mulch?`<rect class="cv" width="100%" height="100%" rx="${rx}" fill="url(#patMulch)"/>`:"")+(c.straw?`<rect class="cv" width="100%" height="100%" rx="${rx}" fill="url(#patStraw)"/>`:"");
}
// 帯の右上の角の丸い印（マ＝マルチ／藁）。帯が小さいときは出さない
function mapCoverBadges(p,bw,bh,K){
  const c=coverOf(p),list=[];
  if(c.mulch)list.push(["マ","#1a237e","#fff"]);
  if(c.straw)list.push(["藁","#e0a800","#3e2a00"]);
  const r=7*K;
  if(!list.length||bh<2*r+6||bw<(2*r+4)*list.length+24*K)return "";
  return list.map((b,n)=>{const cx=bw-r-4-n*(2*r+4),cy=r+4;
    return `<g class="cvb"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${b[1]}" stroke="#fff" stroke-width="1.5"/><text x="${cx}" y="${cy+r*0.38}" text-anchor="middle" style="font-size:${r*1.15}px;font-weight:700;fill:${b[2]}">${b[0]}</text></g>`;}).join("");
}

/* ----- 作物の色：名前ごとに必ず別の色。同じ名前は同じ色（db.cropColors に覚えて、共有ファイルにも入る） ----- */
function mapHsl(h,s,l){ // → #rrggbb
  s/=100;l/=100;const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l);
  const f=n=>{const v=l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));return Math.round(v*255).toString(16).padStart(2,"0");};
  return "#"+f(0)+f(8)+f(4);
}
const mapRgb=hex=>{const n=parseInt(hex.slice(1),16);return[n>>16,(n>>8)&255,n&255];};
function mapFarthest(used){ // 既に使った色から、いちばん離れた（見分けやすい）色を選ぶ
  const u=used.map(mapRgb);let best=null,bd=-1;
  for(let h=0;h<360;h+=6)for(const s of[65,45])for(const l of[30,40,50]){
    const c=mapHsl(h,s,l),r=mapRgb(c);
    const d=u.length?Math.min(...u.map(x=>(x[0]-r[0])**2+(x[1]-r[1])**2+(x[2]-r[2])**2)):1e9;
    if(d>bd){bd=d;best=c;}
  }
  return best;
}
function mapAssignColors(){
  const cc=db.cropColors=db.cropColors||{};let ch=false;
  [...new Set(db.plantings.map(mapCrop))].forEach(n=>{
    if(cc[n])return;
    const used=Object.values(cc);
    cc[n]=MAP_SEED.find(c=>!used.includes(c))||mapFarthest(used);ch=true;
  });
  if(ch)save(false,false,true); // 色を決めただけなので「元に戻す」には入れない
}
const mapColor=crop=>(db.cropColors&&db.cropColors[crop])||"#546e7a";

/* ----- その日(D)の区画の状態：育成中(grow) / 植付予定(plan) / 空き(empty) ----- */
const mapActive=(p,D)=>p.plantDate?(p.plantDate<=D&&(!p.harvestDate||p.harvestDate>=D)):(String(p.year)==D.slice(0,4)&&!p.harvestDate);
const mapHidden=(p,D)=>!p.harvestDate&&!!p.harvestPlan&&mapDays(p.harvestPlan,D)>MAP_GRACE; // 収穫予定日を3日超えた（収穫日の入力なし）
function mapState(pl,D){
  const ps=db.plantings.filter(p=>p.plotId==pl.id);
  const grow=ps.filter(p=>mapActive(p,D)&&!mapHidden(p,D))
    .sort((a,b)=>(b.plantDate||"").localeCompare(a.plantDate||""));
  // 1つの区画に複数の作物があれば、すべて list に入れる（栽培中が1つでもあれば栽培中を優先）
  if(grow.length)return{k:"grow",list:grow};
  const plan=ps.filter(p=>p.plantDate&&p.plantDate>D).sort((a,b)=>a.plantDate.localeCompare(b.plantDate));
  if(plan.length)return{k:"plan",list:plan};
  const prev=ps.filter(p=>p.plantDate&&p.plantDate<=D).sort((a,b)=>b.plantDate.localeCompare(a.plantDate))[0];
  return{k:"empty",list:[],prev};
}
// 栽培中の作物1つぶんの文字（作物名・植付からの日数・収穫まで）
function mapCropLines(p,D){
  const L=[mapCrop(p),p.plantDate?`植付から${mapDays(p.plantDate,D)}日`:"植付日 未入力"];
  if(p.harvestPlan){const d=mapDays(D,p.harvestPlan);L.push(d>=0?`収穫まで${d}日`:`予定を${-d}日超過`);}
  return L;
}
function mapLines(pl,st,D){ // 栽培中以外（植付予定・空き）の文字
  const L=[pl.name];
  if(st.k=="plan"){
    st.list.forEach(p=>L.push(`${mapCrop(p)} ${mapMD(p.plantDate)} 植付予定`));
  }else{
    L.push("空き");
    if(st.prev)L.push("前作："+mapCrop(st.prev));
  }
  return L;
}
// 作業日（元肥・追肥・土寄せ・間引き）を「元肥 3/1・追肥 4/10」の形に
const mapWorkText=p=>MAP_WORK.filter(w=>p[w[0]]).map(w=>`${w[1]} ${mapMD(p[w[0]])}`).join("・");

/* ----- 畑（マップ）の選択 ----- */
const mapHats=()=>db.fields.filter(inMode);
const mapCur=()=>{const l=mapHats();return l.find(f=>f.id==mapCurId)||l[0];};
const mapPlots=f=>(db.plots||[]).filter(p=>p.fieldId==f.id);

/* ----- 区画の色（自由に選べる）と方角 ----- */
const mapCustom=p=>/^#[0-9a-f]{6}$/i.test(p.mcolor||"")?p.mcolor:"";
function mapText(hex){ // 背景が明るければ黒、暗ければ白の文字にする
  const n=parseInt(hex.slice(1),16),r=n>>16,g=(n>>8)&255,b=n&255;
  return (0.299*r+0.587*g+0.114*b)>150?"#111":"#fff";
}
function mapSetColor(id,v){const p=db.plots.find(x=>x.id==id);if(!p)return;if(v)p.mcolor=v;else delete p.mcolor;save();render();}
function mapSetFlag(id,k,on){const p=db.plots.find(x=>x.id==id);if(!p)return;p[k]=!!on;save();render();} // 区画ごとの藁・マルチのチェック（以前の仕様。今は使わない）
// 作物ごとの被覆資材（マルチ・藁）のチェック。もう片方も今の表示のまま、はっきり記録する
function mapSetCover(pid,k,on){
  try{
    const p=db.plantings.find(x=>x.id==pid);
    if(!p||(k!="mulch"&&k!="straw"))throw new Error("対象の作付が見つかりません");
    const c=coverOf(p);p.mulch=c.mulch;p.straw=c.straw;
    p[k]=!!on;
    save();render();
  }catch(e){alert("被覆資材を保存できませんでした："+(e.message||e));}
}
const MAP_DIRS=["北","東","南","西"];
const mapTop=()=>{const f=mapCur(),k=f?+f.mapUp:0;return k>=0&&k<4?k:0;}; // 地図の上が向いている方角（0=北 1=東 2=南 3=西）
function mapSetTop(v){const f=mapCur();if(!f)return;f.mapUp=+v;save();render();}
// 地図の縁の方角ラベルと、右上のコンパス（北の向きを赤い矢印で示す）
function mapCompass(){
  const k=mapTop(),d=i=>MAP_DIRS[(k+i)%4],G=mapGeoLast;
  if(G.m){ // スマホ幅：方角の文字とコンパスは、地図の外の余白に置く（区画の文字と重ならない）
    const fs=15*G.k,r=36,cx=MAPW-52,cy=-54,th=-Math.PI/2*k;
    return `<g class="dir" style="font-size:${fs}px">
      <text x="${MAPW/2}" y="-10" text-anchor="middle" style="font-size:${fs}px">${d(0)}</text>
      <text x="${MAPW+34}" y="${MAPH/2+fs*0.35}" text-anchor="end" style="font-size:${fs}px">${d(1)}</text>
      <text x="${MAPW/2}" y="${MAPH+fs*0.95}" text-anchor="middle" style="font-size:${fs}px">${d(2)}</text>
      <text x="-34" y="${MAPH/2+fs*0.35}" style="font-size:${fs}px">${d(3)}</text>
      <g transform="translate(${cx},${cy})"><circle r="${r}" class="rose"/><g transform="rotate(${-90*k}) scale(1.2)"><path d="M0-26L7 4H-7Z" class="north"/><path d="M0 26L7-4H-7Z" class="south"/></g></g>
      <text x="${cx+20*Math.sin(th)}" y="${cy-20*Math.cos(th)+fs*0.25}" text-anchor="middle" class="nl nlm" style="font-size:${fs*0.7}px">北</text></g>`; // 北の印は、コンパスの中（北の矢印のそば）に出す
  }
  const lx=940+42*Math.sin(-Math.PI/2*k), ly=56-42*Math.cos(-Math.PI/2*k);
  return `<g class="dir">
    <text x="${MAPW/2}" y="16" text-anchor="middle">${d(0)}</text>
    <text x="${MAPW-8}" y="${MAPH/2}" text-anchor="end">${d(1)}</text>
    <text x="${MAPW/2}" y="${MAPH-6}" text-anchor="middle">${d(2)}</text>
    <text x="8" y="${MAPH/2}">${d(3)}</text>
    <g transform="translate(940,56)"><circle r="30" class="rose"/><g transform="rotate(${-90*k})"><path d="M0-26L7 4H-7Z" class="north"/><path d="M0 26L7-4H-7Z" class="south"/></g></g>
    <text x="${lx}" y="${ly+5}" text-anchor="middle" class="nl">北</text></g>`;
}

/* ----- 区画ごとの縁の太い枠（以前の仕様。藁・マルチは作物ごとの設定に変わったため、今は使わない） -----
   古いデータの plots.straw / plots.mulch は、作物側の coverOf() が引き継ぐ。関数は互換のために残す */
const mapRimN=pl=>0;
function mapRims(pl){
  let o="",k=0;
  MAP_RIMS.forEach(([f,c])=>{
    if(!pl[f])return;
    const i=k*MAP_RIM+MAP_RIM/2;
    o+=`<rect class="rim" data-k="${k}" x="${i}" y="${i}" width="${Math.max(2,pl.mw-2*i)}" height="${Math.max(2,pl.mh-2*i)}" rx="${Math.max(1,5-k*2)}" fill="none" stroke="${c}" stroke-width="${MAP_RIM}"/>`;
    k++;
  });
  return o;
}

/* ----- 作物の帯（区画の中の四角） ----- */
function mapBandHandle(bw,bh){ // 大きさを変える角の取っ手（細い帯でははみ出さない大きさ）
  const G=mapGeoLast,s=G.m?24/G.sc:(mapCoarse()?26:14),w=Math.min(s,bw),h=Math.min(s,bh);
  return{x:bw-w,y:bh-h,w,h};
}
function mapBandSvg(pl,list,i){
  const G=mapGeoLast,K=G.k;
  const p=list[i],b=mapBandBox(pl,list,i),bw=Math.max(4,b.w),bh=Math.max(4,b.h);
  const col=mapColor(mapCrop(p)),tc=mapText(col),lh=15*K,fit=Math.floor((bh-5*K)/lh);
  // スマホ幅では、長い文字を帯の幅に合わせて「…」で省略する（PCは今までどおり、はみ出た分は切れるだけ）
  const lines=mapCropLines(p,mapDate).map((t,j)=>G.m?mapFitText(t,bw-10*K,(j?13:14)*K):t);
  let tx;
  if(fit>=1)tx=lines.slice(0,fit).map((t,j)=>`<text x="${6}" y="${16*K+j*lh}" class="bt ${j?"":"b"}" style="fill:${tc}">${esc(t)}</text>`).join("");
  else{const fs=Math.max(6,Math.min(13*K,bh-2));tx=`<text x="4" y="${bh/2+fs*0.36}" class="bt" style="font-size:${fs}px;fill:${tc}">${esc(lines[0])}</text>`;} // 細い帯は作物名だけ
  const h=mapBandHandle(bw,bh);
  return `<svg data-pid="${p.id}" x="${b.x}" y="${b.y}" width="${bw}" height="${bh}"${mapEdit?` onpointerdown="event.stopPropagation();mapDownCrop(event,${pl.id},${p.id},'move')"`:""}><rect width="100%" height="100%" rx="4" fill="${col}"/>${mapCoverOverlay(p,4)}${tx}${mapCoverBadges(p,bw,bh,K)}${
    mapEdit?`<rect class="bh" x="${h.x}" y="${h.y}" width="${h.w}" height="${h.h}" onpointerdown="event.stopPropagation();mapDownCrop(event,${pl.id},${p.id},'size')"/>`:""}</svg>`;
}

/* ----- 画面 ----- */
function mapView(){
  const hats=mapHats();
  if(!hats.length)return `<div class="card"><h2>🗺 区画マップ</h2><p>まだ畑が登録されていません。先に「🥬 畑の一覧」で畑（例：北の畑）を登録すると、畑ごとのマップができます。</p>
    <div class="bar"><button class="b" onclick="edit('fields')">＋ 畑を追加</button></div></div>`;
  mapAssignColors();
  const cur=mapCur(),plots=mapPlots(cur);
  if(!plots.some(p=>p.id==mapSel))mapSel=null;
  const head=`<div class="bar"><h2 style="margin:0">🗺 区画マップ</h2>
      <span class="subtab"><button class="${mapSub=="map"?"on":""}" onclick="mapSub='map';render()">🗺 地図</button><button class="${mapSub=="time"?"on":""}" onclick="mapSub='time';mapTLScroll='today';render()">📅 履歴（時間軸）</button></span>
      <span class="mapsel"><select aria-label="畑（マップ）を選ぶ" onchange="mapCurId=+this.value;mapSel=null;mapTLPlot=0;render()">${hats.map(f=>`<option value="${f.id}" ${f.id==cur.id?"selected":""}>${esc(f.name)}</option>`).join("")}</select>
        <button class="g" onclick="edit('fields')" title="畑の一覧に新しい畑を登録します">＋ 畑を追加</button>
        <button class="g" onclick="edit('fields',${cur.id})">畑の情報を編集</button></span></div>`;
  if(mapSub=="time")return `<div class="card">${head}${mapTimeline(cur)}</div>`;

  const G=mapGeoLast=mapGeo(),K=G.k; // 画面の幅に合わせた見え方（PCは K=1 で今までどおり）
  const placed=plots.filter(p=>p.mx!=null),unplaced=plots.filter(p=>p.mx==null);
  // 被覆資材のある作物がある区画は、重なったときに手前へ出す（描く順番を後ろにする）。同じ点数なら今までの順
  const cvScore=pl=>{const st=mapState(pl,mapDate);return st.k=="grow"?Math.max(0,...st.list.map(mapCvN)):0;};
  const drawOrder=placed.map((p,i)=>[p,i,cvScore(p)]).sort((a,b)=>a[2]-b[2]||a[1]-b[1]).map(x=>x[0]);
  const shapes=drawOrder.map(pl=>{
    const st=mapState(pl,mapDate),cu=mapCustom(pl); // cu＝自分で決めた区画の色（栽培中は区画の地色、空き・予定は薄い地色）
    const col=cu||(st.list[0]?mapColor(mapCrop(st.list[0])):"");
    const style=`--c:${col||"transparent"};--t:${cu&&st.k=="grow"?mapText(cu):"var(--ink)"}${cu?`;--cu:${cu}`:""}`;
    const hz=G.m?Math.max(18,Math.min(30/G.sc,pl.mw*0.5,pl.mh*0.5)):(mapCoarse()?32:16); // 大きさを変える取っ手（スマホは指で押せる大きさ）
    const nameMax=pl.mw-16; // 区画名・文字を入れられる幅
    const fit=t=>G.m?mapFitText(t,nameMax,15*K):t; // スマホ幅だけ、長い名前を「…」にする
    let inner;
    if(st.k=="grow"){ // 作物ごとの帯を区画の中に置く（位置・大きさを決めていなければ、長い辺の向きに等分）
      // 被覆資材のある帯は、同じ区画の中で手前に出す（位置の計算は元の並びのまま、描く順番だけ変える）
      const order=st.list.map((p,i)=>i).sort((a,b)=>mapCvN(st.list[a])-mapCvN(st.list[b])||a-b);
      inner=`<text x="8" y="${18*K}" class="b">${esc(fit(pl.name))}</text>`+order.map(i=>mapBandSvg(pl,st.list,i)).join("");
    }else inner=mapLines(pl,st,mapDate).map((t,i)=>`<text x="8" y="${(20+i*17)*(G.m?K*0.9:1)}" class="${i?"":"b"}">${esc(fit(t))}</text>`).join("");
    return `<g class="fz ${st.k} ${cu&&st.k!="grow"?"tint":""} ${pl.id==mapSel?"sel":""}" style="${style}" transform="translate(${pl.mx},${pl.my})" onpointerdown="mapDown(event,${pl.id},'move')">
      <clipPath id="cp${pl.id}"><rect width="${pl.mw}" height="${pl.mh}"/></clipPath>
      <rect class="bg" width="${pl.mw}" height="${pl.mh}" rx="6"/>
      <g class="inner" clip-path="url(#cp${pl.id})">${inner}</g>
      ${mapEdit?`<rect class="hd" x="${pl.mw-hz/2}" y="${pl.mh-hz/2}" width="${hz}" height="${hz}" onpointerdown="event.stopPropagation();mapDown(event,${pl.id},'size')"/>`:""}
    </g>`;
  }).join("");
  // 凡例（いま地図に出ている作物）
  const crops=[...new Set(placed.flatMap(p=>mapState(p,mapDate).list).map(mapCrop))];
  const legend=crops.map(c=>`<span class="maplg"><i style="background:${mapColor(c)}"></i>${esc(c)}</span>`).join("")
    +`<span class="maplg"><i style="border:2px dashed var(--sub);background:var(--card)"></i>空き</span>`
    +`<span class="maplg"><i style="border:2px solid var(--sub);background:var(--main2)"></i>植付予定</span>`
    +`<span class="maplg"><i class="cvsw mulch"></i>マルチ（紺の斜線）</span><span class="maplg"><i class="cvsw straw"></i>藁（黄の斜線）</span><span class="maplg"><i class="cvsw both"></i>マルチ＋藁</span>`;
  const empties=placed.filter(p=>mapState(p,mapDate).k=="empty").length;
  const loose=db.plantings.filter(p=>p.fieldId==cur.id&&!p.plotId); // 区画を決めていない作付
  const selPl=placed.find(p=>p.id==mapSel);
  return `<div class="card">${head}
    <div class="bar">
      <span class="mapdate"><label style="margin:0">基準日 <input type="date" value="${esc(mapDate)}" onchange="mapDate=this.value||today();render()"></label>
      <button class="g" onclick="mapDate=today();render()">今日</button></span>
      <span class="maptop"><label style="margin:0">地図の上＝<select onchange="mapSetTop(this.value)">${MAP_DIRS.map((n,i)=>`<option value="${i}" ${i==mapTop()?"selected":""}>${n}</option>`).join("")}</select></label>
      <button class="g" onclick="mapAddPlot()">＋ 区画を追加</button>
      <button class="${mapEdit?"b":"g"}" onclick="mapEdit=!mapEdit;render()">${mapEdit?"✔ 配置を終わる":"✏ 配置を編集"}</button></span></div>
    <p class="hint">「${esc(cur.name)}」を区画に分けて並べます（例：A区・北側）。区画を押すと、下に詳しい情報が出ます。基準日を変えると、その日に何を植えていたか（前の年の作付など）が見られます。収穫予定日を${MAP_GRACE}日過ぎた作物は、収穫日を入れなくても地図から消えます。マルチ・藁は作物ごとに設定し、作物の帯に斜線の模様（マルチ＝紺、藁＝黄）が重なります。${mapEdit?"<b>区画をドラッグして移動、右下の黄色い四角をドラッグして大きさを変えられます。スマホでは、区画を選ぶと地図の下に「ボタンで調整」が出ます。</b>":"位置や大きさを変えるときは「配置を編集」を押してください。"}</p>
    ${!plots.length?`<p class="hint">「＋ 区画を追加」を押すと、名前を付けた区画がそのまま地図に置かれます（先に登録する必要はありません）。</p>`:""}
    ${unplaced.length?`<div class="bar"><span class="hint">地図に置いていない区画：</span>${unplaced.map(p=>`<button class="g" onclick="mapPlace(${p.id})">＋ ${esc(p.name)}</button>`).join("")}</div>`:""}
    <div class="scroll mapscroll"><svg id="mapSvg" class="mapsvg ${mapEdit?"edit":""}" viewBox="${G.vb.join(" ")}"${G.m?` style="--fs:${K.toFixed(2)}"`:""} role="img" aria-label="${esc(cur.name)}の区画マップ">
      <defs><pattern id="mapGrid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" class="grid"/></pattern>${mapDefs()}</defs>
      <rect width="${MAPW}" height="${MAPH}" fill="url(#mapGrid)" onpointerdown="mapSel=null;render()"/>
      ${shapes}
      ${mapCompass()}</svg></div>
    ${mapEdit&&selPl?mapAdjust(selPl):""}
    <div style="margin-top:8px">${legend}</div>
    ${placed.length?`<p class="hint">${placed.length}区画のうち、${mapDate} に空いているのは<b>${empties}</b>区画です。</p>`:""}
    ${loose.length?`<p class="hint">この畑の作付のうち、区画を決めていないもの（地図には出ません）：${loose.map(p=>`<button class="g" onclick="edit('plantings',${p.id})">${esc(plantLabel(p))}</button>`).join(" ")}<br>編集で「区画」を選ぶと、地図に出ます。</p>`:""}
  </div>${mapPanel(cur)}`;
}

// 選んだ区画の詳しい情報と、作付の履歴
function mapPanel(cur){
  const pl=(db.plots||[]).find(x=>x.id==mapSel);
  if(!pl)return "";
  const st=mapState(pl,mapDate);
  const ps=db.plantings.filter(p=>p.plotId==pl.id).sort((a,b)=>(b.plantDate||b.year+"").localeCompare(a.plantDate||a.year+""));
  const hid=ps.filter(p=>mapActive(p,mapDate)&&mapHidden(p,mapDate));
  const pre=`{fieldId:${cur.id},plotId:${pl.id},year:${+mapDate.slice(0,4)},plantDate:'${mapDate}'}`;
  return `<div class="card"><div class="bar"><h2 style="margin:0">${esc(cur.name)}　${esc(pl.name)}</h2>
      <button class="b" onclick="edit('plantings',null,null,${pre})">＋ この区画に作付を追加</button>
      <button class="g" onclick="edit('plots',${pl.id})">区画の情報を編集</button>
      ${mapEdit&&pl.mx!=null?`<button class="g" onclick="mapUnplace(${pl.id})">地図から外す</button>`:""}
      ${ps.some(p=>p.sx!=null)?`<button class="g" onclick="mapResetBands(${pl.id})">作物の配置を自動に戻す</button>`:""}
      <button class="g d" onclick="del('plots',${pl.id})">区画を削除</button></div>
    <div class="bar"><label style="margin:0">区画の色 <input type="color" value="${mapCustom(pl)||(st.list[0]?mapColor(mapCrop(st.list[0])):"#9e9e9e")}" onchange="mapSetColor(${pl.id},this.value)"></label>
      ${mapCustom(pl)?`<button class="g" onclick="mapSetColor(${pl.id},'')">作物の色に戻す</button>`:`<span class="hint">色を選ぶと、この区画の地色（枠・見出し）がその色になります。作物の帯は作物ごとの色のままです。</span>`}</div>
    <p>${mapDate} の状態：<b>${st.k=="grow"?esc(st.list.map(p=>mapCrop(p)+(mapCvN(p)?"（"+coverText(p)+"）":"")).join("・"))+" を栽培中":st.k=="plan"?esc(st.list.map(p=>mapCrop(p)+"（"+mapMD(p.plantDate)+"）").join("・"))+" の植付予定":"空き"+(st.prev?"（前作："+esc(mapCrop(st.prev))+"）":"")}</b></p>
    ${hid.length?`<p class="hint">収穫予定日を${MAP_GRACE}日以上過ぎているため、地図に出していない作物：${esc(hid.map(mapCrop).join("・"))}（収穫日を入れるか、予定日を直すと整理されます）</p>`:""}
    <p class="hint">1つの区画に複数の作物を入れるには、「＋ この区画に作付を追加」で、同じ区画に作物を続けて登録します。栽培中の作物が、区画の中に帯で並びます。「配置を編集」にすると、帯をドラッグして位置を、帯の右下の白い四角で大きさ（縦に細くもできます）を決められます。</p>
    ${pl.note?`<p class="hint">メモ：${esc(pl.note)}</p>`:""}
    <div class="scroll"><table class="lt"><tr class="hd"><th>年産</th><th>作物</th><th>植付日</th><th>収穫予定日</th><th>収穫日</th><th>被覆資材</th><th>作業</th><th></th></tr>
    ${ps.map(p=>{const cv=coverOf(p);return `<tr><td data-label="年産">${esc(p.year)}</td><td data-label="作物">${esc(mapCrop(p))}</td>
      <td data-label="植付日">${hy(esc(p.plantDate))}</td><td data-label="収穫予定日">${hy(esc(p.harvestPlan))}</td><td data-label="収穫日">${hy(esc(p.harvestDate))}</td>
      <td data-label="被覆資材"><label class="chk"><input type="checkbox" ${cv.mulch?"checked":""} onchange="mapSetCover(${p.id},'mulch',this.checked)"> マルチ</label> <label class="chk"><input type="checkbox" ${cv.straw?"checked":""} onchange="mapSetCover(${p.id},'straw',this.checked)"> 藁</label></td>
      <td data-label="作業">${hy(esc(mapWorkText(p)))}</td>
      <td class="act"><button class="g" onclick="edit('plantings',${p.id})">編集</button> <button class="g d" onclick="del('plantings',${p.id})">削除</button></td></tr>`;}).join("")
      ||`<tr><td colspan="8" class="hint">この区画の作付はまだありません</td></tr>`}
    </table></div></div>`;
}

/* ----- スマホ向け：ボタンとスライダーで、区画・作物の位置と大きさを調整する ----- */
function mapAdjust(pl){
  const st=mapState(pl,mapDate),list=st.k=="grow"?st.list:[];
  const bt=(l,a,t)=>`<button class="g" onclick="${a}" aria-label="${t}">${l}</button>`;
  const sl=(p,i,k,l,min)=>{
    const b=mapBandBox(pl,list,i),v=Math.round({x:b.x/pl.mw,y:b.y/pl.mh,w:b.w/pl.mw,h:b.h/pl.mh}[k]*100);
    return `<label class="sl">${l} <b>${v}%</b><input type="range" min="${min}" max="100" step="1" value="${v}" oninput="this.previousElementSibling.textContent=this.value+'%'" onchange="mapCropSet(${p.id},'${k}',this.value)"></label>`;
  };
  return `<div class="mapadj"><b>選んだ区画「${esc(pl.name)}」をボタンで調整</b>
    <div class="adjrow"><span>位置</span>${bt("▲",`mapNudge(${pl.id},0,-10,0,0)`,"上へ")}${bt("▼",`mapNudge(${pl.id},0,10,0,0)`,"下へ")}${bt("◀",`mapNudge(${pl.id},-10,0,0,0)`,"左へ")}${bt("▶",`mapNudge(${pl.id},10,0,0,0)`,"右へ")}</div>
    <div class="adjrow"><span>幅</span>${bt("−",`mapNudge(${pl.id},0,0,-10,0)`,"幅をせまく")}${bt("＋",`mapNudge(${pl.id},0,0,10,0)`,"幅を広く")}
      <span>高さ</span>${bt("−",`mapNudge(${pl.id},0,0,0,-10)`,"高さをひくく")}${bt("＋",`mapNudge(${pl.id},0,0,0,10)`,"高さを高く")}</div>
    ${list.map((p,i)=>`<div class="adjcrop"><b><i class="sw" style="background:${mapColor(mapCrop(p))}"></i> ${esc(mapCrop(p))}（区画の中の位置・大きさ）</b>
      <div class="adjsl">${sl(p,i,"x","左右の位置",0)}${sl(p,i,"y","上下の位置",0)}${sl(p,i,"w","幅",2)}${sl(p,i,"h","高さ（細くできます）",2)}</div></div>`).join("")}
    ${list.length?"":`<p class="hint">栽培中の作物がある区画では、作物の位置と大きさもここで調整できます。</p>`}</div>`;
}
function mapNudge(id,dx,dy,dw,dh){
  const pl=db.plots.find(x=>x.id==id);if(!pl||pl.mx==null)return;
  const w=mapClamp(pl.mw+dw,60,MAPW),h=mapClamp(pl.mh+dh,40,MAPH);
  Object.assign(pl,{mw:w,mh:h,mx:mapClamp(pl.mx+dx,0,MAPW-w),my:mapClamp(pl.my+dy,0,MAPH-h)});
  save();render();
}
function mapCropSet(pid,k,v){
  const p=db.plantings.find(x=>x.id==pid),pl=p&&db.plots.find(x=>x.id==p.plotId);if(!pl)return;
  mapFreeze(pl,mapState(pl,mapDate).list);
  let x=p.sx,y=p.sy,w=p.sw,h=p.sh;const f=Math.round(+v)/100,r=n=>Math.round(n*1000)/1000;
  if(k=="x")x=mapClamp(f,0,1-w);
  if(k=="y")y=mapClamp(f,0,1-h);
  if(k=="w")w=mapClamp(f,0.02,1-x);
  if(k=="h")h=mapClamp(f,0.02,1-y);
  Object.assign(p,{sx:r(x),sy:r(y),sw:r(w),sh:r(h)});
  save();render();
}

/* ----- 配置 ----- */
const mapSnap=v=>Math.round(v/MAPSNAP)*MAPSNAP;
const mapClamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function mapAddPlot(){ // 名前を付けると、区画を作ってそのまま地図に置く
  const cur=mapCur();if(!cur)return;
  const def=`区画${mapPlots(cur).length+1}`;
  const n=prompt("区画の名前（例：A区・北側・手前）",def);
  if(n===null)return;
  const pl={id:uid(),fieldId:cur.id,name:n.trim()||def,div:DIV()};
  (db.plots=db.plots||[]).push(pl);
  mapPlace(pl.id);
}
function mapPlace(id){ // 地図の空いている場所に置く
  const pl=db.plots.find(x=>x.id==id);if(!pl)return;
  const w=140,h=100;
  const others=mapPlots(mapCur()).filter(o=>o.id!=id&&o.mx!=null);
  let px=10,py=10;
  find:for(let y=10;y<=MAPH-h;y+=10)for(let x=10;x<=MAPW-w;x+=10){
    if(!others.some(o=>x<o.mx+o.mw+10&&x+w+10>o.mx&&y<o.my+o.mh+10&&y+h+10>o.my)){px=x;py=y;break find;}
  }
  Object.assign(pl,{mx:px,my:py,mw:w,mh:h});
  mapSel=id;mapEdit=true;mapSub="map";save();render();
}
function mapUnplace(id){
  const pl=db.plots.find(x=>x.id==id);if(!pl)return;
  delete pl.mx;delete pl.my;delete pl.mw;delete pl.mh;
  save();render();
}
/* ----- 区画の中の作物（帯）の位置と大きさ -----
   作付(planting)に sx,sy,sw,sh（区画に対する割合 0〜1）を保存する。無ければ等分で自動配置。 */
function mapBandBox(pl,list,i){ // 帯の位置と大きさ（区画の中の座標）
  const p=list[i];
  if(p.sx!=null)return{x:p.sx*pl.mw,y:p.sy*pl.mh,w:p.sw*pl.mw,h:p.sh*pl.mh};
  const rw=mapRimN(pl)*MAP_RIM; // 藁・マルチの枠の内側に置く
  const n=list.length,x0=6+rw,y0=8+18*mapGeoLast.k+rw,gap=3,aw=Math.max(10,pl.mw-12-2*rw),ah=Math.max(10,pl.mh-y0-6-rw),horiz=aw>=ah; // y0＝区画名の下から（PCは26。スマホは文字が大きいぶん下げる）
  const bw=horiz?(aw-gap*(n-1))/n:aw,bh=horiz?ah:(ah-gap*(n-1))/n;
  return horiz?{x:x0+i*(bw+gap),y:y0,w:bw,h:bh}:{x:x0,y:y0+i*(bh+gap),w:bw,h:bh};
}
function mapFreeze(pl,list){ // 自動配置のままの帯に、今の位置を書き込む
  const r=v=>Math.round(v*1000)/1000;
  list.forEach((p,i)=>{if(p.sx==null){const b=mapBandBox(pl,list,i);Object.assign(p,{sx:r(b.x/pl.mw),sy:r(b.y/pl.mh),sw:r(b.w/pl.mw),sh:r(b.h/pl.mh)});}});
}
function mapResetBands(id){
  db.plantings.forEach(p=>{if(p.plotId==id){delete p.sx;delete p.sy;delete p.sw;delete p.sh;}});
  save();render();
}
function mapDownCrop(e,plotId,pid,how){
  const pl=db.plots.find(x=>x.id==plotId);if(!pl)return;
  const list=mapState(pl,mapDate).list,i=list.findIndex(p=>p.id==pid);if(i<0)return;
  const b=mapBandBox(pl,list,i),pt=mapPt(e);
  mapDrag={crop:pid,id:plotId,how,sx:pt.x,sy:pt.y,ox:b.x/pl.mw,oy:b.y/pl.mh,ow:b.w/pl.mw,oh:b.h/pl.mh,moved:false,cur:null,g:e.currentTarget.closest("svg[data-pid]")};
  e.preventDefault();
}
function mapPt(e){ // 画面の座標 → 地図の座標（Safariでも安定するよう、表示サイズから計算する。スマホ幅は余白ぶん表示範囲がずれている）
  const s=$("mapSvg"),r=s.getBoundingClientRect(),[vx,vy,vw,vh]=mapGeoLast.vb,k=Math.min(r.width/vw,r.height/vh)||1;
  return{x:vx+(e.clientX-r.left-(r.width-vw*k)/2)/k,y:vy+(e.clientY-r.top-(r.height-vh*k)/2)/k};
}
function mapDown(e,id,how){
  const pl=db.plots.find(x=>x.id==id);if(!pl)return;
  const p=mapPt(e);
  mapDrag={id,how,sx:p.x,sy:p.y,ox:pl.mx,oy:pl.my,ow:pl.mw,oh:pl.mh,moved:false,cur:null,g:e.currentTarget.closest("g.fz")};
  if(mapEdit)e.preventDefault();
}
document.addEventListener("pointermove",e=>{
  const d=mapDrag;if(!d||!mapEdit||!$("mapSvg"))return;
  const p=mapPt(e),dx=p.x-d.sx,dy=p.y-d.sy;
  if(!d.moved&&Math.abs(dx)+Math.abs(dy)<4)return;
  d.moved=true;
  if(d.crop){ // 区画の中の作物の帯を動かす／大きさを変える（区画に対する割合で扱う）
    const pl=db.plots.find(x=>x.id==d.id);if(!pl)return;
    let x=d.ox,y=d.oy,w=d.ow,h=d.oh;
    if(d.how=="move"){x=mapClamp(d.ox+dx/pl.mw,0,1-w);y=mapClamp(d.oy+dy/pl.mh,0,1-h);}
    else{w=mapClamp(d.ow+dx/pl.mw,0.02,1-x);h=mapClamp(d.oh+dy/pl.mh,0.02,1-y);}
    d.cur={x,y,w,h};
    const bw=Math.max(4,w*pl.mw),bh=Math.max(4,h*pl.mh);
    d.g.setAttribute("x",x*pl.mw);d.g.setAttribute("y",y*pl.mh);d.g.setAttribute("width",bw);d.g.setAttribute("height",bh);
    const hb=d.g.querySelector("rect.bh");
    if(hb){const q=mapBandHandle(bw,bh);hb.setAttribute("x",q.x);hb.setAttribute("y",q.y);hb.setAttribute("width",q.w);hb.setAttribute("height",q.h);}
    return;
  }
  let x=d.ox,y=d.oy,w=d.ow,h=d.oh;
  if(d.how=="move"){x=mapClamp(mapSnap(d.ox+dx),0,MAPW-w);y=mapClamp(mapSnap(d.oy+dy),0,MAPH-h);}
  else{w=mapClamp(mapSnap(d.ow+dx),60,MAPW-x);h=mapClamp(mapSnap(d.oh+dy),40,MAPH-y);}
  d.cur={x,y,w,h};
  // 動かしている間は図の見た目だけ更新する（離したときに保存する）
  d.g.setAttribute("transform",`translate(${x},${y})`);
  d.g.querySelectorAll("rect.bg,clipPath rect").forEach(r=>{r.setAttribute("width",w);r.setAttribute("height",h);});
  d.g.querySelectorAll("rect.rim").forEach(r=>{const i=+r.dataset.k*MAP_RIM+MAP_RIM/2;r.setAttribute("width",Math.max(2,w-2*i));r.setAttribute("height",Math.max(2,h-2*i));});
  if(d.how=="size"){const iw=d.g.querySelector(".inner");if(iw)iw.style.display="none";} // 大きさを変えている間は中の帯を隠す（離すと描き直す）
  const hd=d.g.querySelector("rect.hd");if(hd){const s=+hd.getAttribute("width");hd.setAttribute("x",w-s/2);hd.setAttribute("y",h-s/2);}
});
// 画面の幅が変わったとき（スマホの向きを変えた・ウィンドウを縮めた）、地図の見え方（PC／スマホ）が変わるなら描き直す
(function(){
  let t=null;
  const key=()=>{const g=mapGeo();return g.m+":"+Math.round(g.k*10);};
  let last=key();
  const chk=()=>{
    try{
      const k=key();
      if(k===last)return;
      if(typeof tab=="undefined"||tab!="map"||mapDrag)return; // 地図を開いていない間や、ドラッグ中は何もしない（次に開いたとき描き直される）
      const dl=document.getElementById("dlg");if(dl&&dl.open)return;
      last=k;render();
    }catch(e){console.error(e);}
  };
  const later=ms=>{clearTimeout(t);t=setTimeout(chk,ms);};
  window.addEventListener("resize",()=>later(200));
  window.addEventListener("orientationchange",()=>later(350));
})();
function mapUp(){
  const d=mapDrag;mapDrag=null;if(!d)return;
  const pl=db.plots.find(x=>x.id==d.id);if(!pl)return;
  if(d.crop){
    if(d.moved&&d.cur){
      mapFreeze(pl,mapState(pl,mapDate).list); // 動かさなかった帯も、今の見た目のまま固定する（重ならないように）
      const p=db.plantings.find(x=>x.id==d.crop),r=v=>Math.round(v*1000)/1000;
      if(p){Object.assign(p,{sx:r(d.cur.x),sy:r(d.cur.y),sw:r(d.cur.w),sh:r(d.cur.h)});save();}
    }
    mapSel=d.id;render();return;
  }
  if(d.moved&&d.cur){Object.assign(pl,{mx:d.cur.x,my:d.cur.y,mw:d.cur.w,mh:d.cur.h});save();}
  mapSel=d.id;render();
}
document.addEventListener("pointerup",mapUp);
document.addEventListener("pointercancel",()=>{if(mapDrag){mapDrag=null;render();}});
// iPhone・iPad の Safari は、図形の上でのドラッグでも画面がスクロールしてしまうことがあるので、ドラッグ中は止める
document.addEventListener("touchmove",e=>{if(mapDrag&&mapEdit&&e.cancelable)e.preventDefault();},{passive:false});

// 再描画（ボタンやスライダーを操作したとき）で、地図・時間軸の横スクロール位置が先頭に戻らないようにする
const mapRenderBase=render;
render=function(){
  const keep={};
  [".mapscroll",".tlscroll"].forEach(c=>{const s=document.querySelector(c);if(s)keep[c]=s.scrollLeft;});
  mapRenderBase();
  Object.keys(keep).forEach(c=>{const s=document.querySelector(c);if(s&&keep[c])s.scrollLeft=keep[c];});
  mapTLApplyScroll();
};
