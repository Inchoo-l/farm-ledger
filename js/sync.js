"use strict";
// 共有ファイル連携（クラウド同期フォルダのファイルを自動で読み書き）
/* ========== 共有ファイル連携 ==========
   OneDrive / Google Drive などで同期しているフォルダの JSON ファイルを、アプリが直接読み書きする。
   ・入力するたびに自動でファイルへ保存
   ・数秒おきにファイルを確認し、他のパソコンが更新していたら自動で読み込む
   ・版数だけでなく内容も比較し、競合中は採用する内容を選ぶまで自動同期を止める */

const sync={fh:null,pend:null,name:"",lastMod:0,baseRev:0,baseText:null,conflict:null,timer:null,poll:null,state:"off",at:null,msg:"",busy:false,crypto:null,previousCrypto:null};
const FSA=typeof window.showOpenFilePicker=="function";
const FTYPES=[{description:"帳簿データ(JSON)",accept:{"application/json":[".json"]}}];

// ファイルの「手がかり」(handle)を IndexedDB に保存し、次回起動時に再接続できるようにする
function idb(){return new Promise((res,rej)=>{const r=indexedDB.open("agri-sync",1);r.onupgradeneeded=()=>r.result.createObjectStore("kv");r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
async function idbGet(k){const d=await idb();return new Promise((res,rej)=>{const r=d.transaction("kv").objectStore("kv").get(k);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
async function idbSet(k,v){const d=await idb();return new Promise((res,rej)=>{const t=d.transaction("kv","readwrite");if(v===undefined)t.objectStore("kv").delete(k);else t.objectStore("kv").put(v,k);t.oncomplete=()=>res();t.onerror=()=>rej(t.error);});}

function syncText(){
  if(sync.state=="conflict")return "⚠ 同期を保留中：内容を選ぶ";
  if(sync.state=="saving")return "🔄 共有ファイルに保存中…";
  if(sync.state=="queued")return "🔄 共有ファイルへの保存待ち";
  if(sync.state=="ok")return `${sync.fh&&sync.fh.drive?"☁":"🔗"}${sync.crypto?"🔒":""} 同期済み：${sync.name}（${sync.at?sync.at.toLocaleTimeString("ja-JP"):""}）`;
  if(sync.state=="pending")return "⚠ 共有ファイルに再接続";
  if(sync.state=="err")return "⚠ 同期エラー";
  return "🔗 共有ファイル：未接続";
}
function setSync(state,msg){sync.state=state;sync.msg=msg||"";if(state=="ok")sync.at=new Date();updateSyncUI();}
function backupTime(){
  if(!db.lastBackup)return "未実施";
  const d=new Date(db.lastBackup);
  return Number.isNaN(d.getTime())?String(db.lastBackup):d.toLocaleString("ja-JP");
}
function updateSyncUI(){
  const b=$("syncBtn");
  if(b){b.textContent=syncText();b.title=sync.msg||"";}
  $("lastBk").textContent=(localSave.error?"この端末：保存失敗":`この端末：${localSave.at?"保存済み "+localSave.at.toLocaleTimeString("ja-JP"):"ブラウザ内に自動保存"}`)
    +"\nバックアップ出力："+backupTime()+(db.backupDirty?"（以降に変更あり）":"");
  const error=$("saveError");
  if(error){
    error.textContent=localSave.error||(["err","conflict","pending"].includes(sync.state)?sync.msg:"");
    error.hidden=!error.textContent;
  }
  const s=document.getElementById("syncState");
  if(s)s.textContent=syncText()+(sync.msg?"　"+sync.msg:"");
}

async function readRemote(ask){
  const f=await sync.fh.getFile();
  const text=await f.text();
  let obj=null,enc=false;
  if(text.trim()){
    let p;
    try{p=JSON.parse(text);}catch(e){throw new Error("共有ファイルの内容が読めません（同期中かもしれません）");}
    if(!p||typeof p!=="object"||Array.isArray(p))throw new Error("共有ファイルの形式が不正です");
    if(isEnv(p)){
      enc=true;
      const key=[sync.crypto,sync.previousCrypto].find(c=>c&&c.salt===p.salt);
      if(key)obj=await decryptEnv(p,key); // パスワード変更中は旧鍵でも内容を比較する
      else if(ask){const r=await decryptWithPrompt(p);obj=r.obj;sync.crypto=r.c;}
      else throw Object.assign(new Error("パスワードが必要です"),{locked:true});
    }else obj=p;
  }
  return{f,obj,enc};
}
const validData=o=>!!o&&Array.isArray(o.expenses)&&Array.isArray(o.fields)
  &&["fields","expenses","sales","plantings","assets","accounts","plots"].every(k=>o[k]===undefined||(Array.isArray(o[k])&&o[k].every(r=>r&&typeof r=="object"&&!Array.isArray(r))))
  &&["settings","yearly","cropColors"].every(k=>o[k]===undefined||(o[k]&&typeof o[k]=="object"&&!Array.isArray(o[k])));
function applyRemote(obj,f){
  const lastBackup=db.lastBackup;
  db=fixDb(obj);
  db.lastBackup=lastBackup;db.backupDirty=true;db.dirty=false;
  sync.baseRev=db.rev||0;sync.lastMod=f.lastModified;sync.baseText=ledgerSignature(obj);sync.conflict=null;
  persistLocal();
  resetHist(); // 他のパソコンの内容に入れ替わったので、これ以前には戻せない
  setSync("ok");render();
}
function keepConflictCopies(remote){
  // 両方を1回の書き込みで退避。容量不足なら採用・上書きを中止する。
  localStorage.setItem(KEY+"-conflict-pair",JSON.stringify({at:new Date().toISOString(),local:db,remote}));
}
function downloadConflictCopy(which){
  try{
    const pair=JSON.parse(localStorage.getItem(KEY+"-conflict-pair"));
    if(!pair||!pair[which])throw new Error("退避データはありません");
    dl(`agri-conflict-${which}.json`,JSON.stringify(pair[which],null,1),"application/json");
  }catch(e){alert("退避データを保存できません："+e.message);}
}
function setConflict(obj,f){
  clearTimeout(sync.timer);sync.timer=null;
  sync.conflict={obj,f,text:ledgerSignature(obj)};
  setSync("conflict","端末と共有ファイルの内容が異なります。自動同期を止めています。上の「内容を選ぶ」から確認してください。");
}
function showSyncConflict(){
  if(!sync.conflict||sync.busy)return;
  let d=$("syncConflictDlg");
  if(!d){d=document.createElement("dialog");d.id="syncConflictDlg";document.body.appendChild(d);}
  const count=o=>`経費 ${(o.expenses||[]).length}件（${yen((o.expenses||[]).reduce((s,r)=>s+expAmt(r),0))}円）・売上 ${(o.sales||[]).length}件（${yen((o.sales||[]).reduce((s,r)=>s+(+r.amount||0),0))}円）・口座 ${(o.accounts||[]).length}件`;
  d.innerHTML=`<form method="dialog"><h2>同期する内容を選んでください</h2>
    <p>この端末：${count(db)}<br>共有ファイル：${count(sync.conflict.obj)}</p><p class="hint">件数と金額は全年度の合計です。</p>
    <p class="hint">選んだ側の内容で全体を置き換えます。採用前に両方をこの端末に退避します（バックアップ画面から保存できます）。迷ったら保留してください。</p>
    <div class="bar"><button class="g" value="hold" autofocus>保留する</button>
    <button class="b" value="remote">共有ファイルを採用</button><button class="b" value="local">この端末を採用</button></div></form>`;
  d.returnValue="hold";
  d.onclose=()=>{if(["local","remote"].includes(d.returnValue))resolveSyncConflict(d.returnValue);};
  d.showModal();
}
async function resolveSyncConflict(choice){
  if(!["local","remote"].includes(choice)||!sync.conflict||sync.busy)return;
  const expected=sync.conflict.text,local=ledgerSignature(db);
  sync.busy=true;
  try{
    const {obj,f}=await readRemote(false);
    if(!validData(obj))throw new Error("共有ファイルの内容が読めません。上書きせずに停止しました。");
    if(ledgerSignature(obj)!==expected||ledgerSignature(db)!==local){
      setConflict(obj,f);alert("確認中にデータが変わりました。もう一度、内容を選んでください。");return;
    }
    keepConflictCopies(obj);
    if(choice=="remote"){applyRemote(obj,f);return;}
    sync.baseText=ledgerSignature(obj);sync.baseRev=obj.rev||0;sync.lastMod=f.lastModified;sync.conflict=null;
    db.rev=Math.max(db.rev||0,obj.rev||0)+1;db.dirty=true;persistLocal();
    setSync("queued");
  }catch(e){
    // 退避に失敗した場合も、同期を再開せず選択前の状態を保つ。
    setSync("conflict","採用できませんでした："+(e.message||e));return;
  }finally{sync.busy=false;}
  await writeFile();
}

// 入力のたびに少し待ってからまとめて書き込む
function queueWrite(){
  if(!sync.fh||["pending","conflict"].includes(sync.state))return;
  clearTimeout(sync.timer);
  setSync("queued");
  sync.timer=setTimeout(()=>{sync.timer=null;writeFile();},500);
}
async function writeFile(){
  if(!sync.fh||["pending","conflict"].includes(sync.state))return;
  if(sync.busy){queueWrite();return;}
  sync.busy=true;
  setSync("saving");
  try{
    const {f,obj}=await readRemote(false);
    if(obj&&!validData(obj))throw new Error("共有ファイルの形式が不正です。上書きせずに停止しました。");
    if(!obj&&sync.baseText!==null)throw new Error("共有ファイルが空になっています。上書きせずに停止しました。");
    if(validData(obj)&&ledgerSignature(obj)!==sync.baseText&&ledgerSignature(obj)!==ledgerSignature(db)){
      setConflict(obj,f);return;
    }
    if(validData(obj))db.rev=Math.max(db.rev||0,(obj.rev||0)+(ledgerSignature(obj)!==ledgerSignature(db)?1:0));
    // 書き込み待ちの間にも入力できるため、送る内容と版数を固定する。
    const snapshot=JSON.parse(JSON.stringify(db)),written=ledgerSignature(snapshot);
    const w=await sync.fh.createWritable();
    // パスワードを設定している間は、暗号化して書き込む
    await w.write(sync.crypto?await encryptText(JSON.stringify(snapshot),sync.crypto):JSON.stringify(snapshot));
    await w.close();
    sync.baseText=written;sync.baseRev=snapshot.rev||0;
    const after=await readRemote(false);
    if(!validData(after.obj))throw new Error("共有ファイルへの保存結果を確認できませんでした。");
    if(ledgerSignature(after.obj)!==written){setConflict(after.obj,after.f);return;}
    sync.previousCrypto=null;
    sync.lastMod=after.f.lastModified;
    db.dirty=ledgerSignature(db)!==written;persistLocal();
    if(db.dirty)queueWrite();else setSync("ok");
  }catch(e){
    if(e.auth){sync.pend=sync.fh;setSync("pending",e.message);return;} // Google のログイン切れ：再接続を待つ（入力内容はこのブラウザに残っている）
    setSync("err",e.locked?"共有ファイルのパスワードが変わっています。接続を解除して、新しいパスワードで開き直してください。":(e.message||String(e)));
  }
  finally{sync.busy=false;}
}
// 数秒おきにファイルを確認し、他のパソコンの更新を取り込む
async function pollTick(){
  if(!sync.fh||sync.busy||sync.timer||["pending","conflict","err"].includes(sync.state))return;
  if(document.querySelector("dialog[open]"))return; // 入力中は割り込まない
  sync.busy=true;
  try{
    const {f,obj}=await readRemote(false);
    if(!validData(obj))throw new Error("共有ファイルの内容を確認できません。再接続してください。");
    if(document.querySelector("dialog[open]"))return;
    const remote=ledgerSignature(obj),local=ledgerSignature(db);
    if(remote===local){
      sync.baseText=remote;sync.baseRev=obj.rev||0;sync.lastMod=f.lastModified;
      db.rev=Math.max(db.rev||0,obj.rev||0);db.dirty=false;persistLocal();setSync("ok");
    }else if(remote!==sync.baseText){
      if(local===sync.baseText){keepConflictCopies(obj);applyRemote(obj,f);}
      else setConflict(obj,f);
    }
  }catch(e){
    if(e&&e.auth&&sync.fh){sync.pend=sync.fh;setSync("pending",e.message);}
    else setSync("err",e.message||String(e));
  }finally{sync.busy=false;}
}
function startPolling(){clearInterval(sync.poll);sync.poll=setInterval(pollTick,sync.fh&&sync.fh.drive?5000:3000);}
window.addEventListener("focus",()=>pollTick());
document.addEventListener("visibilitychange",()=>{if(!document.hidden)pollTick();});

// 接続する。how: "create"=新しく作る / "open"=既存ファイルを開く / "reconnect"=前回のファイルに再接続
// silent=true: パスワード入力画面を出さない（起動時の自動再接続用）／ newC: 新規作成時に使う暗号化の鍵（暗号化しないなら null）
async function startSync(fh,how,silent,newC){
  if(sync.busy)return;
  sync.busy=true;
  let writeOurs=false;
  const prev={fh:sync.fh,name:sync.name,lastMod:sync.lastMod,baseRev:sync.baseRev,baseText:sync.baseText,crypto:sync.crypto,previousCrypto:sync.previousCrypto,conflict:sync.conflict,state:sync.state};
  try{
    const perm=await fh.requestPermission({mode:"readwrite"});
    if(perm!=="granted")throw new Error("ファイルの読み書きが許可されませんでした");
    clearTimeout(sync.timer);sync.timer=null;
    sync.fh=fh;sync.name=fh.name;sync.lastMod=0;sync.baseRev=0;sync.baseText=null;sync.conflict=null;
    setSync("saving");
    if(how=="create"){sync.crypto=newC||null;sync.previousCrypto=null;}
    // 新規作成は既存の中身を使わない（上書き）ので、読み込まない
    const {f,obj,enc}=how=="create"?{f:await fh.getFile(),obj:null,enc:false}:await readRemote(!silent);
    if(how!="create"&&!enc)sync.crypto=null; // 暗号化されていないファイルに接続した
    if(obj&&!validData(obj))throw new Error("このファイルは帳簿データではありません");
    const hasLocal=ledgerSignature(db)!==ledgerSignature(empty());
    if(!obj){sync.lastMod=f.lastModified;writeOurs=true;}
    else if(ledgerSignature(obj)===ledgerSignature(db)){
      sync.baseText=ledgerSignature(obj);sync.baseRev=obj.rev||0;sync.lastMod=f.lastModified;
      db.rev=Math.max(db.rev||0,obj.rev||0);db.dirty=false;persistLocal();setSync("ok");
    }else if(!hasLocal){applyRemote(obj,f);}
    else setConflict(obj,f); // 再接続も、版数だけで一方を自動採用しない
    try{await idbSet("fh",fh.persist?fh.persist():fh);}catch(_){}
    sync.pend=null;
    startPolling();
  }catch(e){
    Object.assign(sync,prev);
    throw e;
  }finally{sync.busy=false;}
  if(writeOurs){await writeFile();}
}
const syncErr=e=>{if(e&&e.name=="AbortError")return;alert("共有ファイルに接続できませんでした：\n"+(e.message||e));updateSyncUI();};
function syncNeed(){
  if(FSA)return false;
  alert("このブラウザでは共有ファイル機能を使えません。\nChrome または Edge で開いてください。\n※ http://192.168... のようなアドレスで開いている場合も使えません。ファイルを直接開くか、http://localhost で開いてください。");
  return true;
}
async function syncCreate(){
  if(syncNeed())return;
  try{
    const fh=await window.showSaveFilePicker({suggestedName:"agri-data.json",types:FTYPES});
    let c=null;
    if(CRYPTO_OK){
      const pw=await askPassword({title:"共有ファイルを暗号化しますか？",again:true,allowEmpty:true,
        note:"クラウドに置くので、パスワードを設定して暗号化することをおすすめします。<b>パスワードを忘れると、ファイルの中身は誰にも復元できません。</b>空欄のまま決定すると、暗号化しません。"});
      if(pw===null)return; // キャンセル
      if(pw)c=await newCrypto(pw);
    }
    await startSync(fh,"create",false,c);
  }catch(e){syncErr(e);}
}
async function syncOpen(){
  if(syncNeed())return;
  try{
    const [fh]=await window.showOpenFilePicker({types:FTYPES,multiple:false});
    await startSync(fh,"open",false);
  }catch(e){if(!e.cancel)syncErr(e);}
}
async function reconnect(){
  try{await startSync(sync.pend,"reconnect",false);}catch(e){if(!e.cancel)syncErr(e);}
}
async function syncOff(){
  if(sync.busy){alert("同期処理が終わってから接続を解除してください。");return;}
  if(!confirm("共有ファイルとの接続を解除します。データはこのパソコンのブラウザに残ります。よろしいですか？"))return;
  sync.fh=null;sync.pend=null;sync.crypto=null;sync.previousCrypto=null;sync.conflict=null;sync.baseText=null;clearInterval(sync.poll);clearTimeout(sync.timer);sync.timer=null;
  try{await idbSet("fh",undefined);}catch(_){}
  setSync("off");render();
}
// 接続中のファイルを暗号化する／パスワードを変える
async function syncEncrypt(){
  if(sync.busy||sync.conflict){alert("同期処理・競合の確認が終わってから変更してください。");return;}
  if(!sync.fh){alert("先に共有ファイルに接続してください");return;}
  if(cryptoNeed())return;
  const changing=!!sync.crypto;
  const pw=await askPassword({title:changing?"パスワードを変更":"共有ファイルを暗号化",again:true,
    note:"<b>パスワードを忘れると、ファイルの中身は誰にも復元できません。</b>他のパソコンでは、いったん接続を解除して、このパスワードで開き直す必要があります。"});
  if(!pw)return;
  try{
    const c=await newCrypto(pw);
    if(sync.busy||sync.conflict)throw new Error("同期処理中です。処理が終わってから再度お試しください。");
    sync.previousCrypto=sync.crypto;sync.crypto=c;
    save(); // 版数を進めて、暗号化したファイルとして書き込む
    alert((changing?"パスワードの変更を保存待ちです。":"暗号化した内容を保存待ちです。")+"\nヘッダーが「同期済み」になったことを確認してください。他のパソコンでは接続し直して、このパスワードを入力してください。");
    render();
  }catch(e){alert("暗号化に失敗しました："+(e.message||e));}
}
async function syncDecrypt(){
  if(sync.busy||sync.conflict){alert("同期処理・競合の確認が終わってから変更してください。");return;}
  if(!sync.fh||!sync.crypto)return;
  if(!confirm("共有ファイルの暗号化をやめます。クラウド上のファイルが、誰でも読める状態になります。よろしいですか？"))return;
  sync.previousCrypto=sync.crypto;sync.crypto=null;
  save();render();
}
// 暗号化したバックアップをダウンロードする
async function backupEnc(){
  if(cryptoNeed())return;
  const pw=await askPassword({title:"暗号化してバックアップ",again:true,
    note:"<b>パスワードを忘れると、このバックアップは復元できません。</b>"});
  if(!pw)return;
  try{
    const c=await newCrypto(pw);
    const snapshot=JSON.parse(JSON.stringify(db));
    snapshot.lastBackup=new Date().toISOString();snapshot.backupDirty=false;
    const encrypted=await encryptText(JSON.stringify(snapshot),c);
    dl(`agri-backup-${backupStamp()}.enc.json`,encrypted,"application/json");
    recordBackup(snapshot);
    render();
  }catch(e){alert("暗号化に失敗しました："+(e.message||e));}
}
function syncClick(){
  if(sync.state=="conflict"){showSyncConflict();return;}
  if(sync.state=="err"&&sync.fh){startSync(sync.fh,"reconnect",false).catch(syncErr);return;}
  if(sync.state=="pending"){reconnect();return;}
  mode="all";tab="data";render();
}
// 起動時：前回のファイルがあれば自動で再接続（許可が切れていたら、ボタンを押してもらう）
async function syncInit(){
  try{
    let fh=await idbGet("fh");
    if(!fh)return;
    if(fh.drive)fh=driveHandle(fh);else if(!FSA)return;
    sync.pend=fh;sync.name=fh.name;
    let perm=await fh.queryPermission({mode:"readwrite"});
    if(perm!=="granted"&&fh.drive){try{await gdEnsure(false);perm="granted";}catch(_){} } // 画面を出さずにログインできるか試す
    if(perm==="granted"){
      try{await startSync(fh,"reconnect",true);}
      catch(e){setSync("pending",e.locked?"暗号化されています。ヘッダーのボタンを押して、パスワードを入力してください。":e.message);}
    }else setSync("pending","クリックして再接続してください");
  }catch(e){}
}
function syncCard(){
  return `<div class="card"><h2>🔗 共有ファイル（複数のパソコンで自動同期）</h2>
   <p>データファイルをクラウドに置くと、入力した内容が自動でそのファイルに保存され、他の端末の変更も数秒で取り込まれます。方法は次の2つから選びます。</p>
   <p><b>現在の状態：</b><span id="syncState">${esc(syncText()+(sync.msg?"　"+sync.msg:""))}</span></p>
   ${sync.conflict?`<button class="b" onclick="showSyncConflict()">競合した内容を確認する</button>`:""}
   <details><summary>同期時に退避したデータ</summary><p class="hint">最後に採用する直前の両方のデータを、この端末に保管します。保存したJSONは「復元する」から読み込めます。</p>
   <div class="bar"><button class="g" onclick="downloadConflictCopy('local')">退避した端末側を保存</button><button class="g" onclick="downloadConflictCopy('remote')">退避した共有側を保存</button></div></details>
   ${gdSection()}
   <h3 style="font-size:15px;margin:14px 0 6px">🔗 同期フォルダを使う <span class="hint">（Google Drive for desktop・OneDrive・Dropbox など）</span></h3>
   <p class="hint">パソコンで<b>同期しているフォルダ</b>にデータファイルを置く方法です。</p>
   ${FSA?"":`<p class="warn">この方法は、このブラウザでは使えません。Chrome または Edge で開いてください（http://192.168... のアドレスでは使えません）。</p>`}
   <div class="bar">
     <button class="b" onclick="syncCreate()">新しい共有ファイルを作る</button>
     <button class="g" onclick="syncOpen()">既存の共有ファイルを開く</button>
     ${sync.fh||sync.pend?`<button class="g d" onclick="syncOff()">接続を解除</button>`:""}
   </div>
   <h3 style="font-size:15px;margin:14px 0 6px">🔒 暗号化 <span class="hint">${sync.fh?(sync.crypto?"（有効）":"（無効：クラウド上のファイルは誰でも読めます）"):""}</span></h3>
   <p class="hint">パスワードを設定すると、ファイルの中身（口座残高・取引先なども含む）を暗号化します。クラウドの運営会社や、アカウントを乗っ取った人にも読めません。</p>
   <div class="bar">
     ${sync.fh&&!sync.crypto?`<button class="b" onclick="syncEncrypt()">暗号化する（おすすめ）</button>`:""}
     ${sync.fh&&sync.crypto?`<button class="g" onclick="syncEncrypt()">パスワードを変更</button><button class="g d" onclick="syncDecrypt()">暗号化をやめる</button>`:""}
     ${sync.fh&&sync.crypto?`<button class="g" onclick="showBackupKey()">🔑 自動バックアップ用の鍵を表示</button>`:""}
   </div>
   <ul class="hint">
     <li><b>パスワードを忘れると、データは復元できません。</b>忘れないように、別の場所にも控えてください。</li>
     <li>パスワードはどこにも保存しません。パソコンを再起動したあとなど、再接続のときに入力が必要です。</li>
     <li>暗号化されるのは「共有ファイル」と「暗号化バックアップ」です。このパソコンのブラウザ内のデータは暗号化されません。</li>
     <li>パスワードは8文字以上の、推測されにくいものにしてください（長い文章がおすすめです）。</li>
     <li>Googleドライブへの自動バックアップ（Cloudflare の Worker）を使うときは、「自動バックアップ用の鍵を表示」で出る鍵を登録します。鍵はパスワードと同じくらい大切です。パスワードを変えたら、鍵も登録し直してください。</li>
   </ul>
   <ol class="hint">
     <li><b>1台目</b>：同期フォルダの中に「新しい共有ファイルを作る」で agri-data.json を作ります（今のデータが書き込まれます）。</li>
     <li><b>2台目以降</b>：同じファイルが同期されたら、「既存の共有ファイルを開く」で選びます。</li>
     <li>以後は、どのパソコンで入力しても自動で保存・反映されます。次回からは自動で再接続します（許可を求められたら、ヘッダーのボタンを押します）。</li>
   </ol>
   <p class="hint">※ 反映の速さは、クラウドの同期ソフトの速さにも左右されます（数秒〜数十秒）。<br>
   ※ 2台で同時に入力すると、後から保存したほうが先の変更とぶつかります。ぶつかったときは確認メッセージが出ます。基本は「1台ずつ使う」運用にしてください。<br>
   ※ 同期フォルダ方式は、スマホ・タブレットでは使えません（パソコンのChrome / Edgeのみ）。Google ドライブに直接つなぐ方式は、https のアドレスで開いていればスマホでも使えます。<br>
   ※ Google ドライブ方式は、ログインが約1時間で切れます。切れたら自動で取り直しますが、できないときはヘッダーのボタンが「⚠ 共有ファイルに再接続」になるので、押すか、画面をクリックしてください。それまでの入力は、このブラウザに残っています。<br>
   ※ この機能を使っても、念のため「バックアップを保存（JSON）」は定期的に行ってください。</p></div>`;
}
