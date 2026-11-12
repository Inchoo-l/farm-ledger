// パスワードによる暗号化（AES-256-GCM） "use strict";
/* ===== パスワードによる暗号化（共有ファイル・バックアップ用） =====
   パスワード → PBKDF2(SHA-256・60万回)で鍵を作り → AES-256-GCM で暗号化する。
   ・パスワードはどこにも保存しない（忘れると復元できない）
   ・ファイルには「暗号文・salt・iv・版数(rev)」だけが入り、帳簿の内容は読めない */
const CRYPTO_OK=!!(window.crypto&&window.crypto.subtle);
const ITER=600000;
const b64e=u8=>{let s="";for(let i=0;i<u8.length;i+=8192)s+=String.fromCharCode.apply(null,u8.subarray(i,i+8192));return btoa(s);};
const b64d=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function deriveKey(pw,salt,iter){
  const base=await crypto.subtle.importKey("raw",new TextEncoder().encode(pw),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:iter,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function newCrypto(pw){ // 新しいパスワードから鍵を作る（saltは毎回ランダム）
  const salt=crypto.getRandomValues(new Uint8Array(16));
  return{key:await deriveKey(pw,salt,ITER),salt:b64e(salt),iter:ITER};
}
async function encryptText(text,c){
  const rev=JSON.parse(text).rev||0; // 暗号化中に入力が増えても、送信するスナップショットの版数を使う
  const iv=crypto.getRandomValues(new Uint8Array(12)); // 書き込みのたびに新しい iv
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},c.key,new TextEncoder().encode(text)));
  return JSON.stringify({format:"agri-ledger-enc",v:1,kdf:"PBKDF2-SHA256",iter:c.iter,salt:c.salt,iv:b64e(iv),rev,data:b64e(ct)});
}
async function decryptEnv(env,c){
  try{
    const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:b64d(env.iv)},c.key,b64d(env.data));
    return JSON.parse(new TextDecoder().decode(pt));
  }catch(e){throw Object.assign(new Error("パスワードが違うか、ファイルが壊れています"),{badPw:true});}
}
const isEnv=o=>!!o&&o.format==="agri-ledger-enc"&&!!o.data;
// パスワード入力画面（入力中の文字は伏せ字）。キャンセルは null、暗号化しない場合は ""
function askPassword({title,note,again,allowEmpty}){
  return new Promise(resolve=>{
    const body=`<p class="hint">${note||""}</p>
      <label>パスワード（8文字以上）${allowEmpty?"":`<span class="rq">※</span>`}</label>
      <input type="password" name="pw" autocomplete="${again?"new-password":"current-password"}" ${allowEmpty?"":"required"}>
      ${again?`<label>パスワード（確認のため、もう一度）</label><input type="password" name="pw2" autocomplete="new-password">`:""}`;
    $("frm").innerHTML=dlgFrame(title,body,"決定");
    const dlg=$("dlg");let done=false;
    const fin=v=>{if(done)return;done=true;dlg.removeEventListener("close",onClose);resolve(v);};
    const onClose=()=>fin(null);
    dlg.addEventListener("close",onClose);
    dlg.showModal();
    $("frm").elements.pw.focus();
    $("frm").onsubmit=ev=>{
      if(ev.submitter&&ev.submitter.value=="cancel")return;
      const f=$("frm").elements,pw=f.pw.value;
      if(again&&pw!==f.pw2.value){ev.preventDefault();alert("確認用のパスワードが一致しません");return;}
      if(pw&&pw.length<8){ev.preventDefault();alert("パスワードは8文字以上にしてください");return;}
      fin(pw);
    };
  });
}
// 暗号化ファイルを開く：正しいパスワードが入るまで聞く
async function decryptWithPrompt(env,title){
  for(;;){
    const pw=await askPassword({title:title||"パスワードの入力",note:"このファイルは暗号化されています。パスワードを入力してください。"});
    if(pw===null||pw==="")throw Object.assign(new Error("キャンセルしました"),{cancel:true});
    const c={key:await deriveKey(pw,b64d(env.salt),env.iter),salt:env.salt,iter:env.iter};
    try{return{obj:await decryptEnv(env,c),c};}
    catch(e){if(!e.badPw)throw e;alert("パスワードが違います。もう一度入力してください。");}
  }
}
function cryptoNeed(){
  if(CRYPTO_OK)return false;
  alert("このアドレスでは暗号化を使えません（ブラウザの制限）。\nファイルを直接開くか、http://localhost で開いてください。");
  return true;
}

/* ===== 自動バックアップ用の鍵 =====
   Google ドライブの自動バックアップ（Cloudflare の Worker）が、パスワードで暗号化した共有ファイルを開いて増分を作れるよう、
   パスワードから作った「暗号鍵」だけを取り出して、Worker の秘密情報(DATA_KEY)に登録する。パスワードそのものは渡さない。
   ・鍵は、そのパスワード（と salt）で暗号化したファイルを開ける。パスワードと同じくらい大切に扱う（他人に見せない）
   ・パスワードを変えると鍵も変わる（共有ファイルの salt が変わるため）。そのときは、鍵を表示し直して登録し直す */
async function makeBackupKey(pw){
  if(!CRYPTO_OK)throw new Error("このアドレスでは暗号化を使えません（ブラウザの制限）");
  if(!sync.crypto)throw new Error("共有ファイルがパスワードで暗号化されていません（先に暗号化して接続してください）");
  const c=sync.crypto;
  const base=await crypto.subtle.importKey("raw",new TextEncoder().encode(pw),"PBKDF2",false,["deriveKey"]);
  const key=await crypto.subtle.deriveKey({name:"PBKDF2",salt:b64d(c.salt),iterations:c.iter,hash:"SHA-256"},base,{name:"AES-GCM",length:256},true,["encrypt","decrypt"]);
  // パスワードが合っているかの確認：この鍵で暗号化したものを、接続中の鍵で開けるか
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode("ok"));
  try{await crypto.subtle.decrypt({name:"AES-GCM",iv},c.key,ct);}catch(e){throw new Error("パスワードが違います");}
  const raw=new Uint8Array(await crypto.subtle.exportKey("raw",key));
  return JSON.stringify({v:1,salt:c.salt,iter:c.iter,key:b64e(raw)});
}
async function showBackupKey(){
  try{
    if(!sync.fh||!sync.crypto){alert("共有ファイルをパスワードで暗号化して接続しているときに使えます。\n（暗号化していない場合は、鍵は不要です）");return;}
    if(cryptoNeed())return;
    const pw=await askPassword({title:"自動バックアップ用の鍵",note:"共有ファイルのパスワードをもう一度入力してください。パスワードから作った「鍵」を表示します（パスワードそのものは表示しません）。"});
    if(!pw)return;
    const text=await makeBackupKey(pw);
    const dlg=$("dlg");
    if(dlg.open)await new Promise(r=>dlg.addEventListener("close",r,{once:true})); // パスワード入力画面が閉じるのを待つ
    $("frm").innerHTML=dlgFrame("自動バックアップ用の鍵",
      `<p class="hint">下の文字列を<b>全部</b>コピーして、設定手順書のとおり、Cloudflare の秘密情報 <b>DATA_KEY</b> に登録してください。<br>
       <b class="warn">この鍵は、パスワードと同じくらい大切です。他人に見せたり、メールやチャットに貼ったりしないでください。</b><br>
       共有ファイルのパスワードを変えたときは、ここでもう一度表示して、DATA_KEY を登録し直します。</p>
       <textarea id="bkKey" readonly rows="6" style="font-family:monospace;font-size:13px" onfocus="this.select()">${esc(text)}</textarea>
       <div class="bar" style="margin-top:8px"><button type="button" class="b" onclick="copyVal(document.getElementById('bkKey').value,this)">コピーする</button></div>`,"閉じる");
    $("frm").onsubmit=()=>{};
    dlg.showModal();
  }catch(e){if(!e||!e.cancel)alert("鍵を作れませんでした：\n"+((e&&e.message)||e));}
}
