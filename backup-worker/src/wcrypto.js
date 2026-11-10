// 暗号化まわり（アプリの crypto.js と同じ形式：AES-256-GCM。パスワードそのものではなく、パスワードから作った鍵を受け取る） "use strict";
import {BackupError} from "./errors.js";

export const b64e=u8=>{let s="";for(let i=0;i<u8.length;i+=8192)s+=String.fromCharCode.apply(null,u8.subarray(i,i+8192));return btoa(s);};
export function b64d(s){ // 速く変換する（Workers の CPU 時間を節約）
  const bin=atob(s),u=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
  return u;
}
// アプリの暗号化ファイルの目印
export const isEnv=o=>!!o&&o.format==="agri-ledger-enc"&&!!o.data;

// 秘密情報 DATA_KEY（アプリの「自動バックアップ用の鍵を表示」で出す JSON）から、暗号化・復号に使う鍵を作る。未登録なら null
export async function loadKey(secret){
  if(!secret)return null;
  let o;
  try{o=JSON.parse(secret);}catch(e){throw new BackupError("config","秘密情報 DATA_KEY（鍵）の形式が正しくありません。アプリの「自動バックアップ用の鍵を表示」で出た文字列を、そのまま登録し直してください。");}
  if(!o||!o.key||!o.salt||!o.iter)throw new BackupError("config","秘密情報 DATA_KEY（鍵）の中身が足りません。アプリの「自動バックアップ用の鍵を表示」で出た文字列を、そのまま登録し直してください。");
  try{
    const key=await crypto.subtle.importKey("raw",b64d(o.key),{name:"AES-GCM"},false,["encrypt","decrypt"]);
    return{key,salt:o.salt,iter:o.iter};
  }catch(e){throw new BackupError("config","秘密情報 DATA_KEY（鍵）を読み込めません。登録し直してください。（"+(e.message||e)+"）");}
}
export async function decryptEnv(env,k){
  try{
    const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:b64d(env.iv)},k.key,b64d(env.data));
    return JSON.parse(new TextDecoder().decode(pt));
  }catch(e){throw new BackupError("config","暗号化ファイルを開けません（鍵が合っていないか、ファイルが壊れています）。アプリで鍵を表示し直して、DATA_KEY を登録し直してください。");}
}
export async function encryptEnv(text,k,rev){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},k.key,new TextEncoder().encode(text)));
  return JSON.stringify({format:"agri-ledger-enc",v:1,kdf:"PBKDF2-SHA256",iter:k.iter,salt:k.salt,iv:b64e(iv),rev:rev||0,data:b64e(ct)});
}