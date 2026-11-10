#!/usr/bin/env node
// 復元コマンド：ダウンロードしたバックアップ（フル＋増分）のフォルダから、元のデータを作る "use strict";
/* 使い方：
     node tools/restore.mjs <バックアップのファイルが入ったフォルダ> [出力するファイル名]
   例：
     node tools/restore.mjs C:\Users\you\Downloads\バックアップ restored.json
   ・出力されたファイルは、アプリの「💾 バックアップ」→「復元する」でそのまま読み込めます
   ・パスワードで暗号化されているときは、実行中にパスワードを聞きます（入力は画面に出ません）。
     聞かれたくないときは、環境変数 RESTORE_PASSWORD に入れておいてください
   ・フルが1個と、それにつながる増分がそろっていれば復元できます。増分が足りないときは、どこが足りないかを表示して止まります */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import BC from "../../js/backupchain.js";

const b64d=s=>Uint8Array.from(Buffer.from(s,"base64"));
const isEnv=o=>!!o&&o.format==="agri-ledger-enc"&&!!o.data;

function askHidden(q){ // 入力を画面に出さずにパスワードを聞く
  return new Promise(res=>{
    const rl=readline.createInterface({input:process.stdin,output:process.stdout,terminal:true});
    const w=rl._writeToOutput;let asked=false;
    rl._writeToOutput=function(s){if(!asked){w.call(rl,s);}else if(s.includes("\n")||s.includes("\r"))w.call(rl,"\n");};
    rl.question(q,a=>{rl.close();res(a);});asked=true;
  });
}
async function keyFor(env,pw){
  const base=await crypto.subtle.importKey("raw",new TextEncoder().encode(pw),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",salt:b64d(env.salt),iterations:env.iter,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["decrypt"]);
}
async function open(env,key){
  try{return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:b64d(env.iv)},key,b64d(env.data))));}
  catch(e){const x=new Error("パスワードが違うか、ファイルが壊れています");x.badPw=true;throw x;}
}

async function main(){
  const [dir,out]=process.argv.slice(2);
  if(!dir){console.error("使い方：node tools/restore.mjs <バックアップのファイルが入ったフォルダ> [出力するファイル名]");process.exit(2);}
  const names=fs.readdirSync(dir).filter(n=>/\.json$/i.test(n)).sort();
  if(!names.length){console.error("フォルダに .json のファイルがありません："+dir);process.exit(2);}
  const keys={},objs=[];
  for(const n of names){
    let o;
    try{o=JSON.parse(fs.readFileSync(path.join(dir,n),"utf8"));}catch(e){console.error(`「${n}」は読めないファイルです（JSONではありません）。飛ばします`);continue;}
    if(isEnv(o)){
      if(!keys[o.salt]){
        let pw=process.env.RESTORE_PASSWORD;
        for(let t=0;t<3;t++){
          if(!pw)pw=await askHidden("パスワードを入力してください（暗号化されています）：");
          try{const k=await keyFor(o,pw);o=await open(o,k);keys[o.salt]=k;break;}
          catch(e){if(!e.badPw)throw e;console.error("パスワードが違います。");pw="";if(t===2){console.error("3回間違えたので終了します。");process.exit(1);}}
        }
        if(isEnv(o)){continue;}
      }else o=await open(o,keys[o.salt]);
    }
    objs.push(o);
  }
  const {full,incrs}=BC.buildChain(objs);
  const res=BC.restoreChain(full,incrs);
  const file=out||`agri-restore-${res.last.date}.json`;
  fs.writeFileSync(file,JSON.stringify(res.state,null,1));
  console.log(`復元しました：フルバックアップ（${full._backup.date}）＋増分${res.count}件 → ${res.last.date} の状態`);
  console.log(`書き出したファイル：${path.resolve(file)}`);
  console.log("アプリの「💾 バックアップ」→「復元する」で、このファイルを選んでください。");
}
main().catch(e=>{console.error("復元できませんでした：\n"+(e&&e.message||e));process.exit(1);});