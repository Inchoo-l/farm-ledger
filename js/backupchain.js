// 自動バックアップ（フル＋増分）の共通部品。ブラウザ（復元画面）・バックアップ用 Worker・復元コマンドの3か所で同じものを使う "use strict";
/* ========== フル＋増分バックアップの仕組み ==========
   ・フル  ＝ 帳簿データ(db)まるごと（＋ _backup という管理用の項目）。そのまま「復元」で読み込める
   ・増分  ＝ 1つ前のバックアップ（フルまたは前の増分）からの「追加・変更・削除」だけ
   ・増分の中身（JSON）：
       {format:"agri-ledger-incr", v:1, _backup:{type:"incr", stamp, base, date, baseRev, rev},
        set:{ 一覧名:[追加・変更された記録…] }, del:{ 一覧名:[削除された記録のid…] }, order:{ 一覧名:[並び順のid…] },
        keys:{ 一覧以外の項目:新しい値 }, removedKeys:[消えた項目…], rev}
   ・stamp は作った時刻（UTC・ISO形式）。base は「この増分が土台にした1つ前の stamp」。
     この鎖（base→stamp→…）がつながっているかで、増分が抜けていないかを確かめる
   ・復元は、フル → 増分を stamp の順に1つずつ当てはめる。当てはめた結果は、元のデータと完全に一致する
   ・版数(rev)・dirty・lastBackup は、変更とみなさない（開くだけで変わる管理用の値のため） */
(function(root,factory){
  if(typeof module==="object"&&module.exports)module.exports=factory(); // Node・Worker
  else root.BackupChain=factory();                                       // ブラウザ
})(typeof self!=="undefined"?self:this,function(){
  const IGNORE=["rev","dirty","lastBackup","_backup"]; // 変更とみなさない項目
  const FORMAT_INCR="agri-ledger-incr";
  const clone=v=>JSON.parse(JSON.stringify(v));
  const err=(code,msg)=>Object.assign(new Error(msg),{code});

  // 項目の並び順に関係なく、同じ中身なら同じ文字列になる文字列化（変更の有無の判定に使う）
  function canon(v){
    if(v===null||typeof v!=="object")return JSON.stringify(v);
    if(Array.isArray(v))return "["+v.map(canon).join(",")+"]";
    const ks=Object.keys(v).filter(k=>v[k]!==undefined).sort();
    return "{"+ks.map(k=>JSON.stringify(k)+":"+canon(v[k])).join(",")+"}";
  }
  // id を持つ記録の一覧（経費・売上・作付など）か
  const isKeyed=a=>Array.isArray(a)&&a.every(r=>r&&typeof r==="object"&&!Array.isArray(r)&&r.id!=null)&&new Set(a.map(r=>String(r.id))).size===a.length;

  // base（前の状態）から cur（今の状態）への違いを求める
  function diff(base,cur){
    const out={set:{},del:{},order:{},keys:{},removedKeys:[]};
    const names=new Set([...Object.keys(base||{}),...Object.keys(cur||{})]);
    for(const k of names){
      if(IGNORE.includes(k))continue;
      const b=base?base[k]:undefined,c=cur?cur[k]:undefined;
      if(c===undefined){if(b!==undefined)out.removedKeys.push(k);continue;}
      const bOk=b===undefined||isKeyed(b);
      if(isKeyed(c)&&bOk){
        const bl=b||[],bm=new Map(bl.map(r=>[String(r.id),r])),cm=new Map(c.map(r=>[String(r.id),r]));
        const set=c.filter(r=>{const o=bm.get(String(r.id));return !o||!(JSON.stringify(o)===JSON.stringify(r)||canon(o)===canon(r));}); // まず速い比較、違ったときだけ項目の並びを直して比べる
        const del=bl.filter(r=>!cm.has(String(r.id))).map(r=>r.id);
        // 当てはめたときの並び（残った記録は元の並び＋新しい記録は後ろ）が、今の並びと違うときだけ、並び順を記録する
        const naive=bl.filter(r=>cm.has(String(r.id))).map(r=>String(r.id)).concat(set.filter(r=>!bm.has(String(r.id))).map(r=>String(r.id)));
        const now=c.map(r=>String(r.id));
        const reorder=naive.join("\u0000")!==now.join("\u0000");
        if(set.length)out.set[k]=set;
        if(del.length)out.del[k]=del;
        if(reorder)out.order[k]=c.map(r=>r.id);
      }else if(b===undefined||canon(b)!==canon(c)){
        out.keys[k]=c;
      }
    }
    return out;
  }
  // 増分を、土台の状態に当てはめた新しい状態を返す（inPlace=true のときは、土台そのものを書き換える＝速い。復元で何度も当てはめるときに使う）
  function apply(base,incr,inPlace){
    if(!incr||incr.format!==FORMAT_INCR)throw err("format","増分バックアップの形式ではありません");
    const s=inPlace?base:clone(base);
    const names=new Set([...Object.keys(incr.set||{}),...Object.keys(incr.del||{}),...Object.keys(incr.order||{})]);
    names.forEach(k=>{
      const del=new Set(((incr.del||{})[k]||[]).map(String));
      let list=(Array.isArray(s[k])?s[k]:[]).filter(r=>!del.has(String(r.id)));
      const pos=new Map();list.forEach((r,i)=>pos.set(String(r.id),i));
      ((incr.set||{})[k]||[]).forEach(r=>{
        const id=String(r.id);
        const rec=inPlace?r:clone(r);if(pos.has(id))list[pos.get(id)]=rec;else{pos.set(id,list.length);list.push(rec);}
      });
      const ord=(incr.order||{})[k];
      if(ord){
        const m=new Map(list.map(r=>[String(r.id),r]));
        const re=ord.map(id=>m.get(String(id))).filter(Boolean);
        if(re.length!==list.length)throw err("order","増分の並び順が合いません（"+k+"）");
        list=re;
      }
      s[k]=list;
    });
    Object.keys(incr.keys||{}).forEach(k=>{s[k]=clone(incr.keys[k]);});
    (incr.removedKeys||[]).forEach(k=>{delete s[k];});
    if(incr.rev!==undefined)s.rev=incr.rev;
    return s;
  }

  // 保存するファイルの中身を作る
  function makeFull(db,meta){ // meta: {stamp,date}
    return Object.assign({},clone(db),{_backup:{type:"full",stamp:meta.stamp,date:meta.date,rev:db.rev||0}});
  }
  function makeIncr(base,cur,meta){ // meta: {stamp,date,baseStamp}
    const d=diff(base,cur),o={format:FORMAT_INCR,v:1,_backup:{type:"incr",stamp:meta.stamp,base:meta.baseStamp,date:meta.date,baseRev:base.rev||0,rev:cur.rev||0}};
    ["set","del","order","keys"].forEach(k=>{if(Object.keys(d[k]).length)o[k]=d[k];});
    if(d.removedKeys.length)o.removedKeys=d.removedKeys;
    o.rev=cur.rev||0;
    return o;
  }
  const isFull=o=>!!o&&!!o._backup&&o._backup.type==="full"&&Array.isArray(o.expenses)&&Array.isArray(o.fields);
  const isIncr=o=>!!o&&o.format===FORMAT_INCR&&!!o._backup&&o._backup.type==="incr";
  const byStamp=(a,b)=>a._backup.stamp<b._backup.stamp?-1:a._backup.stamp>b._backup.stamp?1:0;

  // フルと増分を日付(stamp)の順に当てはめて、元の状態を作る。鎖がつながっていなければ、どこが抜けているかを伝えて失敗する
  function restoreChain(full,incrs){
    if(!isFull(full))throw err("nofull","フルバックアップではありません");
    let state=clone(full);delete state._backup;
    let prev=full._backup.stamp,last=full._backup;
    for(const inc of [...incrs].sort(byStamp)){
      if(inc._backup.base!==prev)throw err("gap",`増分が足りません（${inc._backup.date||inc._backup.stamp} の増分の土台になる ${inc._backup.base} のバックアップが見つかりません）`);
      state=apply(state,inc,true);prev=inc._backup.stamp;last=inc._backup; // state は自分で作った写しなので、そのまま書き換えてよい
    }
    return{state,last,count:incrs.length};
  }
  // 中身の混ざったバックアップ（フルが複数・古い増分など）から、いちばん新しいフルと、それにつながる増分を選ぶ
  function buildChain(objs){
    const fulls=objs.filter(isFull).sort(byStamp);
    if(!fulls.length)throw err("nofull","フルバックアップのファイルが含まれていません");
    const full=fulls[fulls.length-1];
    const incrs=objs.filter(isIncr).filter(o=>o._backup.stamp>full._backup.stamp).sort(byStamp);
    return{full,incrs};
  }
  // 復元の結果が、期待どおりか（テスト・確認用）：管理用の値以外が一致するか
  const same=(a,b)=>canon(strip(a))===canon(strip(b));
  function strip(o){const c=clone(o);IGNORE.forEach(k=>delete c[k]);return c;}
  // 増分に何が入っているかの要約（ログ・通知用）
  function summarize(incr){
    let add=0,chg=0,del=0;
    // 追加か変更かは中身だけでは区別しないので、まとめて「追加・変更」として数える
    Object.values(incr.set||{}).forEach(a=>{add+=a.length;});
    Object.values(incr.del||{}).forEach(a=>{del+=a.length;});
    return{changed:add+chg,deleted:del,keys:Object.keys(incr.keys||{}).length+(incr.removedKeys||[]).length};
  }
  return{IGNORE,FORMAT_INCR,clone,canon,isKeyed,diff,apply,makeFull,makeIncr,isFull,isIncr,byStamp,restoreChain,buildChain,same,strip,summarize,err};
});
