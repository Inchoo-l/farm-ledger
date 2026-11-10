// バックアップ本体：共有ファイルを読み、フル／増分を決めて、ドライブの「バックアップ」フォルダへ保存する "use strict";
/* ========== 1回の実行の流れ ==========
   1. 共有ファイル（ドライブ）を読む。パスワードで暗号化されていれば、秘密情報 DATA_KEY の鍵で開く
   2. 日本時間の「日曜」ならフル、それ以外は増分（曜日は FULL_DAY で変えられる。cron の曜日ではなく、ここで日本時間に直して判定する）
   3. フォルダの中のフル＋増分から、前回の状態を作り直す（保管場所を別に持たないので、フォルダの中身がそのまま「前回の状態」になる）
      → 鎖が切れていたり、フルが無かったりしたら、増分ではなくフルを取り直す（自己修復）
   4. 保存する。同じ日にもう一度実行したときは、同じ名前のファイルを上書きする（重複して作らない）
   5. フルが無事に保存できたら、そのときだけ、古いフルと古い増分をゴミ箱へ移す（失敗したら古いものは残す）
   ファイル名：フル_1109.json／増分_1110.json（月日は日本時間） */
import BC from "../../js/backupchain.js";
import {BackupError} from "./errors.js";
import {isEnv,loadKey,decryptEnv,encryptEnv} from "./wcrypto.js";

const NAME_RE=/^(フル|増分)_(\d{4})\.json$/;
const pad=n=>String(n).padStart(2,"0");
const utf8len=s=>new TextEncoder().encode(s).length;

// 日本時間（UTC+9）の日付・月日・曜日（0=日曜）
export function jstParts(ms){
  const d=new Date(ms+9*3600e3);
  return{date:`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`,mmdd:pad(d.getUTCMonth()+1)+pad(d.getUTCDate()),dow:d.getUTCDay()};
}

// 共有ファイルの中身を読む（暗号化されていれば鍵で開く）
async function readSource(text,key){
  if(!text||!text.trim())throw new BackupError("data","共有ファイルが空でした（同期の途中かもしれません）。次回の実行でやり直します。",{retryable:true});
  let p;
  try{p=JSON.parse(text);}catch(e){throw new BackupError("data","共有ファイルの中身を読めませんでした（同期の途中かもしれません）。",{retryable:true});}
  let db,encrypted=false;
  if(isEnv(p)){
    if(!key)throw new BackupError("config","共有ファイルはパスワードで暗号化されています。アプリで「自動バックアップ用の鍵を表示」を押し、出た文字列を秘密情報 DATA_KEY に登録してください。");
    if(p.salt!==key.salt)throw new BackupError("config","共有ファイルのパスワードが変わっています（登録した鍵と合いません）。アプリで「自動バックアップ用の鍵を表示」を押し直して、DATA_KEY を登録し直してください。");
    db=await decryptEnv(p,key);encrypted=true;
  }else db=p;
  if(!db||!Array.isArray(db.expenses)||!Array.isArray(db.fields))throw new BackupError("data","共有ファイルの中身が帳簿データではありません。");
  return{db,encrypted};
}
// ドライブのバックアップ1件を読む（暗号化されていれば鍵で開く）
async function readBackup(drive,file,key){
  const text=await drive.download(file.id);
  const p=JSON.parse(text);
  if(isEnv(p)){
    if(!key||p.salt!==key.salt)throw new Error("今の鍵では開けません");
    return decryptEnv(p,key);
  }
  return p;
}
const serialize=async(obj,encrypted,key)=>{const t=JSON.stringify(obj);return encrypted?encryptEnv(t,key,obj.rev||0):t;};

/* 1回ぶんのバックアップ。
   env … 設定と秘密情報 / o.scheduledTime … 実行時刻(ms) / o.mode … "auto" | "dry-run"（保存せず計画だけ） | "force-full" | "force-incr"
   o.drive … ドライブの操作（drive.js）/ o.now … 今の時刻を返す関数 / o.log … ログを出す関数 */
export async function runBackup(env,o){
  const log=o.log||(()=>{}),drive=o.drive,mode=o.mode||"auto",now=o.now||(()=>Date.now());
  const cfg={
    dataName:env.DATA_FILE_NAME||"sharedFolder.json",
    folderName:env.BACKUP_FOLDER_NAME||"バックアップ",
    fullDay:(env.FULL_DAY===undefined||env.FULL_DAY===null||env.FULL_DAY==="")?0:+env.FULL_DAY, // 0=日曜
  };
  if(!Number.isInteger(cfg.fullDay)||cfg.fullDay<0||cfg.fullDay>6)throw new BackupError("config","FULL_DAY（フルの曜日）は 0〜6（0=日曜）で指定してください。");
  const when=jstParts(o.scheduledTime||now());
  const warnings=[];
  const key=await loadKey(env.DATA_KEY);
  log(`開始 ${when.date}（日本時間・曜日=${when.dow}）モード=${mode}`);

  // 1. 共有ファイルを読む
  const found=await drive.findFiles(cfg.dataName);
  if(!found.length)throw new BackupError("notfound",`ドライブに「${cfg.dataName}」が見つかりません。次のどれかが考えられます：①アプリでGoogleドライブに接続していない ②OAuthのクライアントIDが、アプリと違う（同じクライアントIDで作られたファイルしか見えません） ③ファイル名が違う（DATA_FILE_NAME を確認）`);
  if(found.length>1)warnings.push(`「${cfg.dataName}」が${found.length}個あります。いちばん新しいものを使いました。`);
  const src=await readSource(await drive.download(found[0].id),key);
  log(`共有ファイルを読みました（暗号化=${src.encrypted}、版数=${src.db.rev||0}）`);

  // 2. バックアップのフォルダと、中身
  const folder=await drive.ensureFolder(cfg.folderName,{create:mode!=="dry-run"});
  const files=folder?await drive.listFolder(folder.id):[];
  const backups=files.map(f=>{const m=NAME_RE.exec(f.name);return m?Object.assign({},f,{type:m[1]==="フル"?"full":"incr",mmdd:m[2]}):null;}).filter(Boolean);
  const fullName=`フル_${when.mmdd}.json`,incrName=`増分_${when.mmdd}.json`;

  // 3. フルか増分か
  let type="incr",reason="";
  if(mode==="force-full"){type="full";reason="手動でフルを指定";}
  else if(when.dow===cfg.fullDay){type="full";reason="フルの日（日本時間・曜日）";}
  let base=null;
  if(type==="incr"){
    const r=await loadBase(drive,backups,key,incrName);
    if(r.state)base=r;
    else{type="full";reason="増分の土台がそろっていないためフルを取り直す（"+r.fail+"）";warnings.push("前回までのバックアップがそろっていなかったので、フルを取り直しました。（"+r.fail+"）");}
  }
  log(`計画：${type==="full"?"フル":"増分"}　${reason}`);
  if(mode==="dry-run"){
    return{dryRun:true,type,reason,name:type==="full"?fullName:incrName,date:when.date,existing:backups.map(b=>b.name),warnings};
  }

  // 4. 保存
  let stamp=new Date(now()).toISOString();
  if(base&&stamp<=base.stamp)stamp=new Date(Date.parse(base.stamp)+1).toISOString(); // 前より必ず新しくする
  const meta={stamp,date:when.date};
  let name,obj,changes=null;
  if(type==="full"){name=fullName;obj=BC.makeFull(src.db,meta);}
  else{name=incrName;obj=BC.makeIncr(base.state,src.db,Object.assign({baseStamp:base.stamp},meta));changes=BC.summarize(obj);}
  const text=await serialize(obj,src.encrypted,key);
  const same=backups.find(b=>b.name===name); // 同じ日の同じ種類があれば上書き
  const up=await drive.upload({name,parent:folder.id,text,id:same&&same.id});
  const want=utf8len(text);
  if(up.size!==undefined&&up.size!==null&&+up.size!==want)throw new BackupError("drive",`保存したファイルの大きさが合いません（送信 ${want} バイト／保存 ${up.size} バイト）。古いバックアップはそのまま残しています。`,{retryable:true});
  log(`保存しました：${name}（${want}バイト）${same?"［同じ日のファイルを上書き］":""}`);

  // 5. フルが保存できたときだけ、古いものをゴミ箱へ
  let trashed=0;
  if(type==="full"){
    for(const b of backups){
      if(b.id===up.id)continue;
      try{await drive.trash(b.id);trashed++;}
      catch(e){warnings.push(`古いバックアップ ${b.name} をゴミ箱へ移せませんでした（次のフルのときにやり直します）：${e.message}`);}
    }
    log(`古いバックアップ ${trashed}件をゴミ箱へ移しました`);
  }
  return{type,name,date:when.date,bytes:want,reason,changes,trashed,overwrote:!!same,warnings,rev:src.db.rev||0};
}

// 前回の状態（フル＋増分）を作り直す。作れなければ、その理由を返す
async function loadBase(drive,backups,key,todayIncrName){
  const fulls=backups.filter(b=>b.type==="full");
  if(fulls.length!==1)return{fail:fulls.length?`フルが${fulls.length}個あります`:"フルがまだありません"};
  let full;
  try{full=await readBackup(drive,fulls[0],key);}catch(e){return{fail:`${fulls[0].name} を読めません：${e.message}`};}
  if(!BC.isFull(full))return{fail:`${fulls[0].name} がフルの形式ではありません`};
  const incrs=[];
  for(const f of backups.filter(b=>b.type==="incr"&&b.name!==todayIncrName)){ // 今日の増分は、これから上書きするので土台に入れない
    let o;try{o=await readBackup(drive,f,key);}catch(e){return{fail:`${f.name} を読めません：${e.message}`};}
    if(BC.isIncr(o)&&o._backup.stamp>full._backup.stamp)incrs.push(o); // フルより古い増分（残り物）は使わない
  }
  try{const r=BC.restoreChain(full,incrs);return{state:r.state,stamp:r.last.stamp,count:r.count};}
  catch(e){return{fail:e.message};}
}
