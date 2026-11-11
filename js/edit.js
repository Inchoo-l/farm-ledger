"use strict";
// 入力画面（追加・編集・削除・口座の一括割り当て）
// 売上：家事消費・事業消費はお金が動かないので、口座欄を使えなくする（それ以外は口座が必須）
function syncAcct(){
  try{
    const f=$("frm").elements, a=f["accountId"], k=f["kind"];
    if(!a)return;
    const off=!!k&&NOCASH.includes(k.value);
    if(off)a.value="";
    a.disabled=off;a.required=!off;
    const h=document.getElementById("ac_hint");
    if(h)h.textContent=off?"家事消費・事業消費は現金の動きがないため、口座は使いません。":(h.dataset.d||"");
  }catch(e){}
}

function edit(name,id,from,pre){ // pre＝新規入力のとき、あらかじめ入れておく値（区画マップから「作付を追加」するときなど）
  try{
    const E=ENT[name];
    const cols=E.cols.filter(c=>!c.calc&&!(mode=="hat"&&name=="fields"&&c.k=="rent")&&!(mode!="hat"&&(c.k=="plotId"||c.hat)));// 計算列（現在の残高）は入力欄にしない／畑は小作料を出さない
    // 経費・売上は口座が必須。口座が1つも無ければ先に登録してもらう
    if((name=="expenses"||name=="sales")&&!db.accounts.length){
      alert("経費・売上は、口座から引き落とし／口座へ加算します。\n先に「🏦 貯金・口座」で口座を登録してください。");
      tab="accounts";render();return;
    }
    // from＝複製元。内容をそのままコピーし、日付だけ今日にして新規入力にする
    const src=from?db[name].find(x=>x.id==from):null;
    const r=id?db[name].find(x=>x.id==id):(src?Object.assign({},src,{date:today()}):Object.assign({},pre||{}));
    if((id&&!r)||(from&&!src))throw new Error("対象のデータが見つかりません");
    const opts=(c)=>{
      if(c.t=="select")return c.o.map(o=>`<option value="${esc(o)}" ${r[c.k]==o?"selected":""}>${esc(["category","kind"].includes(c.k)?optLabel(o):o)}</option>`).join("");
      if(c.t=="field")return `<option value=""></option>`+db.fields.filter(inMode).map(f=>`<option value="${f.id}" ${r[c.k]==f.id?"selected":""}>${esc(f.name)}</option>`).join("");
      if(c.t=="plot")return `<option value=""></option>`+(db.plots||[]).map(p=>`<option value="${p.id}" data-f="${p.fieldId}" ${r[c.k]==p.id?"selected":""}>${esc(p.name)}</option>`).join("");
      if(c.t=="planting")return `<option value="">共通（特定の作付に紐づけない）</option>`+db.plantings.filter(p=>inMode(p)&&(!p.year||Math.abs(p.year-year)<=1)).map(p=>`<option value="${p.id}" ${r[c.k]==p.id?"selected":""}>${esc(plantLabel(p))}</option>`).join("");
      if(c.t=="account")return `<option value="">口座を選んでください</option>`+acctOpts(r[c.k]);
    };
    const body=cols.map(c=>{
      const val=r[c.k]??(c.def?c.def():"");
      let inp;
      const hasInfo=c.t=="select"&&["category","kind"].includes(c.k);
      if(["select","field","planting","account","plot"].includes(c.t))inp=`<select name="${c.k}" ${c.t=="account"&&c.req?"required":""} ${hasInfo?`onchange="selInfo('${c.k}',this.value);${name=="expenses"&&c.k=="category"?"applyCat(this.value)":""}"`:""}>${opts(c)}</select>`
        +(hasInfo?`<div class="hint" id="si_${c.k}" style="margin-top:4px"></div>`:"")
        +(c.t=="account"?`<div class="hint" id="ac_hint" data-d="${name=="expenses"?"この口座から金額が引き落とされます。":"この口座に金額が加算されます。"}" style="margin-top:4px"></div>`:"");
      else if(c.t=="area"){
        const t=val===""?{cho:"",tan:"",se:""}:toTanba(+val);
        // 数字の欄と単位を1組にして並べる（スマホの幅で、単位だけが次の行に落ちないように）
        const u=(id,v,unit,step,extra)=>`<span class="au"><input id="${id}" type="number" inputmode="decimal" step="${step}" min="0" value="${esc(v)}" ${extra||""}>${unit}</span>`;
        inp=`<div class="area">${u("ar_a",val,"a","0.01",`name="${c.k}" required oninput="areaSync('a')"`)}<span class="eq">＝</span>
          ${u("ar_cho",t.cho,"町","1",`oninput="areaSync('x')"`)}${u("ar_tan",t.tan,"反","1",`oninput="areaSync('x')"`)}${u("ar_se",t.se,"畝","0.01",`oninput="areaSync('x')"`)}</div>`;
      }
      else if(c.t=="date")inp=`<input name="${c.k}" type="text" inputmode="none" autocomplete="off" placeholder="日付を押すとカレンダーが開きます" pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}" maxlength="10" ${c.req===1?"required":""} value="${esc(val)}"><div class="cal" id="cal_${c.k}" hidden></div>`;
      else if(c.t=="check")inp=`<input type="checkbox" name="${c.k}" ${(name=="plantings"&&(c.k=="mulch"||c.k=="straw")?coverOf(r)[c.k]:r[c.k])?"checked":""}>`; // 作付の被覆資材は、古いデータなら区画のチェックを引き継いで表示
      else inp=`<input name="${c.k}" type="${c.t||"text"}" ${c.t=="number"?'inputmode="decimal"':""} ${c.step?`step="${c.step}"`:""} ${c.min!=null?`min="${c.min}"`:""} ${c.max!=null?`max="${c.max}"`:""} ${c.req===1?"required":""} value="${esc(val)}">`;
      // 必須の項目には赤い※を付ける（req:2 は「※は付けるが入力欄の必須チェックは別の方法で行う」項目）
      return `<div class="fld" data-k="${c.k}"><label>${mode=="hat"&&c.k=="yield"?"収量(kg)":c.l}<span class="rq" ${c.req?"":"hidden"}>※</span>${c.g?q(c.g):""}</label>${inp}</div>`;
    }).join("");
    const legend=`<p class="hint"><span class="rq" style="margin:0">※</span> は必ず入力する項目です${name=="expenses"?"。勘定科目を選ぶと、その科目に必要な項目だけが表示されます。":""}</p>`;
    // 経費・売上は、田んぼと畑のどちらの記録かを入力画面の見出しに出す（新規は今のモード、編集は記録に付いている区別）
    let badge="";
    if(name=="expenses"||name=="sales"){
      const dv=id?divOf(r):DIV();
      badge=` <span class="mbadge ${dv=="畑"?"hat":"rice"}">${dv=="畑"?"🥬 畑":"🌾 田んぼ"}</span>`;
    }
    $("frm").innerHTML=dlgFrame(`${E.title}を${id?"編集":(src?"複製して追加":"追加")}${badge}`,legend+body);
    cols.filter(c=>c.t=="date").forEach(c=>calInit($("frm").elements[c.k],$("cal_"+c.k)));
    if(name=="plantings"){ // 畑を選んだら、その畑の区画だけを選べるようにする
      const fsel=$("frm").elements["fieldId"],psel=$("frm").elements["plotId"];
      if(fsel&&psel){
        const filt=()=>{[...psel.options].forEach(o=>{if(o.dataset.f){o.hidden=o.disabled=o.dataset.f!=fsel.value;}});
          if(psel.selectedOptions[0]&&psel.selectedOptions[0].disabled)psel.value="";};
        fsel.addEventListener("change",filt);filt();
      }
    }
    const kd=$("frm").elements["kind"];
    if(kd&&$("frm").elements["accountId"])kd.addEventListener("change",syncAcct);
    syncAcct();
    const dlg=$("dlg");dlg.showModal();
    // 最初の入力欄にカーソルを置く（日付欄が先頭ならカレンダーが自動で開く）
    const f1=$("frm").elements[cols[0].k];if(f1&&f1.focus)f1.focus();
    cols.forEach(c=>{const el=$("frm").elements[c.k];if(el&&document.getElementById("si_"+c.k))selInfo(c.k,el.value);});
  if(name=="expenses")applyCat($("frm").elements["category"].value);
    $("frm").onsubmit=ev=>{
      if(ev.submitter&&ev.submitter.value=="cancel")return;
      try{
        const fd=new FormData($("frm"));
        // 日付の形式チェック（存在しない日付を防ぐ）
        for(const c of cols.filter(c=>c.t=="date")){
          const s=fd.get(c.k);
          if(s&&!validDate(s)){ev.preventDefault();alert(`「${c.l}」は 2026-11-07 の形式で、実在する日付を入力してください`);return;}
        }
        // 検証が通るまで元のデータは書き換えず、コピー（o）に入力値を入れる
        const o=id?Object.assign({},r):{};
        cols.forEach(c=>{
          if(c.t=="check")o[c.k]=fd.get(c.k)=="on";
          else if(c.t=="number"||c.t=="area"){const s=fd.get(c.k);o[c.k]=s===""||s==null?"":Number(s);}
          else if(c.t=="field"||c.t=="planting"||c.t=="account"||c.t=="plot"){const s=fd.get(c.k);o[c.k]=s?Number(s):"";}
          else o[c.k]=fd.get(c.k)??"";
        });
        if(name=="expenses"&&(o.amount===""||o.amount==null)&&o.qty&&o.unitPrice)o.amount=Math.round(o.qty*o.unitPrice);
        if(name=="expenses"&&!o.amount&&o.amount!==0){ev.preventDefault();alert("金額、または数量と単価を入力してください");return;}
        // 口座が必要な記録なのに口座が無い場合は保存しない
        if((name=="expenses"||(name=="sales"&&!NOCASH.includes(o.kind)))&&!o.accountId){ev.preventDefault();alert("口座を選んでください");return;}
        if(id)Object.assign(r,o);
        else{o.id=uid();o.div=DIV();db[name].push(o);}
        save();render();
      }catch(err){ev.preventDefault();alert("保存に失敗しました："+err.message);}
    };
  }catch(err){alert("入力画面を開けませんでした："+err.message);}
}

/* ===== 口座が未設定の既存記録を、1つの口座にまとめて割り当てる ===== */
function assignAcct(){
  try{
    if(!db.accounts.length){alert("先に口座を登録してください");tab="accounts";render();return;}
    const u=unassigned(), n=u.exp.length+u.sal.length;
    $("frm").innerHTML=dlgFrame("口座の一括割り当て",
      `<p class="hint">口座が未設定の経費・売上 ${n}件（経費${u.exp.length}件・売上${u.sal.length}件）を、すべて下の口座に割り当てます。経費は口座から引き落とされ、売上は口座に加算されます。</p>
       <label>割り当てる口座<span class="rq">※</span></label><select name="acct" required><option value="">口座を選んでください</option>${acctOpts("")}</select>`,"割り当てる");
    $("dlg").showModal();
    $("frm").elements["acct"].focus();
    $("frm").onsubmit=ev=>{
      if(ev.submitter&&ev.submitter.value=="cancel")return;
      try{
        const aid=Number(new FormData($("frm")).get("acct"));
        if(!aid){ev.preventDefault();alert("口座を選んでください");return;}
        const now=unassigned(); // 開いている間に変わっていてもよいよう、押した時点で取り直す
        now.exp.forEach(r=>r.accountId=aid);
        now.sal.forEach(r=>r.accountId=aid);
        save();render();
      }catch(err){ev.preventDefault();alert("割り当てに失敗しました："+err.message);}
    };
  }catch(err){alert("入力画面を開けませんでした："+err.message);}
}

function del(name,id){
  try{
    // 経費・売上が紐づいている口座は消せない（残高の計算が狂うため）
    if(name=="accounts"){
      const n=db.expenses.filter(e=>e.accountId==id).length+db.sales.filter(s=>s.accountId==id).length;
      if(n){alert(`この口座には経費・売上が${n}件紐づいているため削除できません。\n先にそれらの口座を別の口座に変更するか、記録を削除してください。`);return;}
    }
    let msg="削除しますか？";
    if(name=="fields"){
      const np=db.plantings.filter(p=>p.fieldId==id).length, hasPlots=(db.plots||[]).some(p=>p.fieldId==id);
      if(hasPlots)msg+="\nこの畑の区画（地図の配置）も一緒に消えます。";
      if(np)msg+=`\nこの圃場の作付が${np}件あります。作付は消えませんが、圃場が「不明」になります（面積で分ける原価計算から外れます）。`;
    }else if(name=="plots")msg="この区画を削除しますか？\nこの区画の作付は消えず、区画だけ未設定になります。";
    else if(name=="plantings"){
      const n=db.expenses.filter(e=>e.plantingId==id).length+db.sales.filter(s=>s.plantingId==id).length;
      if(n)msg+=`\nこの作付に紐づけた経費・売上が${n}件あります。記録は消えず、「共通（作付に紐づけなし）」に変わります。`;
    }
    if(!confirm(msg))return;
    if(name=="fields"){
      const ids=new Set((db.plots||[]).filter(p=>p.fieldId==id).map(p=>p.id));
      db.plots=(db.plots||[]).filter(p=>p.fieldId!=id);
      db.plantings.forEach(p=>{if(ids.has(p.plotId))p.plotId="";}); // 消えた区画を指したままにしない
    }
    if(name=="plots")db.plantings.forEach(p=>{if(p.plotId==id)p.plotId="";});
    // 作付を消したら、その作付を指していた経費・売上は「共通」に戻す（消えた作付を指したままだと、原価計算から漏れる）
    if(name=="plantings")[db.expenses,db.sales].forEach(l=>l.forEach(r=>{if(r.plantingId==id)r.plantingId="";}));
    db[name]=db[name].filter(x=>x.id!=id);save();render();
  }catch(e){alert("削除に失敗しました："+e.message);}
}

/* ===== 入力画面の外側（暗い部分）やEscを押したとき、確認してから閉じる ===== */
(function(){
  const dlg=$("dlg");
  let downOutside=false; // 押し始めが外側だったか（中で文字を選択してそのまま外で離した場合を除くため）
  const outside=e=>{const r=dlg.getBoundingClientRect();return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom;};
  const askClose=()=>{try{if(confirm("入力中の内容を破棄して閉じますか？"))dlg.close("cancel");}catch(e){}};
  dlg.addEventListener("mousedown",e=>{downOutside=(e.target===dlg)&&outside(e);});
  dlg.addEventListener("click",e=>{
    if(downOutside&&e.target===dlg&&outside(e))askClose();
    downOutside=false;
  });
  dlg.addEventListener("cancel",e=>{e.preventDefault();askClose();}); // Escキーも同じ確認にそろえる
})();
