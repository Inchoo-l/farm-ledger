"use strict";
// CSV出力・JSONバックアップ・復元
/* ========== CSV / バックアップ ========== */
function dl(name,text,type){
  const a=document.createElement("a");
  const url=URL.createObjectURL(new Blob([text],{type}));
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000); // すぐ消すと、ブラウザによっては保存が始まる前に無効になる
}
function csv(name){
  const E=ENT[name];
  const rows=db[name].filter(r=>inYear(r.date)&&inMode(r));
  const q=v=>`"${String(v??"").replace(/"/g,'""')}"`;
  const lines=[E.cols.map(c=>q(c.l)).join(",")];
  rows.forEach(r=>lines.push(E.cols.map(c=>{
    let v=r[c.k];
    if(c.t=="planting"){const p=db.plantings.find(x=>x.id==v);v=p?plantLabel(p):"";}
    if(c.t=="account"){const ac=db.accounts.find(x=>x.id==v);v=ac?ac.name:"";}
    if(c.t=="check")v=v?"有":"";
    return q(v);}).join(",")));
  dl(`${name}_${year}.csv`,"﻿"+lines.join("\r\n"),"text/csv");
}
// バックアップのファイル名に使う日付。西暦の下2桁＋月＋日（0なし）。例：2026年1月1日 → 26_1_1
function backupStamp(){const d=new Date();return `${String(d.getFullYear()).slice(-2)}_${d.getMonth()+1}_${d.getDate()}`;}
function backup(){
  const snapshot=JSON.parse(JSON.stringify(db));
  snapshot.lastBackup=new Date().toISOString();snapshot.backupDirty=false;
  dl(`agri-backup-${backupStamp()}.json`,JSON.stringify(snapshot,null,1),"application/json");
  recordBackup(snapshot);render();
}
function restore(inp){
  const f=inp.files[0];if(!f)return;
  const r=new FileReader();
  r.onerror=()=>alert("このファイルは読み込めません");
  r.onload=async()=>{
    inp.value=""; // 同じファイルをもう一度選べるように
    try{
      let o=JSON.parse(r.result);
      if(isEnv(o)){ // 暗号化バックアップ：パスワードで開く
        if(cryptoNeed())return;
        o=(await decryptWithPrompt(o,"暗号化バックアップを開く")).obj;
      }
      if(o&&o.format==="agri-ledger-incr"){alert("これは増分バックアップです。増分だけでは復元できません。\n「☁ 自動バックアップから復元（フル＋増分）」で、フォルダのファイルをすべて選んでください。");return;}
      if(!validData(o))throw new Error("帳簿データの形式が不正です");
      delete o._backup; // 自動バックアップのフルに付く管理用の項目は、データには入れない
      if(!confirm("現在のデータをすべて置き換えます。よろしいですか？"))return;
      const oldRev=db.rev||0;
      db=fixDb(o);
      db.rev=Math.max(oldRev,o.rev||0); // 共有ファイルより古い版数にならないようにする
      save(true);render();alert("復元しました");
    }catch(e){if(!e.cancel)alert("このファイルは読み込めません");}
  };r.readAsText(f);
}
/* ===== 自動バックアップ（フル＋増分）から復元 =====
   Googleドライブの「バックアップ」フォルダのファイル（フル1個＋増分いくつか）を、すべて選んでもらい、
   フル → 増分を日付の順に当てはめて、元の状態に戻す。暗号化されていれば、パスワードを聞く。
   増分が抜けていれば、どこが足りないかを伝えて、何も変えずに止める。 */
async function restoreChainFiles(inp){
  try{
    const files=[...(inp.files||[])];
    if(!files.length)return;
    const texts=await Promise.all(files.map(f=>f.text()));
    inp.value=""; // 同じファイルをもう一度選べるように
    const objs=[],keys={}; // keys: salt → 復号の鍵（同じパスワードなら、1回の入力ですべて開く）
    for(let i=0;i<texts.length;i++){
      let o;
      try{o=JSON.parse(texts[i]);}catch(e){throw new Error(`「${files[i].name}」は読めないファイルです（バックアップのファイルではありません）`);}
      if(isEnv(o)){
        if(cryptoNeed())return;
        if(keys[o.salt])o=await decryptEnv(o,keys[o.salt]);
        else{const r=await decryptWithPrompt(o,"バックアップを開く（"+files[i].name+"）");keys[o.salt]=r.c;o=r.obj;}
      }
      objs.push(o);
    }
    const {full,incrs}=BackupChain.buildChain(objs);
    const res=BackupChain.restoreChain(full,incrs);
    if(!validData(res.state))throw new Error("復元する帳簿データの形式が不正です");
    const msg=`フルバックアップ（${full._backup.date}）＋増分${res.count}件 を当てはめて、${res.last.date} の状態に戻します。\n\n現在のデータはすべて置き換えます（元に戻す操作で、復元前に戻せます）。よろしいですか？`;
    if(!confirm(msg))return;
    const oldRev=db.rev||0;
    db=fixDb(res.state);
    db.rev=Math.max(oldRev,res.state.rev||0); // 共有ファイルより古い版数にならないようにする
    save(true);render();
    alert(`復元しました（${res.last.date} の状態）`);
  }catch(e){if(!e||!e.cancel)alert("復元できませんでした：\n"+((e&&e.message)||e));}
}
function dataView(){
  return syncCard()+`<div class="card"><h2>☁ 自動バックアップから復元（フル＋増分）</h2>
   <p class="hint">自動バックアップは、毎日深夜1時（日本時間）に、Googleドライブの「バックアップ」フォルダへ保存されます（日曜はフル、ほかの日は増分。フォルダには、いつも「フル1個＋次のフルまでの増分」だけが入っています）。</p>
   <p class="hint">復元するときは、そのフォルダのファイルを<b>すべて</b>ダウンロードして、下のボタンで<b>まとめて選んで</b>ください。パスワードで暗号化されているときは、共有ファイルと同じパスワードを聞きます。</p>
   <div class="bar"><label class="g" style="display:inline-block;margin:0;padding:5px 10px;border:1px solid var(--main);border-radius:6px;cursor:pointer;color:var(--main)">☁ 自動バックアップから復元（ファイルを複数選ぶ）
     <input type="file" accept=".json" multiple style="display:none" onchange="restoreChainFiles(this)"></label></div></div>
   <div class="card"><h2>バックアップと復元</h2>
   <p>データはこのブラウザの中に保存されています。<b>ブラウザの履歴削除やパソコンの故障で消える可能性があるため、定期的にバックアップを保存してください</b>（OneDriveやUSBメモリなど別の場所へ）。</p>
    <p>最終バックアップ出力：${esc(backupTime())}${db.backupDirty?"（以降に変更あり）":""}</p>
    <p class="hint">出力日時はダウンロードを開始した時刻です。ファイルが保存されたことも確認してください。</p>
   <div class="bar"><button class="b" onclick="backup()">バックアップを保存（JSON）</button>
   <button class="g" onclick="backupEnc()">🔒 暗号化してバックアップ</button>
   <label class="g" style="display:inline-block;margin:0;padding:5px 10px;border:1px solid var(--main);border-radius:6px;cursor:pointer;color:var(--main)">復元する
     <input type="file" accept=".json" style="display:none" onchange="restore(this)"></label></div></div>
   <div class="card"><h2>青色申告での保存について</h2>
   <p class="hint">帳簿と領収書・請求書などの証憑は原則7年間（一部5年）の保存が必要です。領収書は日付順に保管し、経費の「メモ」に保管場所を書いておくと探しやすくなります。電子取引（メール・ネットで受け取った請求書等）は電子データのまま保存する必要があります。<br>
   このアプリは記帳の補助用です。申告内容は税務署・税理士・会計ソフトで確認してください。</p></div>`;
}
