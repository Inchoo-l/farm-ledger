// 共通ロジック（backupchain.js）の検証：乱数でデータを変えながら、フル＋増分の復元が元と一致するか "use strict";
import test from "node:test";
import assert from "node:assert/strict";
import BC from "../../js/backupchain.js";

// 乱数（毎回同じ結果になるよう、種を固定）
function rng(seed){return()=>{seed=(seed*1664525+1013904223)%4294967296;return seed/4294967296;};}
function makeDb(r){
  const db={fields:[],plantings:[],expenses:[],sales:[],assets:[],accounts:[],plots:[],settings:{deduction:650000},yearly:{},cropColors:{},lastBackup:null,seq:1,rev:1};
  for(let i=0;i<6;i++)db.fields.push({id:db.seq++,name:"圃場"+i,area:Math.round(r()*100),div:r()<0.5?"田":"畑"});
  for(let i=0;i<40;i++)db.expenses.push({id:db.seq++,date:"2026-0"+(1+Math.floor(r()*9))+"-1"+Math.floor(r()*9),category:"肥料費",desc:"品"+i,amount:Math.round(r()*1e5),div:"田",note:"メモ"+i});
  for(let i=0;i<20;i++)db.sales.push({id:db.seq++,date:"2026-10-0"+(1+Math.floor(r()*9)),kind:"出荷売上（JA等）",amount:Math.round(r()*1e5),div:"畑"});
  db.accounts.push({id:db.seq++,name:"JA",balance:1000});
  return db;
}
function mutate(db,r){
  const d=BC.clone(db);d.rev=(d.rev||0)+1;
  const n=1+Math.floor(r()*6);
  for(let k=0;k<n;k++){
    const x=r();
    if(x<0.3)d.expenses.push({id:d.seq++,date:"2026-11-0"+(1+Math.floor(r()*9)),category:"雑費",desc:"新"+d.seq,amount:Math.round(r()*1e4),div:"畑"});
    else if(x<0.55&&d.expenses.length){const e=d.expenses[Math.floor(r()*d.expenses.length)];e.amount=Math.round(r()*1e5);e.note="変更"+k;}
    else if(x<0.7&&d.expenses.length){d.expenses.splice(Math.floor(r()*d.expenses.length),1);}
    else if(x<0.8&&d.sales.length>2){const i=Math.floor(r()*d.sales.length),j=Math.floor(r()*d.sales.length);[d.sales[i],d.sales[j]]=[d.sales[j],d.sales[i]];} // 並べ替え
    else if(x<0.88){d.settings={...d.settings,deduction:[650000,550000,100000][Math.floor(r()*3)],approved:r()<0.5};}
    else if(x<0.93){d.cropColors={...d.cropColors,["作物"+Math.floor(r()*5)]:"#"+Math.floor(r()*16777215).toString(16).padStart(6,"0")};}
    else if(x<0.96){d.yearly={...d.yearly,2026:{invOpen:Math.round(r()*1e5),fam:0}};}
    else if(x<0.98){delete d.yearly;}   // 項目ごと消える
    else {d.plots=[...(d.plots||[]),{id:d.seq++,fieldId:d.fields[0].id,name:"区画"+d.seq,mx:10,my:10,mw:100,mh:80}];} // 一覧が増える
  }
  d.lastBackup="2026-11-0"+(1+Math.floor(r()*9));d.dirty=r()<0.5; // 管理用の値（変更とみなさない）
  return d;
}

test("乱数で300日ぶんの変更を重ねても、フル＋増分の復元が毎回元と一致する",()=>{
  const r=rng(12345);
  let cur=makeDb(r),base=BC.clone(cur);
  let full=BC.makeFull(cur,{stamp:"2026-01-01T16:00:00.000Z",date:"2026-01-02"});
  let incrs=[],prev=full._backup.stamp;
  for(let day=1;day<=300;day++){
    cur=mutate(cur,r);
    const stamp=new Date(Date.UTC(2026,0,1,16,0,0)+day*864e5).toISOString();
    const inc=BC.makeIncr(base,cur,{stamp,date:stamp.slice(0,10),baseStamp:prev});
    // 保存して読み直した（JSONを通した）ものを使う
    incrs.push(JSON.parse(JSON.stringify(inc)));prev=stamp;base=BC.clone(cur);
    if(day%7===0){ // 週ごとにフルを取り直す
      full=BC.makeFull(cur,{stamp,date:stamp.slice(0,10)});full=JSON.parse(JSON.stringify(full));incrs=[];
    }
    const res=BC.restoreChain(full,incrs);
    assert.ok(BC.same(res.state,cur),"day "+day+": 復元結果が元と一致しません");
    assert.equal(res.state.rev,cur.rev,"版数(rev)も一致する");
  }
});

test("変更がなければ、増分は空（版数だけ）",()=>{
  const r=rng(7),db=makeDb(r);
  const inc=BC.makeIncr(db,{...BC.clone(db),lastBackup:"x",dirty:true},{stamp:"2026-02-01T16:00:00.000Z",date:"2026-02-02",baseStamp:"a"});
  assert.equal(inc.set,undefined);assert.equal(inc.del,undefined);assert.equal(inc.keys,undefined);
  assert.deepEqual(BC.summarize(inc),{changed:0,deleted:0,keys:0});
});

test("削除も記録される",()=>{
  const db={fields:[],expenses:[{id:1,a:1},{id:2,a:2},{id:3,a:3}],rev:1};
  const cur={fields:[],expenses:[{id:1,a:1},{id:3,a:3}],rev:2};
  const inc=BC.makeIncr(db,cur,{stamp:"s2",date:"d",baseStamp:"s1"});
  assert.deepEqual(inc.del,{expenses:[2]});
  assert.equal(inc.set,undefined);
  assert.deepEqual(BC.apply(db,inc).expenses.map(r=>r.id),[1,3]);
});

test("記録の項目の並びが違うだけでは変更とみなさない",()=>{
  const a={fields:[],expenses:[{id:1,x:1,y:2}],rev:1},b={fields:[],expenses:[{id:1,y:2,x:1}],rev:1};
  const inc=BC.makeIncr(a,b,{stamp:"s",date:"d",baseStamp:"p"});
  assert.equal(inc.set,undefined);
});

test("増分が1つ抜けていると、どこが抜けたかを伝えて失敗する",()=>{
  const r=rng(99);let cur=makeDb(r);const full=BC.makeFull(cur,{stamp:"2026-03-01T16:00:00.000Z",date:"2026-03-02"});
  let prev=full._backup.stamp,base=BC.clone(cur),list=[];
  for(let i=1;i<=3;i++){cur=mutate(cur,r);const st="2026-03-0"+(i+1)+"T16:00:00.000Z";list.push(BC.makeIncr(base,cur,{stamp:st,date:st.slice(0,10),baseStamp:prev}));prev=st;base=BC.clone(cur);}
  assert.throws(()=>BC.restoreChain(full,[list[0],list[2]]),e=>e.code==="gap"&&/足りません/.test(e.message));
  assert.ok(BC.same(BC.restoreChain(full,list).state,cur));
});

test("buildChain：古いフルや古い増分が混ざっていても、いちばん新しいフルにつながる分だけを選ぶ",()=>{
  const r=rng(5);let cur=makeDb(r);
  const f1=BC.makeFull(cur,{stamp:"2026-04-01T16:00:00.000Z",date:"d"});
  const i1=BC.makeIncr(cur,(cur=mutate(cur,r)),{stamp:"2026-04-02T16:00:00.000Z",date:"d",baseStamp:f1._backup.stamp});
  const f2=BC.makeFull(cur,{stamp:"2026-04-08T16:00:00.000Z",date:"d"});
  const base=BC.clone(cur);const i2=BC.makeIncr(base,(cur=mutate(cur,r)),{stamp:"2026-04-09T16:00:00.000Z",date:"d",baseStamp:f2._backup.stamp});
  const {full,incrs}=BC.buildChain([i2,f1,i1,f2]);
  assert.equal(full._backup.stamp,f2._backup.stamp);
  assert.deepEqual(incrs.map(x=>x._backup.stamp),[i2._backup.stamp]);
  assert.ok(BC.same(BC.restoreChain(full,incrs).state,cur));
});

test("フルに管理用の _backup が付き、取り除けば元のデータ",()=>{
  const db=makeDb(rng(3));const f=BC.makeFull(db,{stamp:"s",date:"d"});
  assert.equal(f._backup.type,"full");
  assert.ok(BC.same(BC.restoreChain(f,[]).state,db));
});

test("性能の目安：記録2000件でも、差分と当てはめが短時間で終わる",()=>{
  const r=rng(1);const db=makeDb(r);
  for(let i=0;i<2000;i++)db.expenses.push({id:db.seq++,date:"2026-05-01",category:"肥料費",desc:"品"+i,amount:i,note:"メモ".repeat(5),div:"田"});
  const cur=mutate(db,r);
  const t0=performance.now();
  const inc=BC.makeIncr(db,cur,{stamp:"s",date:"d",baseStamp:"p"});
  const st=BC.apply(db,inc);
  const ms=performance.now()-t0;
  assert.ok(BC.same(st,cur));
  console.log("  （目安）差分＋当てはめ："+ms.toFixed(1)+"ms／データ約"+Math.round(JSON.stringify(db).length/1024)+"KB");
  assert.ok(ms<500);
});