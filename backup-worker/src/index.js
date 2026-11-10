// Cloudflare Worker の入り口：毎日、日本時間の深夜1:00（UTC 16:00）に動く "use strict";
/* cron：「0 16 * * *」（UTC 16:00 ＝ 日本時間 翌日 1:00）。曜日の判定は cron ではなく run.js の中で日本時間に直して行う。
   手動で試すとき（wrangler dev --test-scheduled）は、cron の名前を変えて呼ぶ：
     /cdn-cgi/handler/scheduled?cron=dry-run     … 保存せず、何をするかだけ確認
     /cdn-cgi/handler/scheduled?cron=force-full  … フルを取る
     /cdn-cgi/handler/scheduled?cron=force-incr  … 増分を取る（フルが無ければフル）
     /cdn-cgi/handler/scheduled                  … ふだんと同じ（曜日で決まる）
   失敗したら、少し待って自動でやり直し、それでもだめなら ntfy で知らせる。 */
import {runBackup} from "./run.js";
import {createDrive} from "./drive.js";
import {notify} from "./notify.js";
import {BackupError} from "./errors.js";

const MODES={"dry-run":"dry-run","force-full":"force-full","force-incr":"force-incr"};
const RETRY_WAIT=[60e3,180e3]; // 全体をやり直す前に待つ時間（一時的な失敗のときだけ）

// 失敗の通知に付ける「どうすればよいか」
function hint(e){
  switch(e&&e.code){
    case "auth":return "\n→ 設定手順書の「Google の許可を取り直す」をやってください。";
    case "config":return "\n→ 設定手順書で、該当の設定をやり直してください。";
    case "notfound":return "\n→ アプリで Google ドライブに接続できているか確認してください。";
    default:return "\n→ 数時間後に自動でやり直します。続くようなら、Cloudflare のログを確認してください。";
  }
}

export async function job(event,env,deps={}){
  const mode=MODES[event.cron]||"auto";
  const drive=deps.drive||createDrive(env);
  const nf=deps.notify||(m=>notify(env,m));
  const sleep=deps.sleep||(ms=>new Promise(r=>setTimeout(r,ms)));
  const log=m=>console.log("[backup] "+m);
  let attempt=0;
  for(;;){
    try{
      const r=await runBackup(env,{scheduledTime:event.scheduledTime||Date.now(),mode,drive,now:deps.now||(()=>Date.now()),log});
      console.log("[backup] 結果 "+JSON.stringify(r));
      if(r.warnings&&r.warnings.length)await nf({title:"帳簿のバックアップ：注意",message:r.warnings.join("\n"),priority:3,tags:["warning"]});
      const pol=String(env.NOTIFY_ON_SUCCESS||"full");
      if(!r.dryRun&&(pol==="all"||(pol==="full"&&r.type==="full")))
        await nf({title:r.type==="full"?"帳簿のフルバックアップ完了":"帳簿の増分バックアップ完了",message:`${r.name}（${Math.round(r.bytes/1024)}KB）`+(r.trashed?`\n古いバックアップ${r.trashed}件を整理しました`:""),priority:2,tags:["white_check_mark"]});
      return r;
    }catch(e){
      console.error("[backup] 失敗 "+(e&&e.code||"")+" "+(e&&e.message||e));
      const again=e instanceof BackupError&&e.retryable&&attempt<RETRY_WAIT.length;
      if(again){log(`${RETRY_WAIT[attempt]/1000}秒後にやり直します（${attempt+1}回目）`);await sleep(RETRY_WAIT[attempt++]);continue;}
      await nf({title:"⚠ 帳簿のバックアップに失敗しました",message:(e&&e.message||String(e))+hint(e),priority:4,tags:["rotating_light"]});
      throw e;
    }
  }
}

export default {
  async scheduled(event,env,ctx){await job(event,env);},
  async fetch(){return new Response("帳簿バックアップ用 Worker（公開ページはありません）",{status:404});},
};
