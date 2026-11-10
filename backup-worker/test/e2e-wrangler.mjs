// wrangler dev（本物の Worker 実行環境）で、cron の入り口を実際に呼んで、模擬 Google の中のファイルを確認する "use strict";
import {spawn} from "node:child_process";
import fs from "node:fs";
import {startFakeGoogle} from "./fakegoogle.mjs";
import BC from "../../js/backupchain.js";
import {rng,makeDb,mutate,appKey,appEncrypt,appDecrypt} from "./helpers.mjs";

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const g=await startFakeGoogle({port:0});
const pw=await appKey("e2eパスワード0000",1000);
const r=rng(321);let db=makeDb(r);
const shared=g.add({name:"sharedFolder.json",text:await appEncrypt(JSON.stringify(db),pw,db.rev)});
const vars=[`GOOGLE_TOKEN_URL=${g.url}/token`,`GOOGLE_DRIVE_API=${g.url}/drive/v3`,`GOOGLE_UPLOAD_API=${g.url}/upload/drive/v3`,
  "GOOGLE_CLIENT_ID=cid","GOOGLE_CLIENT_SECRET=sec","GOOGLE_REFRESH_TOKEN=rt","DATA_KEY="+pw.dataKey].join("\n");
fs.writeFileSync(".dev.vars",vars);
const port=8799;
const p=spawn(process.platform==="win32"?"npx.cmd":"npx",["wrangler","dev","--test-scheduled","--port",String(port),"--ip","127.0.0.1","--local"],{stdio:["ignore","pipe","pipe"],shell:true});
let out="";p.stdout.on("data",d=>out+=d);p.stderr.on("data",d=>out+=d);
let ready=false;for(let i=0;i<120;i++){if(/Ready on/.test(out)){ready=true;break;}await sleep(500);}
if(!ready){console.log("wrangler dev が起動しませんでした\n"+out);p.kill();process.exit(1);}
const call=async(q)=>{const res=await fetch(`http://127.0.0.1:${port}/cdn-cgi/handler/scheduled${q}`);return[res.status,await res.text()];};
const results=[];
const check=(n,c,x)=>{results.push((c?"PASS ":"FAIL ")+n+(x!==undefined?" "+JSON.stringify(x):""));};
// 1) dry-run：何も保存されない
let [s,t]=await call("?cron=dry-run");
check("dry-run が動く（保存なし）",s===200&&g.live().length===1,[s,t.slice(0,60),g.live().length]);
// 2) 日曜(日本時間)に当たる時刻で通常実行 → フル。time は cron が動く時刻(UTC)
const sat=Date.parse("2026-11-07T16:00:00Z"); // 日本時間 2026-11-08(日) 1:00
[s,t]=await call("?time="+sat);
check("日曜1:00(日本時間)の実行でフルが作られる",s===200&&g.folderNames().join()==="フル_1108.json",[s,g.folderNames()]);
// 3) 月曜・火曜 → 増分
for(const d of ["2026-11-08T16:00:00Z","2026-11-09T16:00:00Z"]){
  db=mutate(db,r);shared.text=await appEncrypt(JSON.stringify(db),pw,db.rev);
  [s,t]=await call("?time="+Date.parse(d));
}
check("月・火は増分",g.folderNames().join()==="フル_1108.json,増分_1109.json,増分_1110.json",g.folderNames());
// 4) 暗号文のまま保存されている／復元が一致する
const fo=[...g.st.files.values()].find(f=>f.name==="バックアップ");
const files=g.live().filter(f=>f.parents.includes(fo.id));
check("バックアップは暗号化されたまま",files.every(f=>JSON.parse(f.text).format==="agri-ledger-enc"&&!f.text.includes("堆肥")));
const objs=[];for(const f of files)objs.push(await appDecrypt(f.text,"e2eパスワード0000"));
const {full,incrs}=BC.buildChain(objs);
check("フル＋増分の復元が、元データと一致",BC.same(BC.restoreChain(full,incrs).state,db));
// 5) 失敗時：トークンが失効 → 失敗（HTTP 500系）になり、ファイルは変わらない
g.st.badRefresh=true;
const before=g.folderNames().join();
[s,t]=await call("?time="+Date.parse("2026-11-10T16:00:00Z"));
check("ログイン切れのときは失敗として返る（ファイルは変わらない）",s>=500&&g.folderNames().join()===before,[s]);
console.log(results.join("\n"));
p.kill();try{spawn("taskkill",["/pid",String(p.pid),"/T","/F"],{shell:true});}catch(e){}
fs.rmSync(".dev.vars",{force:true});
await g.close();
process.exit(results.some(x=>x.startsWith("FAIL"))?1:0);