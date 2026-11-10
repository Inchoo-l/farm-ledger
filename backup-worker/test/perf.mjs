// CPU時間の目安（高精度の時計で測る）：土曜の増分＝フル＋増分5件を読み直す、いちばん重い日。引数：記録の追加件数 暗号化(0/1) 繰り返し回数
import {runBackup} from "../src/run.js";
import {rng,makeDb,mutate,at,addDays,appKey,appEncrypt,FakeDrive} from "./helpers.mjs";
const [extra,pwOn,reps]=process.argv.slice(2).map(Number);
const r=rng(5),db0=makeDb(r);
for(let i=0;i<extra;i++)db0.expenses.push({id:db0.seq++,date:"2026-05-01",category:"肥料費",desc:"品名"+i,vendor:"取引先"+(i%20),amount:i*13,note:"メモ".repeat(4),div:"田",accountId:1,invoice:i%2===0});
const pw=pwOn?await appKey("ぱすわーど1234",1000):null;
const env={DATA_FILE_NAME:"x.json",...(pw?{DATA_KEY:pw.dataKey}:{})};
const drive=new FakeDrive();let db=db0;
const put=async()=>{const text=pw?await appEncrypt(JSON.stringify(db),pw,db.rev):JSON.stringify(db);const c=drive.live().find(f=>f.name==="x.json");if(c)c.text=text;else drive.put("x.json",text);};
let day="2026-11-08";
for(let i=0;i<6;i++,day=addDays(day,1)){db=mutate(db,r);await put();await runBackup(env,{scheduledTime:at(day),drive,now:()=>at(day)+1000,log:()=>{}});} // 日〜金
db=mutate(db,r);await put(); // 土曜ぶんのデータ
const times=[];
for(let k=0;k<reps;k++){
  const t0=performance.now();
  await runBackup(env,{scheduledTime:at(day),drive,now:()=>at(day)+1000+k,log:()=>{}});
  times.push(performance.now()-t0);
}
const kb=Math.round(JSON.stringify(db).length/1024);
console.log(`データ約${kb}KB／暗号化${pwOn?"あり":"なし"}／最初の1回(冷えた状態)=${times[0].toFixed(1)}ms／2回目以降の平均=${(times.slice(1).reduce((a,b)=>a+b,0)/Math.max(1,times.length-1)).toFixed(1)}ms`);