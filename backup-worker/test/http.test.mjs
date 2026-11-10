// 本物の通信コード（drive.js）を、Google を模した HTTP サーバーにつないで確認する "use strict";
import test from "node:test";
import assert from "node:assert/strict";
import BC from "../../js/backupchain.js";
import {createDrive} from "../src/drive.js";
import {runBackup} from "../src/run.js";
import {BackupError} from "../src/errors.js";
import {startFakeGoogle,FOLDER} from "./fakegoogle.mjs";
import {rng,makeDb,mutate,at,appKey,appEncrypt,appDecrypt} from "./helpers.mjs";

const NAME="sharedFolder.json";
const fast=env=>createDrive(env,{sleep:async()=>{},delays:[0,0,0]});
const baseEnv=(g,x={})=>Object.assign(g.env(),{DATA_FILE_NAME:NAME,BACKUP_FOLDER_NAME:"バックアップ",FULL_DAY:"0"},x);

test("HTTP：3日間（日曜フル→月・火の増分）を本物の通信コードで実行し、サーバー上のファイルから元に戻せる",async()=>{
  const g=await startFakeGoogle();
  try{
    const r=rng(77);let db=makeDb(r);
    const pw=await appKey("パスワード9999");
    const shared=g.add({name:NAME,text:await appEncrypt(JSON.stringify(db),pw,db.rev)});
    const env=baseEnv(g,{DATA_KEY:pw.dataKey}),drive=fast(env);
    for(const d of ["2026-11-08","2026-11-09","2026-11-10"]){
      db=mutate(db,r);shared.text=await appEncrypt(JSON.stringify(db),pw,db.rev);shared.modifiedTime=new Date().toISOString();
      const res=await runBackup(env,{scheduledTime:at(d),drive,now:()=>at(d)+1000});
      assert.equal(res.type,d==="2026-11-08"?"full":"incr");
    }
    assert.deepEqual(g.folderNames(),["フル_1108.json","増分_1109.json","増分_1110.json"]);
    // サーバー上のファイル（暗号文）から、アプリと同じ手順で復元
    const fo=[...g.st.files.values()].find(f=>f.mime===FOLDER);
    const objs=[];for(const f of g.live().filter(f=>f.parents.includes(fo.id)))objs.push(await appDecrypt(f.text,"パスワード9999"));
    const {full,incrs}=BC.buildChain(objs);
    assert.ok(BC.same(BC.restoreChain(full,incrs).state,db));
    assert.equal(g.st.tokens,1,"トークンは1回取れば使い回す");
    // 次の日曜：フルを取り、古い3つがゴミ箱へ
    db=mutate(db,r);shared.text=await appEncrypt(JSON.stringify(db),pw,db.rev);
    await runBackup(env,{scheduledTime:at("2026-11-15"),drive,now:()=>at("2026-11-15")+1000});
    assert.deepEqual(g.folderNames(),["フル_1115.json"]);
    assert.equal([...g.st.files.values()].filter(f=>f.trashed).length,3);
  }finally{await g.close();}
});

test("HTTP：名前に ' や日本語があっても検索できる／同名の上書き／日本語・記号を含む内容がそのまま往復する",async()=>{
  const g=await startFakeGoogle();
  try{
    const drive=fast(g.env());
    g.add({name:"O'Brien \\ 帳簿.json",text:"x"});
    const found=await drive.findFiles("O'Brien \\ 帳簿.json");
    assert.equal(found.length,1);
    const fo=await drive.ensureFolder("バックアップ");
    const text=JSON.stringify({a:"日本語 \"引用\" \\ バックスラッシュ \n 改行 --boundary-- \r\n--x",b:[1,2,3]});
    const up=await drive.upload({name:"フル_1108.json",parent:fo.id,text});
    assert.equal(await drive.download(up.id),text);
    const text2=JSON.stringify({z:"上書き"});
    const up2=await drive.upload({name:"フル_1108.json",parent:fo.id,text:text2,id:up.id});
    assert.equal(up2.id,up.id);assert.equal(await drive.download(up.id),text2);
    assert.equal((await drive.listFolder(fo.id)).length,1);
    assert.equal(+up2.size,Buffer.byteLength(text2));
    await drive.trash(up.id);
    assert.equal((await drive.listFolder(fo.id)).length,0);
    // フォルダは2回目以降、作らず見つける
    assert.equal((await drive.ensureFolder("バックアップ")).id,fo.id);
    assert.equal(await drive.ensureFolder("無いフォルダ",{create:false}),null);
  }finally{await g.close();}
});

test("HTTP：一時的な失敗（503・429）は自動でやり直して成功する。続けば transient で失敗",async()=>{
  const g=await startFakeGoogle();
  try{
    const drive=fast(g.env());
    g.add({name:NAME,text:"{}"});
    g.st.fail.push({path:/\/drive\/v3\/files$/,n:2,code:503});
    assert.equal((await drive.findFiles(NAME)).length,1);
    g.st.fail.push({path:/\/drive\/v3\/files$/,n:1,code:429});
    assert.equal((await drive.findFiles(NAME)).length,1);
    g.st.fail.push({path:/\/drive\/v3\/files$/,n:99,code:500});
    await assert.rejects(()=>drive.findFiles(NAME),e=>e instanceof BackupError&&e.code==="transient"&&e.retryable);
  }finally{await g.close();}
});

test("HTTP：ログイン切れ（invalid_grant）は、やり直さずに auth エラー。「本番環境」の案内が出る",async()=>{
  const g=await startFakeGoogle();
  try{
    g.st.badRefresh=true;
    const drive=fast(g.env());
    await assert.rejects(()=>drive.findFiles(NAME),e=>e.code==="auth"&&/本番環境/.test(e.message)&&!e.retryable);
    assert.equal(g.st.log.filter(l=>l==="POST /token").length,1,"やり直していない");
  }finally{await g.close();}
});

test("HTTP：API の途中でトークンが切れて 401 になったら、1回だけ取り直して続ける",async()=>{
  const g=await startFakeGoogle();
  try{
    const drive=fast(g.env());g.add({name:NAME,text:"{}"});
    await drive.findFiles(NAME);
    g.st.validToken="expired-on-server"; // サーバー側でトークンを無効にする
    assert.equal((await drive.findFiles(NAME)).length,1);
    assert.equal(g.st.tokens,2);
  }finally{await g.close();}
});

test("HTTP：秘密情報が足りない／クライアントが違う／Drive API が無効 → わかりやすい設定エラー",async()=>{
  const g=await startFakeGoogle();
  try{
    const env=g.env();delete env.GOOGLE_REFRESH_TOKEN;
    await assert.rejects(()=>fast(env).findFiles(NAME),e=>e.code==="config"&&/GOOGLE_REFRESH_TOKEN/.test(e.message));
    await assert.rejects(()=>fast({...g.env(),GOOGLE_CLIENT_ID:"wrong"}).findFiles(NAME),e=>e.code==="config"&&/クライアントID/.test(e.message));
    g.st.driveDisabled=true;
    await assert.rejects(()=>fast(g.env()).findFiles(NAME),e=>e.code==="config"&&/Drive API が有効/.test(e.message));
  }finally{await g.close();}
});