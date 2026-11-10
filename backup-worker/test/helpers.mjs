// テスト用の道具：ドライブのかわり（メモリ上）、アプリと同じ暗号化、日付の計算 "use strict";
import BC from "../../js/backupchain.js";
import {b64e,b64d,isEnv} from "../src/wcrypto.js";

// 乱数（種を固定）
export function rng(seed){return()=>{seed=(seed*1664525+1013904223)%4294967296;return seed/4294967296;};}
export function makeDb(r){
  const db={fields:[],plantings:[],expenses:[],sales:[],assets:[],accounts:[],plots:[],settings:{deduction:650000},yearly:{},cropColors:{},lastBackup:null,seq:1,rev:1};
  for(let i=0;i<4;i++)db.fields.push({id:db.seq++,name:"圃場"+i,area:Math.round(r()*100),div:i%2?"田":"畑"});
  for(let i=0;i<30;i++)db.expenses.push({id:db.seq++,date:"2026-05-1"+Math.floor(r()*9),category:"肥料費",desc:"堆肥"+i,vendor:"JA",amount:Math.round(r()*1e5),div:"田",note:"秘密のメモ"+i});
  for(let i=0;i<10;i++)db.sales.push({id:db.seq++,date:"2026-10-0"+(1+Math.floor(r()*9)),kind:"出荷売上（JA等）",amount:Math.round(r()*1e5),div:"畑"});
  db.accounts.push({id:db.seq++,name:"JA普通",balance:1000});
  return db;
}
export function mutate(db,r){
  const d=BC.clone(db);d.rev=(d.rev||0)+1;
  const n=1+Math.floor(r()*5);
  for(let k=0;k<n;k++){
    const x=r();
    if(x<0.35)d.expenses.push({id:d.seq++,date:"2026-11-0"+(1+Math.floor(r()*9)),category:"雑費",desc:"新規"+d.seq,amount:Math.round(r()*1e4),div:"畑"});
    else if(x<0.6&&d.expenses.length){const e=d.expenses[Math.floor(r()*d.expenses.length)];e.amount=Math.round(r()*1e5);}
    else if(x<0.75&&d.expenses.length){d.expenses.splice(Math.floor(r()*d.expenses.length),1);}
    else if(x<0.85){d.settings={...d.settings,deduction:[650000,550000,100000][Math.floor(r()*3)]};}
    else if(x<0.92){d.cropColors={...d.cropColors,["作物"+Math.floor(r()*4)]:"#123456"};}
    else d.plantings.push({id:d.seq++,year:2026,fieldId:d.fields[0].id,variety:"ネギ"+d.seq,div:"畑"});
  }
  d.lastBackup="2026-11-0"+(1+Math.floor(r()*9));
  return d;
}

// 日本時間の「その日の1:00」＝ cron が動く時刻（UTC 前日 16:00）
export const at=ymd=>Date.parse(ymd+"T01:00:00+09:00");
export const addDays=(ymd,n)=>{const d=new Date(Date.parse(ymd+"T00:00:00Z")+n*864e5);return d.toISOString().slice(0,10);};
export const mmddOf=ymd=>ymd.slice(5,7)+ymd.slice(8,10);

// アプリ（crypto.js）と同じ暗号化：パスワード → PBKDF2(SHA-256) → AES-GCM
export async function appKey(pw,iter=1000){ // テストは速さのため反復回数を小さくする（本番は60万回。仕組みは同じ）
  const salt=crypto.getRandomValues(new Uint8Array(16));
  return deriveFor(pw,b64e(salt),iter);
}
export async function deriveFor(pw,saltB64,iter){
  const base=await crypto.subtle.importKey("raw",new TextEncoder().encode(pw),"PBKDF2",false,["deriveKey"]);
  const key=await crypto.subtle.deriveKey({name:"PBKDF2",salt:b64d(saltB64),iterations:iter,hash:"SHA-256"},base,{name:"AES-GCM",length:256},true,["encrypt","decrypt"]);
  const raw=new Uint8Array(await crypto.subtle.exportKey("raw",key));
  return{key,salt:saltB64,iter,dataKey:JSON.stringify({v:1,salt:saltB64,iter,key:b64e(raw)})}; // dataKey ＝ アプリが表示する「自動バックアップ用の鍵」
}
export async function appEncrypt(text,k,rev){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},k.key,new TextEncoder().encode(text)));
  return JSON.stringify({format:"agri-ledger-enc",v:1,kdf:"PBKDF2-SHA256",iter:k.iter,salt:k.salt,iv:b64e(iv),rev:rev||0,data:b64e(ct)});
}
export async function appDecrypt(text,pw){
  const env=JSON.parse(text);if(!isEnv(env))return env;
  const k=await deriveFor(pw,env.salt,env.iter);
  const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:b64d(env.iv)},k.key,b64d(env.data));
  return JSON.parse(new TextDecoder().decode(pt));
}

// メモリ上のドライブ（drive.js と同じ使い方）
export class FakeDrive{
  constructor(){this.files=new Map();this.seq=1;this.clock=Date.parse("2026-11-01T00:00:00Z");this.fail={};this.calls=[];this.sizeLie=false;}
  tick(){this.clock+=1000;return new Date(this.clock).toISOString();}
  put(name,text,{parent=null,mime="application/json"}={}){const id="f"+this.seq++;this.files.set(id,{id,name,parent,text,mime,trashed:false,modifiedTime:this.tick()});return this.files.get(id);}
  live(){return [...this.files.values()].filter(f=>!f.trashed);}
  inFolder(){const fo=this.live().find(f=>f.mime==="folder");return fo?this.live().filter(f=>f.parent===fo.id).sort((a,b)=>a.name<b.name?-1:1):[];}
  folderNames(){return this.inFolder().map(f=>f.name);}
  hit(op){this.calls.push(op);const f=this.fail[op];if(f&&f.n>0){f.n--;throw f.err;}}
  async findFiles(name){this.hit("findFiles");return this.live().filter(f=>f.name===name&&f.mime!=="folder").sort((a,b)=>a.modifiedTime<b.modifiedTime?1:-1).map(f=>({id:f.id,name:f.name,modifiedTime:f.modifiedTime,size:String(f.text.length)}));}
  async ensureFolder(name,{create=true}={}){this.hit("ensureFolder");let f=this.live().find(x=>x.name===name&&x.mime==="folder");if(!f&&create)f=this.put(name,"",{mime:"folder"});return f?{id:f.id,name:f.name}:null;}
  async listFolder(id){this.hit("listFolder");return this.live().filter(f=>f.parent===id).map(f=>({id:f.id,name:f.name,modifiedTime:f.modifiedTime,size:String(new TextEncoder().encode(f.text).length)}));}
  async download(id){this.hit("download");const f=this.files.get(id);if(!f||f.trashed)throw new Error("ファイルがありません");return f.text;}
  async upload({name,parent,text,id}){
    this.hit("upload");
    let f;
    if(id){f=this.files.get(id);f.text=text;f.modifiedTime=this.tick();}
    else f=this.put(name,text,{parent});
    const size=new TextEncoder().encode(text).length;
    return{id:f.id,name:f.name,size:String(this.sizeLie?size+1:size)};
  }
  async trash(id){this.hit("trash");this.files.get(id).trashed=true;}
}
// フォルダの中のバックアップを、アプリと同じ手順で読み、元の状態に戻す（パスワードがあれば復号）
export async function restoreFolder(drive,pw){
  const objs=[];
  for(const f of drive.inFolder())objs.push(await appDecrypt(f.text,pw));
  const {full,incrs}=BC.buildChain(objs);
  return BC.restoreChain(full,incrs).state;
}