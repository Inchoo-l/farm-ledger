// バックアップ本体（run.js／index.js）の検証：ドライブのかわり（メモリ）で、毎日の実行を何週間も再現する "use strict";
import test from "node:test";
import assert from "node:assert/strict";
import BC from "../../js/backupchain.js";
import {runBackup,jstParts} from "../src/run.js";
import {job} from "../src/index.js";
import {BackupError} from "../src/errors.js";
import {isEnv} from "../src/wcrypto.js";
import {rng,makeDb,mutate,at,addDays,mmddOf,appKey,appEncrypt,appDecrypt,deriveFor,FakeDrive,restoreFolder} from "./helpers.mjs";

const NAME="sharedFolder.json";
const baseEnv=(x={})=>Object.assign({DATA_FILE_NAME:NAME,BACKUP_FOLDER_NAME:"バックアップ",FULL_DAY:"0"},x);
const logs=[];
const run=(env,drive,ymd,mode="auto")=>runBackup(env,{scheduledTime:at(ymd),mode,drive,now:()=>at(ymd)+5000,log:m=>logs.push(m)});
async function writeShared(drive,db,pw){ // アプリが共有ファイルを書くのと同じ（暗号化ありなら暗号化して）
  const text=pw?await appEncrypt(JSON.stringify(db),pw,db.rev):JSON.stringify(db);
  const cur=drive.live().find(f=>f.name===NAME);
  if(cur){cur.text=text;cur.modifiedTime=drive.tick();}else drive.put(NAME,text);
}
const strip=BC.strip;

test("日本時間の月日・曜日の判定（cron は UTC 16:00＝日本時間の翌日 1:00）",()=>{
  // 2026-11-08 は日曜。cron は 土曜(UTC) 16:00 に動く
  assert.deepEqual(jstParts(Date.parse("2026-11-07T16:00:00Z")),{date:"2026-11-08",mmdd:"1108",dow:0});
  assert.equal(jstParts(Date.parse("2026-11-08T16:00:00Z")).dow,1); // 月曜
  assert.equal(jstParts(Date.parse("2026-12-31T16:00:00Z")).date,"2027-01-01"); // 年またぎ
  assert.equal(jstParts(at("2026-11-08")).dow,0);
});

for(const withPw of [false,true]){
  test(`3週間、毎日実行（${withPw?"パスワード暗号化あり":"暗号化なし"}）：フォルダは常に「フル1個＋次のフルまでの増分」で、復元が毎回元と一致する`,async()=>{
    const r=rng(2026),drive=new FakeDrive();
    const pw=withPw?await appKey("ひみつのパスワード123"):null;
    const env=baseEnv(pw?{DATA_KEY:pw.dataKey}:{});
    let db=makeDb(r);
    let day="2026-11-01"; // 日曜
    for(let i=0;i<21;i++,day=addDays(day,1)){
      db=mutate(db,r);await writeShared(drive,db,pw);
      const res=await run(env,drive,day);
      const dow=new Date(day+"T00:00:00Z").getUTCDay();
      assert.equal(res.type,dow===0?"full":"incr",day+" 日曜だけフル");
      // フォルダの中身：フルは1個だけ。増分は、そのフルより後の日だけ
      const names=drive.folderNames();
      const fulls=names.filter(n=>n.startsWith("フル_")),incs=names.filter(n=>n.startsWith("増分_"));
      assert.equal(fulls.length,1,day+" フルは1個だけ");
      const fullDay=addDays(day,-dow);
      assert.equal(fulls[0],`フル_${mmddOf(fullDay)}.json`);
      const expectIncs=[];for(let k=1;k<=dow;k++)expectIncs.push(`増分_${mmddOf(addDays(fullDay,k))}.json`);
      assert.deepEqual(incs.sort(),expectIncs.sort(),day+" 増分は次のフルまで");
      assert.ok(names.every(n=>/^(フル|増分)_\d{4}\.json$/.test(n)),"ファイル名の形");
      // 復元（フル→増分を順に）が、今のデータと一致する
      const back=await restoreFolder(drive,pw?"ひみつのパスワード123":null);
      assert.ok(BC.same(back,db),day+" 復元が一致しません");
      if(pw){ // 暗号化したまま保存され、中身の言葉は見えない
        for(const f of drive.inFolder()){assert.ok(isEnv(JSON.parse(f.text)));assert.ok(!f.text.includes("堆肥"));assert.ok(!f.text.includes("秘密のメモ"));}
      }
    }
    // ゴミ箱に移された古いバックアップがある（日曜ごとに整理）
    assert.ok([...drive.files.values()].some(f=>f.trashed&&/^(フル|増分)_/.test(f.name)));
  });
}

test("同じ日にもう一度実行しても、ファイルは増えず上書きされる（増分もフルも）",async()=>{
  const r=rng(1),drive=new FakeDrive(),env=baseEnv();let db=makeDb(r);
  await writeShared(drive,db);await run(env,drive,"2026-11-08");            // 日曜：フル
  db=mutate(db,r);await writeShared(drive,db);await run(env,drive,"2026-11-09"); // 月曜：増分
  const before=drive.inFolder().map(f=>[f.name,f.id]);
  db=mutate(db,r);await writeShared(drive,db);
  const again=await run(env,drive,"2026-11-09");                                  // 同じ日にもう一度
  assert.equal(again.overwrote,true);
  assert.deepEqual(drive.inFolder().map(f=>[f.name,f.id]),before,"ファイルも id も増えていない");
  assert.ok(BC.same(await restoreFolder(drive),db),"上書き後の復元が最新と一致");
  // フルの上書き
  db=mutate(db,r);await writeShared(drive,db);
  const f1=await run(env,drive,"2026-11-09","force-full");                       // 月曜に手動でフル
  const f2=await run(env,drive,"2026-11-09","force-full");                       // もう一度
  assert.equal(f2.overwrote,true);
  assert.deepEqual(drive.folderNames(),["フル_1109.json"],"フルを取ると、古いフルと増分は整理される");
  assert.ok(BC.same(await restoreFolder(drive),db));
  // その後の増分は、新しいフルにつながる
  db=mutate(db,r);await writeShared(drive,db);await run(env,drive,"2026-11-10");
  assert.deepEqual(drive.folderNames().sort(),["フル_1109.json","増分_1110.json"]);
  assert.ok(BC.same(await restoreFolder(drive),db));
});

test("フルの保存に失敗したら、古いフルと増分は残る（ゴミ箱に移さない）。直ったら次で成功",async()=>{
  const r=rng(3),drive=new FakeDrive(),env=baseEnv();let db=makeDb(r);
  for(const d of ["2026-11-08","2026-11-09","2026-11-10"]){db=mutate(db,r);await writeShared(drive,db);await run(env,drive,d);}
  const before=drive.folderNames().sort();
  db=mutate(db,r);await writeShared(drive,db);
  drive.fail.upload={n:1,err:new BackupError("drive","保存できません")};
  await assert.rejects(()=>run(env,drive,"2026-11-15"),/保存できません/); // 日曜のフルで失敗
  assert.deepEqual(drive.folderNames().sort(),before,"古いものは1つも消えていない");
  assert.ok(![...drive.files.values()].some(f=>f.trashed),"ゴミ箱に移していない");
  await run(env,drive,"2026-11-15");
  assert.deepEqual(drive.folderNames(),["フル_1115.json"]);
  assert.ok(BC.same(await restoreFolder(drive),db));
});

test("保存したファイルの大きさが合わなければ失敗し、古いものを残す",async()=>{
  const r=rng(4),drive=new FakeDrive(),env=baseEnv();let db=makeDb(r);
  await writeShared(drive,db);await run(env,drive,"2026-11-01");
  const before=drive.folderNames();
  drive.sizeLie=true;
  await assert.rejects(()=>run(env,drive,"2026-11-08"),/大きさが合いません/);
  assert.ok(drive.folderNames().includes(before[0]),"古いフルは残る");
  assert.ok(![...drive.files.values()].some(f=>f.trashed));
});

test("ゴミ箱への移動に失敗しても、バックアップは成功扱い（注意だけ出す）。次のフルで整理される",async()=>{
  const r=rng(5),drive=new FakeDrive(),env=baseEnv();let db=makeDb(r);
  for(const d of ["2026-11-08","2026-11-09"]){db=mutate(db,r);await writeShared(drive,db);await run(env,drive,d);}
  db=mutate(db,r);await writeShared(drive,db);
  drive.fail.trash={n:1,err:new Error("一時的な失敗")};
  const res=await run(env,drive,"2026-11-15");
  assert.equal(res.type,"full");assert.ok(res.warnings.some(w=>/ゴミ箱へ移せません/.test(w)));
  assert.equal(drive.folderNames().filter(n=>n.startsWith("フル_")).length,2,"古いフルが1つ残っている");
  // 月曜の増分：フルが2個あるので、フルを取り直して整理する（自己修復）
  db=mutate(db,r);await writeShared(drive,db);
  const heal=await run(env,drive,"2026-11-16");
  assert.equal(heal.type,"full");assert.deepEqual(drive.folderNames(),["フル_1116.json"]);
  assert.ok(BC.same(await restoreFolder(drive),db));
});

test("増分が1つ抜けて鎖が切れたら、増分ではなくフルを取り直す（自己修復）",async()=>{
  const r=rng(6),drive=new FakeDrive(),env=baseEnv();let db=makeDb(r);
  for(const d of ["2026-11-08","2026-11-09","2026-11-10","2026-11-11"]){db=mutate(db,r);await writeShared(drive,db);await run(env,drive,d);}
  const mid=drive.inFolder().find(f=>f.name==="増分_1110.json");mid.trashed=true; // 誰かが間の増分を消した
  db=mutate(db,r);await writeShared(drive,db);
  const res=await run(env,drive,"2026-11-12");
  assert.equal(res.type,"full");assert.ok(res.warnings.some(w=>/増分が足りません|そろっていなかった/.test(w)),res.warnings.join("|"));
  assert.deepEqual(drive.folderNames(),["フル_1112.json"]);
  assert.ok(BC.same(await restoreFolder(drive),db));
});

test("初めての実行が日曜以外でも、まずフルを取る",async()=>{
  const r=rng(8),drive=new FakeDrive(),env=baseEnv();const db=makeDb(r);
  await writeShared(drive,db);
  const res=await run(env,drive,"2026-11-11"); // 水曜
  assert.equal(res.type,"full");assert.deepEqual(drive.folderNames(),["フル_1111.json"]);
});

test("フルの曜日を変える（FULL_DAY=3 → 水曜）",async()=>{
  const r=rng(9),drive=new FakeDrive(),env=baseEnv({FULL_DAY:"3"});let db=makeDb(r);
  await writeShared(drive,db);
  assert.equal((await run(env,drive,"2026-11-11")).type,"full"); // 水
  db=mutate(db,r);await writeShared(drive,db);
  assert.equal((await run(env,drive,"2026-11-12")).type,"incr"); // 木
  db=mutate(db,r);await writeShared(drive,db);
  assert.equal((await run(env,drive,"2026-11-15")).type,"incr"); // 日（FULL_DAY=3 なのでフルではない）
});

test("dry-run：何も保存・作成・削除しない（計画だけ）",async()=>{
  const r=rng(10),drive=new FakeDrive(),env=baseEnv();const db=makeDb(r);
  await writeShared(drive,db);
  const res=await run(env,drive,"2026-11-08","dry-run");
  assert.equal(res.dryRun,true);assert.equal(res.type,"full");
  assert.equal(drive.live().length,1,"共有ファイルだけ。フォルダも作っていない");
});

test("変更がない日の増分は、とても小さい",async()=>{
  const r=rng(11),drive=new FakeDrive(),env=baseEnv();const db=makeDb(r);
  await writeShared(drive,db);await run(env,drive,"2026-11-08");
  const res=await run(env,drive,"2026-11-09");
  assert.deepEqual(res.changes,{changed:0,deleted:0,keys:0});
  assert.ok(res.bytes<600,"空の増分は小さい："+res.bytes);
});

test("エラー：共有ファイルが無い／暗号化なのに鍵が無い／パスワードが変わった／鍵の形式が違う → 何も変更せず、わかりやすく失敗",async()=>{
  const r=rng(12),db=makeDb(r);
  // 共有ファイルが無い
  let drive=new FakeDrive();
  await assert.rejects(()=>run(baseEnv(),drive,"2026-11-08"),e=>e.code==="notfound"&&/見つかりません/.test(e.message));
  // 暗号化されているのに鍵が未登録
  const k1=await appKey("パスワードA1234");drive=new FakeDrive();await writeShared(drive,db,k1);
  await assert.rejects(()=>run(baseEnv(),drive,"2026-11-08"),e=>e.code==="config"&&/DATA_KEY/.test(e.message));
  // パスワードが変わった（別の鍵）
  const k2=await appKey("パスワードB5678");
  await assert.rejects(()=>run(baseEnv({DATA_KEY:k2.dataKey}),drive,"2026-11-08"),e=>e.code==="config"&&/パスワードが変わって/.test(e.message));
  // 鍵の形式が違う
  await assert.rejects(()=>run(baseEnv({DATA_KEY:"これは鍵ではない"}),drive,"2026-11-08"),e=>e.code==="config"&&/形式が正しくありません/.test(e.message));
  // どの場合も、フォルダは作られず、何も書かれていない
  assert.equal(drive.live().length,1);
  // 共有ファイルの中身が壊れている／空
  drive=new FakeDrive();drive.put(NAME,"{ こわれた");
  await assert.rejects(()=>run(baseEnv(),drive,"2026-11-08"),e=>e.code==="data"&&e.retryable);
  drive=new FakeDrive();drive.put(NAME,"");
  await assert.rejects(()=>run(baseEnv(),drive,"2026-11-08"),e=>e.code==="data");
  drive=new FakeDrive();drive.put(NAME,JSON.stringify({hello:1}));
  await assert.rejects(()=>run(baseEnv(),drive,"2026-11-08"),/帳簿データではありません/);
});

test("job：一時的な失敗は待ってやり直し、それでもだめなら ntfy で知らせる",async()=>{
  const r=rng(13),drive=new FakeDrive(),db=makeDb(r);await writeShared(drive,db);
  const sent=[],waits=[];
  const deps={drive,notify:async m=>{sent.push(m);},sleep:async ms=>{waits.push(ms);},now:()=>at("2026-11-08")+5000};
  // 1回だけ失敗 → やり直して成功。成功通知（フル）が1件
  drive.fail.upload={n:1,err:new BackupError("transient","一時的な失敗")};
  const ok=await job({cron:"0 16 * * *",scheduledTime:at("2026-11-08")},baseEnv(),deps);
  assert.equal(ok.type,"full");assert.deepEqual(waits,[60e3]);
  assert.equal(sent.length,1);assert.match(sent[0].title,/フルバックアップ完了/);
  // ずっと失敗 → 3回目で諦めて通知（優先度4）して例外
  sent.length=0;waits.length=0;
  drive.fail.upload={n:99,err:new BackupError("transient","つながりません")};
  await assert.rejects(()=>job({cron:"0 16 * * *",scheduledTime:at("2026-11-15")},baseEnv(),deps),/つながりません/);
  assert.deepEqual(waits,[60e3,180e3]);
  assert.equal(sent.length,1);assert.match(sent[0].title,/失敗/);assert.equal(sent[0].priority,4);assert.match(sent[0].message,/つながりません/);
  // 設定の問題は、待たずにすぐ通知
  sent.length=0;waits.length=0;drive.fail.upload=null;
  const d2=new FakeDrive();
  await assert.rejects(()=>job({cron:"0 16 * * *",scheduledTime:at("2026-11-08")},baseEnv(),{...deps,drive:d2}),e=>e.code==="notfound");
  assert.deepEqual(waits,[]);assert.equal(sent.length,1);assert.match(sent[0].message,/アプリで Google ドライブに接続/);
});

test("job：成功通知の設定（full＝フルの日だけ／none／all）と、注意の通知",async()=>{
  const r=rng(14);
  for(const [pol,expectFull,expectIncr] of [["full",1,0],["all",1,1],["none",0,0]]){
    const drive=new FakeDrive(),db=makeDb(r);await writeShared(drive,db);
    const sent=[];const deps={drive,notify:async m=>sent.push(m),sleep:async()=>{},now:()=>at("2026-11-08")+5000};
    const env=baseEnv({NOTIFY_ON_SUCCESS:pol});
    await job({scheduledTime:at("2026-11-08")},env,deps);
    assert.equal(sent.length,expectFull,pol+" フル");
    sent.length=0;
    await job({scheduledTime:at("2026-11-09")},env,{...deps,now:()=>at("2026-11-09")+5000});
    assert.equal(sent.length,expectIncr,pol+" 増分");
  }
  // 手動の dry-run は成功通知を出さない
  const drive=new FakeDrive();await writeShared(drive,makeDb(r));const sent=[];
  await job({cron:"dry-run",scheduledTime:at("2026-11-08")},baseEnv({NOTIFY_ON_SUCCESS:"all"}),{drive,notify:async m=>sent.push(m),sleep:async()=>{},now:()=>at("2026-11-08")});
  assert.equal(sent.length,0);
});

test("古いパスワードで暗号化された古いバックアップが残っていても、新しい鍵でフルを取り直せる",async()=>{
  const r=rng(15),drive=new FakeDrive();let db=makeDb(r);
  const k1=await appKey("むかしのパス1111");
  await writeShared(drive,db,k1);await run(baseEnv({DATA_KEY:k1.dataKey}),drive,"2026-11-08");
  // パスワードを変えて、共有ファイルを新しい鍵で書き直す
  const k2=await appKey("あたらしいパス2222");db=mutate(db,r);await writeShared(drive,db,k2);
  const res=await run(baseEnv({DATA_KEY:k2.dataKey}),drive,"2026-11-09");
  assert.equal(res.type,"full");assert.ok(res.warnings.length>0);
  assert.deepEqual(drive.folderNames(),["フル_1109.json"]);
  assert.ok(BC.same(await restoreFolder(drive,"あたらしいパス2222"),db));
});