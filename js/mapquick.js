"use strict";
// 区画マップの「かんたん入力」：区画を押すと画面の下から出る小さな入力画面（作物を植える・収穫を記録する）
/* ========== 区画マップ：かんたん入力 ==========
   ・区画を押す（map.js の mapTap）と、この画面が開く。スマホでは画面の下から、PCでは中央に出る
   ・栽培中の作物には「収穫した」ボタン（基準日を収穫日として記録）と「編集」ボタン
   ・「作物を植える」は、作物名・植付日・収穫予定日・マルチ／藁だけで登録できる
     - 前に植えた作物はボタンで選べる（同じ作物の前回の栽培日数から、収穫予定日の目安を自動で入れる）
     - 収穫予定日は「30日後」などのボタンでも入れられる
   ・苗の入手先・作業日などの細かい項目は「詳しく入力」から、今までの入力画面（edit.js）で入れる
   ・保存するデータの形は、今までの作付(plantings)と同じ（新しい項目は増やしていない） */
const MAPQ_DAYS=[30,60,90,120];   // 収穫予定日のボタン（植付日から◯日後）
const MAPQ_CHIPS=12;              // 「前に植えた作物」のボタンの数（新しい順）
let mapQPlot=null;                // 今ひらいている区画の id

// 「YYYY-MM-DD」に n 日を足す（端末の日付で計算。時差で前日にずれないよう、年月日を数字で扱う）
function mapQAddDays(s,n){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s||""));
  if(!m)return "";
  const d=new Date(+m[1],+m[2]-1,+m[3]+(+n||0));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
// 前に植えた作物の名前（今のモード＝畑の作付から。新しく植えた順、同じ名前は1つ）
function mapQCrops(){
  const seen=new Set(),out=[];
  db.plantings.filter(p=>inMode(p)&&String(p.variety||"").trim())
    .sort((a,b)=>String(b.plantDate||b.year||"").localeCompare(String(a.plantDate||a.year||""))||(+b.id||0)-(+a.id||0))
    .forEach(p=>{const n=mapCrop(p);if(!seen.has(n)){seen.add(n);out.push(n);}});
  return out.slice(0,MAPQ_CHIPS);
}
// その作物を前に育てたときの日数（植付日から、収穫日または収穫予定日まで）。分からなければ 0
function mapQLastDays(crop){
  const p=db.plantings.filter(x=>inMode(x)&&mapCrop(x)==crop&&x.plantDate&&(x.harvestDate||x.harvestPlan))
    .sort((a,b)=>b.plantDate.localeCompare(a.plantDate))[0];
  if(!p)return 0;
  const d=mapDays(p.plantDate,p.harvestDate||p.harvestPlan);
  return d>0&&d<800?d:0;
}
// 画面の下に短いお知らせを出す（保存できたことが、地図を見たままで分かるように）
function mapToast(msg){
  try{
    let t=$("mapToast");
    if(!t){t=document.createElement("div");t.id="mapToast";t.setAttribute("role","status");document.body.appendChild(t);}
    t.textContent=msg;t.classList.add("on");
    clearTimeout(mapToast.timer);
    mapToast.timer=setTimeout(()=>t.classList.remove("on"),3200);
  }catch(e){console.error(e);}
}

/* ----- 画面を開く ----- */
function mapQuickOpen(plotId){
  try{
    const pl=(db.plots||[]).find(x=>x.id==plotId);
    if(!pl)throw new Error("区画が見つかりません");
    const f=db.fields.find(x=>x.id==pl.fieldId);
    mapQPlot=pl.id;
    $("qsFrm").innerHTML=mapQuickHtml(pl,f);
    mapQuickBind();
    const dlg=$("qs");
    if(!dlg.open)dlg.showModal();
    // 空いている区画なら、すぐ作物名を入れられるようにする（スマホではキーボードが地図を隠すので、PCだけ）
    const v=$("qsFrm").elements["variety"];
    if(v&&!mapCoarse()&&mapState(pl,mapDate).k=="empty")v.focus();
  }catch(e){console.error(e);alert("入力画面を開けませんでした："+(e.message||e));}
}
function mapQuickClose(){try{const d=$("qs");if(d.open)d.close("cancel");}catch(e){console.error(e);}}

function mapQuickHtml(pl,f){
  const st=mapState(pl,mapDate),D=mapDate;
  const ps=db.plantings.filter(p=>p.plotId==pl.id);
  const late=ps.filter(p=>mapActive(p,D)&&mapHidden(p,D)); // 収穫予定日を過ぎて地図から消えている作物（収穫日の入力なし）
  const stTxt=st.k=="grow"?`${st.list.length}つの作物を栽培中`:st.k=="plan"?"植付予定あり":"空き"+(st.prev?"（前作："+mapCrop(st.prev)+"）":"");
  const sw=p=>`<i class="sw" style="background:${mapColor(mapCrop(p))}"></i>`;
  // 作物1つぶんの行
  const row=(p,sub,harvest)=>`<div class="qsc">${sw(p)}<div class="qsn"><b>${esc(mapCrop(p))}</b><span>${esc(sub)}</span></div>
      ${harvest?`<button type="button" class="b" onclick="mapQuickHarvest(${+p.id})">🧺 収穫した</button>`:""}
      <button type="button" class="g" onclick="mapQuickEdit(${+p.id})">編集</button></div>`;
  const growRows=st.k=="grow"?st.list.map(p=>{
    const L=mapCropLines(p,D).slice(1),cv=mapCvN(p)?coverText(p):"";
    return row(p,[...L,cv].filter(Boolean).join("・"),true);
  }).join(""):"";
  const lateRows=late.map(p=>row(p,`収穫予定日（${mapMD(p.harvestPlan)}）を過ぎています。収穫したら記録してください`,true)).join("");
  const planRows=(st.k=="plan"?st.list:ps.filter(p=>p.plantDate&&p.plantDate>D).sort((a,b)=>a.plantDate.localeCompare(b.plantDate)))
    .map(p=>row(p,`${mapMD(p.plantDate)} 植付予定`,false)).join("");
  const crops=mapQCrops();
  const has=!!(growRows||lateRows||planRows); // 作物の行があるか（あるときは、植える入力欄をたたんでおく）
  return `<div class="qsh"><div class="qst"><b>${esc(f?f.name:"")}　${esc(pl.name)}</b><span>${esc(D)}：${esc(stTxt)}</span></div>
      <button type="button" class="g qsx" aria-label="閉じる" onclick="mapQuickClose()">✕</button></div>
    <div class="fbody qsbody">
      ${has?`<div class="qsl">${growRows}${lateRows}${planRows}</div>
        ${growRows||lateRows?`<p class="hint">「収穫した」を押すと、基準日（${esc(D)}）を収穫日として記録します。</p>`:""}`:""}
      ${has?`<details class="qsmore" id="qsMore"><summary>🌱 この区画にもう1つ植える</summary>`:`<h3 class="qsh3">🌱 作物を植える</h3>`}
      <label>作物名 <span class="rq">※</span>
        <input name="variety" type="text" autocomplete="off" enterkeyhint="done" placeholder="例：大根、ネギ" maxlength="60"></label>
      ${crops.length?`<div class="qchips" id="qsCrops" aria-label="前に植えた作物から選ぶ">${crops.map(c=>`<button type="button" class="qchip" data-crop="${esc(c)}"><i class="sw" style="background:${mapColor(c)}"></i>${esc(c)}</button>`).join("")}</div>`:""}
      <div class="q2">
        <label>植付日 <span class="rq">※</span><input name="plantDate" type="date" value="${esc(D)}" required></label>
        <label>収穫予定日（目安）<input name="harvestPlan" type="date" value=""></label>
      </div>
      <div class="qchips" id="qsDays" aria-label="収穫予定日を植付日からの日数で入れる"><span class="hint">植付日から</span>${MAPQ_DAYS.map(n=>`<button type="button" class="qchip" data-days="${n}">${n}日後</button>`).join("")}<button type="button" class="qchip" data-days="0">なし</button></div>
      <p class="hint" id="qsHint" hidden></p>
      <div class="qchips"><label class="chk"><input type="checkbox" name="mulch"> マルチ</label><label class="chk"><input type="checkbox" name="straw"> 藁</label></div>
      ${has?"</details>":""}
    </div>
    <div class="fbar" id="qsBar" ${has?"hidden":""}><button class="b" value="ok">🌱 植える</button><button type="button" class="g" onclick="mapQuickFull()">詳しく入力</button></div>
    ${has?`<div class="fbar" id="qsBar0"><button type="button" class="g" onclick="mapQuickClose()">閉じる</button></div>`:""}`;
}

/* ----- 入力欄の動き（作物のボタン・日数のボタン） ----- */
function mapQuickBind(){
  const frm=$("qsFrm"),el=frm.elements,hint=$("qsHint");
  let autoDays=0; // 収穫予定日を「植付日から◯日後」で入れたときの日数（植付日を変えたら、予定日も一緒に動かす）
  const setPlan=(days,why)=>{
    autoDays=days;
    el["harvestPlan"].value=days?mapQAddDays(el["plantDate"].value,days):"";
    document.querySelectorAll("#qsDays .qchip").forEach(b=>b.classList.toggle("on",!!days&&+b.dataset.days==days));
    if(hint){hint.hidden=!why;hint.textContent=why||"";}
  };
  const pickCrop=name=>{
    el["variety"].value=name;
    document.querySelectorAll("#qsCrops .qchip").forEach(b=>b.classList.toggle("on",b.dataset.crop==name));
    // 収穫予定日が空か、自動で入れたままなら、前回の栽培日数から目安を入れる
    if(!el["harvestPlan"].value||autoDays){
      const d=mapQLastDays(name);
      if(d)setPlan(d,`前回の「${name}」は植付から${d}日でした。同じ日数で収穫予定日を入れました（変えられます）。`);
    }
  };
  document.querySelectorAll("#qsCrops .qchip").forEach(b=>b.addEventListener("click",()=>pickCrop(b.dataset.crop)));
  document.querySelectorAll("#qsDays .qchip").forEach(b=>b.addEventListener("click",()=>setPlan(+b.dataset.days,"")));
  el["variety"].addEventListener("input",()=>document.querySelectorAll("#qsCrops .qchip").forEach(b=>b.classList.toggle("on",b.dataset.crop==el["variety"].value.trim())));
  el["plantDate"].addEventListener("change",()=>{if(autoDays)setPlan(autoDays,hint&&!hint.hidden?hint.textContent:"");});
  el["harvestPlan"].addEventListener("change",()=>{autoDays=0;document.querySelectorAll("#qsDays .qchip").forEach(b=>b.classList.remove("on"));if(hint)hint.hidden=true;}); // 自分で日付を選んだら、自動の連動をやめる
  frm.onsubmit=mapQuickSubmit;
  // 「もう1つ植える」を開いたときだけ、下の「植える」ボタンを出す（たたんでいる間は入力欄を無効にして、送信の対象から外す）
  const more=$("qsMore"),bar=$("qsBar"),bar0=$("qsBar0");
  if(more&&bar){
    const sync=()=>{
      bar.hidden=!more.open;if(bar0)bar0.hidden=more.open;
      more.querySelectorAll("input").forEach(i=>i.disabled=!more.open);
    };
    more.addEventListener("toggle",sync);sync();
  }
}
// 入力欄の値を読む（確認つき）。問題があれば理由を投げる
function mapQuickRead(strict){
  const el=$("qsFrm").elements;
  const o={variety:el["variety"].value.trim(),plantDate:el["plantDate"].value,harvestPlan:el["harvestPlan"].value,mulch:el["mulch"].checked,straw:el["straw"].checked};
  if(!strict)return o;
  if(!o.variety)throw new Error("作物名を入れてください（前に植えた作物は、ボタンで選べます）");
  if(!validDate(o.plantDate))throw new Error("植付日を選んでください");
  if(o.harvestPlan&&!validDate(o.harvestPlan))throw new Error("収穫予定日が正しい日付ではありません");
  if(o.harvestPlan&&o.harvestPlan<o.plantDate)throw new Error("収穫予定日が、植付日より前になっています");
  return o;
}
function mapQuickSubmit(ev){
  try{
    if(ev.submitter&&ev.submitter.value=="cancel")return;
    const pl=(db.plots||[]).find(x=>x.id==mapQPlot);
    if(!pl)throw new Error("区画が見つかりません（削除された可能性があります）");
    const o=mapQuickRead(true);
    // 今までの入力画面（edit.js）で作る作付と同じ形で保存する
    const f=db.fields.find(x=>x.id==pl.fieldId);
    const rec={year:+o.plantDate.slice(0,4),fieldId:pl.fieldId,plotId:pl.id,variety:o.variety,purpose:"野菜・畑作",
      seedSource:"",seedQty:"",plantDate:o.plantDate,harvestPlan:o.harvestPlan,harvestDate:"",yield:"",mulch:o.mulch,straw:o.straw,
      baseFert:"",topdress:"",hill1:"",hill2:"",thinning:"",note:"",div:f?divOf(f):DIV()};
    // 今までの入力画面と同じ検証を通す（必須・数値の範囲・圃場と区画の組み合わせ）
    const err=recordError(rec,ENT.plantings.cols.filter(c=>!c.calc));
    if(err)throw new Error(err);
    rec.id=uid();
    db.plantings.push(rec);
    save();render();
    mapToast(`「${o.variety}」を ${pl.name} に植えました${o.plantDate>mapDate?"（植付予定）":""}`);
  }catch(e){
    ev.preventDefault(); // 画面は閉じずに、直してもらう
    alert(e.message||String(e));
  }
}
/* ----- 作物ごとの操作 ----- */
// 収穫した：基準日を収穫日として記録する（今日以外の日を見ているときは、その日で記録してよいか確かめる）
function mapQuickHarvest(pid){
  try{
    const p=db.plantings.find(x=>x.id==pid);
    if(!p)throw new Error("作付が見つかりません");
    const D=mapDate;
    if(p.plantDate&&D<p.plantDate)throw new Error("基準日が植付日より前です。基準日を直してから記録してください");
    if(D!=today()&&!confirm(`基準日の ${D} を「${mapCrop(p)}」の収穫日として記録しますか？\n（今日の日付で記録するには、地図の「今日」を押してからやり直してください）`))return;
    p.harvestDate=D;
    save();render();
    mapToast(`「${mapCrop(p)}」の収穫日（${mapMD(D)}）を記録しました。間違えたら「元に戻す」で戻せます`);
    if(mapQPlot!=null&&(db.plots||[]).some(x=>x.id==mapQPlot))mapQuickOpen(mapQPlot); // 画面の中身を新しい状態に
  }catch(e){alert("収穫を記録できませんでした："+(e.message||e));}
}
function mapQuickEdit(pid){mapQuickClose();edit("plantings",pid);}
// 詳しく入力：ここまでに入れた内容を、今までの入力画面に引き継ぐ
function mapQuickFull(){
  try{
    const pl=(db.plots||[]).find(x=>x.id==mapQPlot);
    if(!pl)throw new Error("区画が見つかりません");
    const o=mapQuickRead(false),pd=validDate(o.plantDate)?o.plantDate:mapDate;
    mapQuickClose();
    edit("plantings",null,null,{fieldId:pl.fieldId,plotId:pl.id,year:+pd.slice(0,4),variety:o.variety,plantDate:pd,harvestPlan:validDate(o.harvestPlan)?o.harvestPlan:"",mulch:o.mulch,straw:o.straw});
  }catch(e){alert("入力画面を開けませんでした："+(e.message||e));}
}
/* ----- 画面の外側（暗い部分）を押したら閉じる。作物名を入れかけているときは、確かめてから閉じる ----- */
(function(){
  try{
    const dlg=$("qs");if(!dlg)return;
    let downOutside=false; // 押し始めが外側だったか（区画を押した指を離したときの動きで、開いた直後に閉じてしまわないように）
    const outside=e=>{const r=dlg.getBoundingClientRect();return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom;};
    const dirty=()=>{const v=$("qsFrm").elements["variety"];return !!(v&&v.value.trim());};
    const askClose=()=>{try{if(!dirty()||confirm("入力中の内容を破棄して閉じますか？"))dlg.close("cancel");}catch(e){console.error(e);}};
    dlg.addEventListener("pointerdown",e=>{downOutside=(e.target===dlg)&&outside(e);});
    dlg.addEventListener("click",e=>{if(downOutside&&e.target===dlg&&outside(e))askClose();downOutside=false;});
    dlg.addEventListener("cancel",e=>{if(dirty()){e.preventDefault();askClose();}}); // Escキー
    dlg.addEventListener("close",()=>{mapQPlot=null;});
  }catch(e){console.error(e);}
})();
