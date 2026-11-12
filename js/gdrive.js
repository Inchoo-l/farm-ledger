"use strict";
// Google ドライブに直接つなぐ（Drive API）
/* ========== Google ドライブ連携 ==========
   sync.js の「共有ファイル」の仕組み（自動保存・数秒おきの確認・衝突確認・暗号化）をそのまま使い、
   ファイルの置き場所だけを「同期フォルダ」から「Google ドライブ（API）」に差し替える。
   ・driveHandle() が、同期フォルダのファイルと同じ使い方（getFile / createWritable）をする代用品になる
   ・権限は drive.file のみ（このアプリが作ったファイルしか見えない。ドライブの他のファイルには触れない）
   ・ログイン情報(トークン)は約1時間で切れる。切れたら自動で取り直し、できなければ「再接続」の表示になる */

const GD_SCOPE="https://www.googleapis.com/auth/drive.file";
const GD_API="https://www.googleapis.com/drive/v3", GD_UP="https://www.googleapis.com/upload/drive/v3";
const GD_FILE="sharedFolder.json", GD_OLD="agri-data.json", GD_OLDS=[GD_OLD,"帳簿共有用.json"]; // GD_OLDS: 以前の名前（見つかったら GD_FILE に改名する）
const GD={tok:null,exp:0,tc:null,cb:null,p:null,busy:false,fail:0,gsi:null};

function gdClientId(){try{return localStorage.getItem("agri-gclient")||"";}catch(_){return "";}}
function gdSetClient(){
  const v=prompt("Google Cloud で作った OAuth クライアントID を貼り付けてください\n（….apps.googleusercontent.com で終わる文字列）\n空欄で決定すると、設定を消します。",gdClientId());
  if(v===null)return;
  const id=v.trim();
  if(id&&!/\.apps\.googleusercontent\.com$/.test(id)){alert("クライアントIDの形式が違います。\n「….apps.googleusercontent.com」で終わる文字列を貼り付けてください。");return;}
  try{id?localStorage.setItem("agri-gclient",id):localStorage.removeItem("agri-gclient");}catch(_){}
  GD.tc=null;GD.tok=null;GD.exp=0;
  render();
}

// Google のログイン部品を読み込む
function loadGsi(){
  if(window.google&&google.accounts&&google.accounts.oauth2)return Promise.resolve();
  if(GD.gsi)return GD.gsi;
  GD.gsi=new Promise((res,rej)=>{
    const s=document.createElement("script");
    s.src="https://accounts.google.com/gsi/client";s.async=true;
    s.onload=()=>res();
    s.onerror=()=>{GD.gsi=null;rej(new Error("Google のログイン部品を読み込めません（ネットワークを確認してください）"));};
    document.head.appendChild(s);
  });
  return GD.gsi;
}
const gdAuthErr=code=>Object.assign(new Error("Google への再ログインが必要です（クリックして再接続）"),{auth:true,code});

// アクセストークンを取る。prompt: ""=必要なら画面を出す / "none"=画面を出さずに取れたときだけ成功
async function gdToken(prompt){
  const cid=gdClientId();
  if(!cid)throw Object.assign(new Error("Google のクライアントIDが未設定です"),{auth:true});
  await loadGsi();
  if(!GD.tc){
    GD.tc=google.accounts.oauth2.initTokenClient({client_id:cid,scope:GD_SCOPE,
      callback:r=>{const c=GD.cb;GD.cb=null;if(!c)return;
        if(r.error||!r.access_token)c.rej(gdAuthErr(r.error));
        else{GD.tok=r.access_token;GD.exp=Date.now()+Math.max(60,(+r.expires_in||3600)-120)*1000;c.res();}},
      error_callback:e=>{const c=GD.cb;GD.cb=null;if(c)c.rej(gdAuthErr(e&&e.type));}});
  }
  GD.busy=true;
  try{
    await new Promise((res,rej)=>{GD.cb={res,rej};GD.tc.requestAccessToken({prompt});});
  }finally{GD.busy=false;}
}
function gdEnsure(interactive){
  if(GD.tok&&Date.now()<GD.exp)return Promise.resolve();
  if(GD.p)return interactive?GD.p.catch(()=>{}).then(()=>gdEnsure(true)):GD.p;
  const p=gdToken(interactive?"":"none").catch(e=>{GD.fail=Date.now();throw e;}).finally(()=>{if(GD.p===p)GD.p=null;});
  return GD.p=p;
}

async function gdApi(url,opt,retried){
  await gdEnsure(false);
  const r=await fetch(url,Object.assign({},opt,{headers:Object.assign({},opt&&opt.headers,{Authorization:"Bearer "+GD.tok})}));
  if(r.status===401&&!retried){GD.tok=null;GD.exp=0;return gdApi(url,opt,true);}
  if(r.status===401)throw gdAuthErr("401");
  if(!r.ok){
    let m="";try{const j=await r.json();m=(j.error&&j.error.message)||"";}catch(_){}
    if(r.status===403&&/not been used|disabled|accessNotConfigured/i.test(m))m="Google Drive API が有効になっていません。Google Cloud で有効にしてください。（"+m+"）";
    throw new Error(`Google ドライブのエラー(${r.status}) ${m}`);
  }
  return r;
}

// 同期フォルダのファイル(FileSystemFileHandle)と同じ使い方ができる代用品
function driveHandle(d){
  const id=d.id;
  return{
    drive:true,id,name:d.name||GD_FILE,
    persist(){return{drive:true,id,name:this.name};}, // IndexedDB に保存する中身（関数は保存できないため）
    async queryPermission(){return GD.tok&&Date.now()<GD.exp?"granted":"prompt";},
    async requestPermission(){try{await gdEnsure(true);return "granted";}catch(e){return "denied";}},
    async getFile(){
      const m=await(await gdApi(`${GD_API}/files/${id}?fields=modifiedTime,trashed`)).json();
      if(m.trashed)throw new Error("共有ファイルがゴミ箱に入っています");
      return{lastModified:Date.parse(m.modifiedTime),text:async()=>(await gdApi(`${GD_API}/files/${id}?alt=media`)).text()};
    },
    async createWritable(){
      let buf="";
      return{write:async s=>{buf+=s;},
        close:async()=>{await gdApi(`${GD_UP}/files/${id}?uploadType=media`,{method:"PATCH",headers:{"Content-Type":"application/json; charset=UTF-8"},body:buf});}};
    }
  };
}

async function gdFind(name){
  const q=encodeURIComponent(`name='${name}' and trashed=false`);
  const j=await(await gdApi(`${GD_API}/files?q=${q}&spaces=drive&orderBy=modifiedTime%20desc&pageSize=10&fields=files(id,name,modifiedTime)`)).json();
  return j.files||[];
}
async function gdFindFile(){
  const f=await gdFind(GD_FILE);
  if(f.length)return f;
  let old=[];
  for(const n of GD_OLDS){old=await gdFind(n);if(old.length)break;} // 以前の名前のファイルがあれば、新しい名前に改名して使う
  if(!old.length)return [];
  const r=await gdApi(`${GD_API}/files/${old[0].id}?fields=id,name,modifiedTime`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:GD_FILE})});
  return [await r.json()];
}
async function gdCreateFile(){
  const r=await gdApi(`${GD_API}/files?fields=id,name`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:GD_FILE,mimeType:"application/json"})});
  return r.json();
}

// 「Google ドライブに接続」：ファイルがあれば開き、なければ新しく作る
async function gdConnect(){
  if(!gdClientId()){alert("先にクライアントIDを設定してください");return;}
  try{
    await gdEnsure(true);
    const files=await gdFindFile();
    if(files.length){
      await startSync(driveHandle(files[0]),"open",false);
      return;
    }
    let c=null;
    if(CRYPTO_OK){
      const pw=await askPassword({title:"共有ファイルを暗号化しますか？",again:true,allowEmpty:true,
        note:"クラウドに置くので、パスワードを設定して暗号化することをおすすめします。<b>パスワードを忘れると、ファイルの中身は誰にも復元できません。</b>空欄のまま決定すると、暗号化しません。"});
      if(pw===null)return;
      if(pw)c=await newCrypto(pw);
    }
    await startSync(driveHandle(await gdCreateFile()),"create",false,c);
  }catch(e){syncErr(e);}
}

// ログインが切れて「再接続」の表示になっているとき、画面のどこかをクリックしたら自動で再接続を試みる
// （ログイン画面の表示は、クリックなどの操作の直後でないとブラウザに止められるため）
document.addEventListener("pointerdown",e=>{
  if(sync.state!="pending"||!sync.pend||!sync.pend.drive||GD.busy||sync.busy)return;
  if(Date.now()-GD.fail<60000)return; // 失敗した直後は、ボタンを押すまで待つ
  if(e.target.closest&&e.target.closest("#syncBtn"))return;
  startSync(sync.pend,"reconnect",true).catch(err=>{
    GD.fail=Date.now();
    if(err&&err.locked)setSync("pending","暗号化されています。ヘッダーのボタンを押して、パスワードを入力してください。");
  });
},true);

// 設定画面（「共有ファイル」カード）に出す、Google ドライブの部分
function gdSection(){
  const cid=gdClientId(), on=!!(sync.fh&&sync.fh.drive)||!!(sync.pend&&sync.pend.drive);
  const origin=location.origin, okOrigin=/^https:|^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin);
  return `<h3 style="font-size:15px;margin:14px 0 6px">☁ Google ドライブに直接つなぐ <span class="hint">（同期フォルダ不要）</span></h3>
   ${okOrigin?"":`<p class="warn">今のアドレス（${esc(origin)}）では Google ログインを使えません。<b>http://localhost:ポート番号</b> または https のアドレスで開いてください。</p>`}
   ${cid?`<div class="bar">
      <button class="b" onclick="gdConnect()">${on?"接続し直す":"Google ドライブに接続"}</button>
      <button class="g" onclick="gdSetClient()">クライアントIDを変更</button></div>
     <p class="hint">ドライブ直下の <b>${GD_FILE}</b> を開きます（無ければ新しく作ります）。このアプリが作ったファイルしか見えないので、ドライブの他のファイルには触れません。</p>`
   :`<p class="hint">最初に1回だけ、Google の設定でクライアントIDを作る必要があります（無料・5分ほど）。</p>
     <ol class="hint">
       <li><a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">Google Cloud Console</a> でプロジェクトを作成します。</li>
       <li>「APIとサービス」→「ライブラリ」で <b>Google Drive API</b> を有効にします。</li>
       <li>「OAuth 同意画面」を設定します（ユーザーの種類は「外部」）。スコープは追加不要です。「公開ステータス」を「本番環境」にするか、「テストユーザー」に自分の Gmail を追加します。</li>
       <li>「認証情報」→「認証情報を作成」→「OAuth クライアント ID」→ 種類「<b>ウェブ アプリケーション</b>」。「承認済みの JavaScript 生成元」に <b>${esc(origin)}</b> を追加します。</li>
       <li>表示された「クライアント ID」を、下のボタンから貼り付けます（秘密の情報ではありません）。</li>
     </ol>
     <div class="bar"><button class="b" onclick="gdSetClient()">クライアントIDを入力</button></div>`}`;
}
