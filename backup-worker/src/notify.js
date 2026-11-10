// 失敗などを ntfy（スマホのアプリ通知）で知らせる "use strict";
/* NTFY_TOPIC（秘密情報）に、推測されにくいトピック名を登録しておく。未登録なら、通知はせずログだけ残す。
   通知が送れなくても、バックアップ本体の成否には影響させない */
export async function notify(env,{title,message,priority=3,tags=[]},f=fetch){
  if(!env.NTFY_TOPIC){console.log("[通知なし：NTFY_TOPIC が未登録]",title,message);return false;}
  try{
    const base=String(env.NTFY_SERVER||"https://ntfy.sh").replace(/\/+$/,"");
    const r=await f(base+"/",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({topic:env.NTFY_TOPIC,title,message,priority,tags})});
    if(!r.ok){console.error("ntfy への送信に失敗しました（HTTP "+r.status+"）");return false;}
    return true;
  }catch(e){console.error("ntfy への送信に失敗しました",e&&e.message||e);return false;}
}