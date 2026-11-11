"use strict";
// 共有ファイル連携（クラウド同期フォルダのファイルを自動で読み書き）
/* ========== 共有ファイル連携 ==========
   OneDrive / Google Drive などで同期しているフォルダの JSON ファイルを、アプリが直接読み書きする。
   ・入力するたびに自動でファイルへ保存
   ・数秒おきにファイルを確認し、他のパソコンが更新していたら自動で読み込む
   ・同時に更新してぶつかったときは、確認メッセージを出す（データは版数 rev で前後を判断） */

const sync={fh:null,pend:null,name:"",lastMod:0,baseRev:0,timer:null,poll:null,state:"off",at:null,msg:"",busy:false,crypto:null};
const FSA=typeof window.showOpenFilePicker=="function";
const FTYPES=[{description:"帳簿データ(JSON)",accept:{"application/json":[".json"]}}];

// ファイルの「手がかり」(handle)を IndexedDB に保存し、次回起動時に再接続できるようにする
function idb(){return new Promise((res,rej)=>{const r=indexedDB.open("agri-sync",1);r.onupgradeneeded=()=>r.result.createObjectStore("kv");r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
async function idbGet(k){const d=await idb();return new Promise((res,rej)=>{const r=d.transaction("kv").objectStore("kv").get(k);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
async function idbSet(k,v){const d=await idb();return new Promise((res,rej)=>{const t=d.transaction("kv","readwrite");if(v===undefined)t.objectStore("kv").delete(k);else t.objectStore("kv").put(v,k);t.oncomplete=()=>res();t.onerror=()=>rej(t.error);});}

function syncText(){
  if(!FSA&&!sync.fh&&!sync.pend&&!gdClientId())return "🔗 共有ファイル：未接続";
  if(sync.state=="ok")return `${sync.fh&&sync.fh.drive?"☁":"🔗"}${sync.crypto?"🔒":""} 同期中：${sync.name}（${sync.at?sync.at.toLocaleTimeString("ja-JP"):""}）`;
  if(sync.state=="pending")return "⚠ 共有ファイルに再接続";
  if(sync.state=="err")return "⚠ 同期エラー";
  return "🔗 共有ファイル：未接続";
}
function setSync(state,msg){sync.state=state;sync.msg=msg||"";if(state=="ok")sync.at=new Date();updateSyncUI();}
function updateSyncUI(){
  const b=$("syncBtn");
  if(b){b.textContent=syncText();b.title=sync.msg||"";}
  $("lastBk").textContent=sync.state=="ok"
    ?"変更は共有ファイルに自動保存されます"
    :"最終バックアップ："+(db.lastBackup||"未実施")+(db.dirty?"（以降の変更は未保存）":"");
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
    if(isEnv(p)){
      enc=true;
      if(sync.crypto&&sync.crypto.salt===p.salt)obj=await decryptEnv(p,sync.crypto); // 接続中の鍵で開く
      else if(ask){const r=await decryptWithPrompt(p);obj=r.obj;sync.crypto=r.c;}
      else throw Object.assign(new Error("パスワードが必要です"),{locked:true});
    }else obj=p;
  }
  return{f,obj,enc};
}
const validData=o=>!!o&&Array.isArray(o.expenses)&&Array.isArray(o.fields);
function applyRemote(obj,f){
  db=fixDb(obj);
  db.dirty=false;
  sync.baseRev=db.rev||0;sync.lastMod=f.lastModified;
  persistLocal();
  resetHist(); // 他のパソコンの内容に入れ替わったので、これ以前には戻せない
  setSync("ok");render();
}
function keepLocalCopy(){try{localStorage.setItem(KEY+"-conflict",JSON.stringify(db));}catch(_){}}

// 入力のたびに少し待ってからまとめて書き込む
function queueWrite(){
  if(!sync.fh||sync.state=="pending")return;
  clearTimeout(sync.timer);
  sync.timer=setTimeout(()=>{sync.timer=null;writeFile();},500);
}
async function writeFile(){
  if(!sync.fh)return;
  if(sync.busy){queueWrite();return;}
  sync.busy=true;
  try{
    let f,obj;
    try{({f,obj}=await readRemote(false));}
    catch(e){
      // 暗号化の設定を変えた直後など、ファイルの鍵が自分の鍵と違う場合。
      // 前回の同期のあとファイルが変わっていなければ、そのまま上書きしてよい
      if(!e.locked)throw e;
      f=await sync.fh.getFile();obj=null;
      if(f.lastModified!==sync.lastMod)throw e;
    }
    // 前回の同期のあとに、他のパソコンがファイルを更新していないか確認
    if(f.lastModified!==sync.lastMod&&validData(obj)&&(obj.rev||0)>sync.baseRev){
      const take=confirm("他のパソコンが先にデータを更新しました。\n\n［OK］相手の内容を読み込む（この画面で入力した直近の変更は破棄されます。念のため控えを残します）\n［キャンセル］この画面の内容で上書きする（相手の変更が消えます）");
      if(take){keepLocalCopy();applyRemote(obj,f);return;}
    }
    const w=await sync.fh.createWritable();
    // パスワードを設定している間は、暗号化して書き込む
    await w.write(sync.crypto?await encryptText(JSON.stringify(db),sync.crypto):JSON.stringify(db));
    await w.close();
    const f2=await sync.fh.getFile();
    sync.lastMod=f2.lastModified;sync.baseRev=db.rev||0;
    db.dirty=false;persistLocal();
    setSync("ok");
  }catch(e){
    if(e.auth){sync.pend=sync.fh;setSync("pending",e.message);return;} // Google のログイン切れ：再接続を待つ（入力内容はこのブラウザに残っている）
    setSync("err",e.locked?"共有ファイルのパスワードが変わっています。接続を解除して、新しいパスワードで開き直してください。":(e.message||String(e)));
  }
  finally{sync.busy=false;}
}
// 数秒おきにファイルを確認し、他のパソコンの更新を取り込む
async function pollTick(){
  if(!sync.fh||sync.busy||sync.timer||sync.state=="pending")return;
  if($("dlg").open)return; // 入力中は割り込まない
  try{
    const f=await sync.fh.getFile();
    if(f.lastModified===sync.lastMod)return;
    const text=await f.text();
    let obj=text.trim()?JSON.parse(text):null; // 同期ソフトの書き込み途中なら失敗→次回やり直し
    if(isEnv(obj)){
      if(!sync.crypto||sync.crypto.salt!==obj.salt){ // 他のパソコンがパスワードを変えた／暗号化した
        sync.lastMod=f.lastModified;
        setSync("err","他のパソコンが暗号化の設定を変えました。接続を解除して、新しいパスワードで開き直してください。");
        return;
      }
      obj=await decryptEnv(obj,sync.crypto);
    }
    if(validData(obj)&&(obj.rev||0)>(db.rev||0))applyRemote(obj,f);
    else sync.lastMod=f.lastModified;
  }catch(e){if(e&&e.auth&&sync.fh){sync.pend=sync.fh;setSync("pending",e.message);}}
}
function startPolling(){clearInterval(sync.poll);sync.poll=setInterval(pollTick,sync.fh&&sync.fh.drive?5000:3000);}
window.addEventListener("focus",()=>pollTick());
document.addEventListener("visibilitychange",()=>{if(!document.hidden)pollTick();});

// 接続する。how: "create"=新しく作る / "open"=既存ファイルを開く / "reconnect"=前回のファイルに再接続
// silent=true: パスワード入力画面を出さない（起動時の自動再接続用）／ newC: 新規作成時に使う暗号化の鍵（暗号化しないなら null）
async function startSync(fh,how,silent,newC){
  const perm=await fh.requestPermission({mode:"readwrite"});
  if(perm!=="granted")throw new Error("ファイルの読み書きが許可されませんでした");
  const prev={fh:sync.fh,name:sync.name,lastMod:sync.lastMod,baseRev:sync.baseRev,crypto:sync.crypto};
  sync.fh=fh;sync.name=fh.name;sync.lastMod=0;sync.baseRev=0;
  if(how=="create")sync.crypto=newC||null;
  try{
    // 新規作成は既存の中身を使わない（上書き）ので、読み込まない
    const {f,obj,enc}=how=="create"?{f:await fh.getFile(),obj:null,enc:false}:await readRemote(!silent);
    if(how!="create"&&!enc)sync.crypto=null; // 暗号化されていないファイルに接続した
    if(obj&&!validData(obj))throw new Error("このファイルは帳簿データではありません");
    const valid=validData(obj), fr=valid?(obj.rev||0):0, lr=db.rev||0;
    const hasLocal=db.expenses.length+db.sales.length+db.fields.length+db.plantings.length+db.accounts.length>0;
    let takeFile=false, writeOurs=false;
    if(how=="create"||!valid)writeOurs=true;
    else if(fr>lr){
      takeFile=how=="reconnect"||!hasLocal||confirm("このパソコンのデータを、ファイルの内容で置き換えます。よろしいですか？\n（今のデータは控えとして残します）");
      if(!takeFile)throw new Error("キャンセルしました");
    }else if(fr<lr){
      writeOurs=how=="reconnect"||confirm("ファイルより、このパソコンのデータのほうが新しいです。\nこのパソコンの内容でファイルを上書きしますか？");
      if(!writeOurs)throw new Error("キャンセルしました");
    }else{sync.lastMod=f.lastModified;sync.baseRev=lr;}
    if(takeFile){keepLocalCopy();applyRemote(obj,f);}
    if(writeOurs){
      sync.lastMod=f.lastModified;sync.baseRev=fr;
      await writeFile();
      if(sync.state!="ok")throw new Error(sync.msg||"ファイルに書き込めませんでした");
    }
    try{await idbSet("fh",fh.persist?fh.persist():fh);}catch(_){}
    sync.pend=null;
    startPolling();setSync("ok");
  }catch(e){
    Object.assign(sync,prev);
    throw e;
  }
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
  if(!confirm("共有ファイルとの接続を解除します。データはこのパソコンのブラウザに残ります。よろしいですか？"))return;
  sync.fh=null;sync.pend=null;sync.crypto=null;clearInterval(sync.poll);clearTimeout(sync.timer);sync.timer=null;
  try{await idbSet("fh",undefined);}catch(_){}
  setSync("off");render();
}
// 接続中のファイルを暗号化する／パスワードを変える
async function syncEncrypt(){
  if(!sync.fh){alert("先に共有ファイルに接続してください");return;}
  if(cryptoNeed())return;
  const changing=!!sync.crypto;
  const pw=await askPassword({title:changing?"パスワードを変更":"共有ファイルを暗号化",again:true,
    note:"<b>パスワードを忘れると、ファイルの中身は誰にも復元できません。</b>他のパソコンでは、いったん接続を解除して、このパスワードで開き直す必要があります。"});
  if(!pw)return;
  try{
    sync.crypto=await newCrypto(pw);
    save(); // 版数を進めて、暗号化したファイルとして書き込む
    alert((changing?"パスワードを変更しました。":"暗号化しました。")+"\n他のパソコンでは、「接続を解除」→「既存の共有ファイルを開く」で、このパスワードを入力してください。");
    render();
  }catch(e){alert("暗号化に失敗しました："+(e.message||e));}
}
async function syncDecrypt(){
  if(!sync.fh||!sync.crypto)return;
  if(!confirm("共有ファイルの暗号化をやめます。クラウド上のファイルが、誰でも読める状態になります。よろしいですか？"))return;
  sync.crypto=null;
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
    db.lastBackup=today();save(true);
    dl(`agri-backup-${backupStamp()}.enc.json`,await encryptText(JSON.stringify(db),c),"application/json");
    render();
  }catch(e){alert("暗号化に失敗しました："+(e.message||e));}
}
function syncClick(){
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
