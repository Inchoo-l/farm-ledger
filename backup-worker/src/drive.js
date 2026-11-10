// Google ドライブの操作（OAuth のリフレッシュトークンで、あなたの権限として動く） "use strict";
/* 使う秘密情報：GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
   権限は drive.file のみ（このアプリのクライアントIDで作ったファイルしか見えない。ドライブの他のファイルには触れない）。
   一時的な失敗（通信エラー・429・5xx）は、少し待って自動でやり直す。ログイン切れ（invalid_grant）はやり直さず、すぐ知らせる。 */
import {BackupError} from "./errors.js";

const MIME_FOLDER="application/vnd.google-apps.folder";
const q=s=>"'"+String(s).replace(/\\/g,"\\\\").replace(/'/g,"\\'")+"'"; // 検索条件に入れる文字を安全にする

export function createDrive(env,opt={}){
  const f=opt.fetch||((...a)=>fetch(...a));
  const sleep=opt.sleep||(ms=>new Promise(r=>setTimeout(r,ms)));
  const DELAYS=opt.delays||[1000,4000,12000]; // やり直す前に待つ時間（ミリ秒）
  const TOKEN_URL=env.GOOGLE_TOKEN_URL||"https://oauth2.googleapis.com/token";
  const API=env.GOOGLE_DRIVE_API||"https://www.googleapis.com/drive/v3";
  const UP=env.GOOGLE_UPLOAD_API||"https://www.googleapis.com/upload/drive/v3";
  let tok=null,exp=0;

  const need=k=>{if(!env[k])throw new BackupError("config",`秘密情報 ${k} が登録されていません。設定手順書の「秘密情報を登録する」をやり直してください。`);return env[k];};

  // 通信（一時的な失敗は自動でやり直す）
  async function send(url,init,what){
    let last;
    for(let i=0;i<=DELAYS.length;i++){
      try{
        const r=await f(url,init);
        if(r.status===429||r.status>=500){
          last=new BackupError("transient",`${what}：Google が一時的に応答しませんでした（HTTP ${r.status}）`,{status:r.status});
        }else return r;
      }catch(e){
        last=new BackupError("transient",`${what}：通信できませんでした（${e&&e.message||e}）`);
      }
      if(i<DELAYS.length)await sleep(DELAYS[i]);
    }
    throw last;
  }

  // アクセストークンを取る（約1時間有効。使い回す）
  async function token(){
    if(tok&&Date.now()<exp)return tok;
    const body=new URLSearchParams({client_id:need("GOOGLE_CLIENT_ID"),client_secret:need("GOOGLE_CLIENT_SECRET"),refresh_token:need("GOOGLE_REFRESH_TOKEN"),grant_type:"refresh_token"});
    const r=await send(TOKEN_URL,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body},"Google のログイン");
    let j={};try{j=await r.json();}catch(_){}
    if(!r.ok||!j.access_token){
      const code=j.error||"";
      if(code==="invalid_grant")throw new BackupError("auth","Google の許可が切れています（リフレッシュトークンが無効です）。OAuth の公開状態が「テスト」のままだと7日で切れます。「本番環境」にして、リフレッシュトークンを取り直して登録し直してください。");
      if(code==="invalid_client"||code==="unauthorized_client")throw new BackupError("config","Google のクライアントID／シークレットが正しくありません（"+code+"）。登録し直してください。");
      throw new BackupError("auth","Google のログインに失敗しました（"+(code||("HTTP "+r.status))+"）"+(j.error_description?"："+j.error_description:""));
    }
    tok=j.access_token;exp=Date.now()+Math.max(60,(+j.expires_in||3600)-120)*1000;
    return tok;
  }

  // ドライブの API を呼ぶ（ログインが切れていたら1回だけ取り直す）
  async function api(url,init={},what="ドライブ",retried=false){
    const t=await token();
    const r=await send(url,Object.assign({},init,{headers:Object.assign({},init.headers,{Authorization:"Bearer "+t})}),what);
    if(r.status===401&&!retried){tok=null;exp=0;return api(url,init,what,true);}
    if(r.status===401)throw new BackupError("auth","Google ドライブへのログインに失敗しました（HTTP 401）。リフレッシュトークンを取り直してください。");
    if(!r.ok){
      let m="";try{const j=await r.json();m=(j.error&&(j.error.message||j.error))||"";}catch(_){}
      if(r.status===403&&/not been used|disabled|accessNotConfigured/i.test(m))throw new BackupError("config","Google Drive API が有効になっていません。Google Cloud で有効にしてください。（"+m+"）");
      if(r.status===403&&/rate|quota/i.test(m))throw new BackupError("transient",what+"："+m,{status:403});
      throw new BackupError("drive",`${what}：Google ドライブのエラー（HTTP ${r.status}）${m?" "+m:""}`,{status:r.status});
    }
    return r;
  }

  async function list(query,fields){
    const out=[];let page="";
    do{
      const url=`${API}/files?q=${encodeURIComponent(query)}&spaces=drive&orderBy=modifiedTime%20desc&pageSize=200&fields=${encodeURIComponent("nextPageToken,files("+fields+")")}${page?"&pageToken="+encodeURIComponent(page):""}`;
      const j=await(await api(url,{},"ファイル一覧")).json();
      out.push(...(j.files||[]));page=j.nextPageToken||"";
    }while(page);
    return out;
  }

  return{
    // 名前でファイルを探す（新しい順）
    findFiles:name=>list(`name=${q(name)} and trashed=false and mimeType!='${MIME_FOLDER}'`,"id,name,modifiedTime,size"),
    // バックアップ用のフォルダを探す。なければ作る（create=false のときは作らず null）
    async ensureFolder(name,{create=true}={}){
      const found=await list(`name=${q(name)} and mimeType='${MIME_FOLDER}' and trashed=false`,"id,name");
      if(found.length)return found[0];
      if(!create)return null;
      const r=await api(`${API}/files?fields=id,name`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,mimeType:MIME_FOLDER})},"フォルダの作成");
      return r.json();
    },
    listFolder:id=>list(`${q(id)} in parents and trashed=false`,"id,name,modifiedTime,size"),
    async download(id){return(await api(`${API}/files/${encodeURIComponent(id)}?alt=media`,{},"ファイルの読み込み")).text();},
    // 保存（id があれば上書き。なければ新しく作る）
    async upload({name,parent,text,id}){
      if(id){
        const r=await api(`${UP}/files/${encodeURIComponent(id)}?uploadType=media&fields=id,name,size`,{method:"PATCH",headers:{"Content-Type":"application/json; charset=UTF-8"},body:text},"ファイルの上書き");
        return r.json();
      }
      const bd="b"+Math.random().toString(36).slice(2)+Date.now().toString(36);
      const body=`--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({name,parents:[parent],mimeType:"application/json"})}\r\n--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${text}\r\n--${bd}--`;
      const r=await api(`${UP}/files?uploadType=multipart&fields=id,name,size`,{method:"POST",headers:{"Content-Type":"multipart/related; boundary="+bd},body},"ファイルの保存");
      return r.json();
    },
    // ゴミ箱へ移す（完全には消さない。30日間は復元できる）
    async trash(id){await api(`${API}/files/${encodeURIComponent(id)}?fields=id`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({trashed:true})},"ゴミ箱へ移動");}
  };
}
