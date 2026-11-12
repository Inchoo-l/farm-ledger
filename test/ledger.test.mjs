import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {webcrypto} from "node:crypto";

// ブラウザや実際のクラウドを使わず、実コードを独立した環境で実行する。
function app(saved){
  const storage=new Map(saved?[["agri-ledger-v1",JSON.stringify(saved)]]:[]);
  const elements=new Map(),downloads=[],alerts=[],timers=new Map();
  let timerId=0,failStorage=false;
  const element=id=>{
    if(!elements.has(id))elements.set(id,{textContent:"",hidden:true,open:false,style:{},dataset:{},addEventListener(){}});
    return elements.get(id);
  };
  const context=vm.createContext({
    console,Date,TextEncoder,TextDecoder,crypto:webcrypto,btoa,atob,
    window:{crypto:webcrypto,addEventListener(){}},
    document:{getElementById:element,addEventListener(){},querySelector:()=>null},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>{if(failStorage)throw new Error("Quota exceeded");storage.set(k,v);}},
    alert:s=>alerts.push(s),confirm:()=>false,
    setTimeout:fn=>{const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
    setInterval:()=>++timerId,clearInterval(){},
    q:()=>"",totalBal:()=>0,scanBtn:()=>"",tanbaStr:()=>"",hy:v=>v||"-",
  });
  const run=code=>vm.runInContext(code,context);
  for(const name of ["state","utils","history","entities","list","dialog","edit","expfilter","depreciation","etax","dashboard","backup","crypto","sync","app"]){
    vm.runInContext(readFileSync(new URL(`../js/${name}.js`,import.meta.url),"utf8"),context,{filename:`js/${name}.js`});
  }
  context.captureDownload=(name,text)=>downloads.push({name,text});
  run("render=()=>updateSyncUI();idbSet=async()=>{};dl=captureDownload;year=2026;");
  return{run,context,storage,elements,downloads,alerts,timers,failStorage:()=>{failStorage=true;}};
}

function ledger(amount=100,rev=1){
  return{fields:[],expenses:[{id:1,date:"2026-06-01",category:"肥料費",amount}],sales:[],accounts:[],plantings:[],assets:[],settings:{deduction:100000},seq:2,rev};
}
function fileHandle(data){
  let text=JSON.stringify(data),modified=1,writes=0,onClose=null,onRead=null;
  return{
    name:"test.json",requestPermission:async()=>"granted",
    async getFile(){const snapshot=text;return{lastModified:modified,text:async()=>{if(onRead){const fn=onRead;onRead=null;await fn();}return snapshot;}};},
    async createWritable(){let buffer;return{write:async s=>{buffer=s;},close:async()=>{text=buffer;modified++;writes++;if(onClose){const fn=onClose;onClose=null;await fn();}}};},
    replace(data,sameTime=false){text=JSON.stringify(data);if(!sameTime)modified++;},
    raw(s){text=s;},get data(){return JSON.parse(text);},get writes(){return writes;},
    afterClose(fn){onClose=fn;},duringRead(fn){onRead=fn;},
  };
}
async function connected(){
  const a=app(ledger()),f=fileHandle(ledger());a.context.fh=f;
  await a.run("startSync(fh,'open',false)");
  assert.equal(a.run("sync.state"),"ok");
  return{...a,f};
}

test("赤字・控除上限・黒字の計算が集計とe-Taxで一致する",()=>{
  for(const [income,expense,ded,diff,shotoku] of [[1000000,1200000,100000,-200000,-200000],[50000,0,100000,50000,0],[300000,0,100000,300000,200000],[0,0,650000,0,0]]){
    const a=app(ledger(expense));
    a.run(`db.sales=[{id:2,date:'2026-06-01',kind:'直売・相対売上',amount:${income}}];db.settings.deduction=${ded};mode='all';`);
    assert.equal(a.run("etaxData().diff"),diff);
    assert.equal(a.run("etaxData().shotoku"),shotoku);
    assert.equal(a.run("ledgerTotals(inMode,true).shotoku"),shotoku);
    assert.match(a.run("dash()"),new RegExp(`農業所得[^]*?<b>${shotoku.toLocaleString('ja-JP')} 円</b>`));
  }
});

test("年度・田畑区分・棚卸・専従者給与・減価償却を反映する",()=>{
  const a=app();
  a.run(`db.sales=[{date:'2026-01-01',amount:1000000,div:'田'},{date:'2026-01-01',amount:300000,div:'畑'},{date:'2025-01-01',amount:9000000}];
    db.expenses=[{date:'2026-01-01',amount:200000,div:'田'},{date:'2026-01-01',amount:100000,div:'畑'}];
    db.yearly={2026:{invOpen:20000,invClose:50000,fam:100000}};
    db.assets=[{acquireDate:'2026-01-01',cost:100000,life:5,ratio:100,div:'田'}];db.settings.deduction=100000;`);
  assert.equal(a.run("etaxData().shotoku"),810000);
  assert.equal(a.run("ledgerTotals(inMode,false).diff"),780000);
  a.run("mode='hat'");
  assert.equal(a.run("ledgerTotals(inMode,false).diff"),200000);
});

test("未来の資産があってもe-Tax画面を描画でき、参照では帳簿を変更しない",()=>{
  const a=app();
  a.run("db.assets=[{name:'将来の機械',acquireDate:'2027-01-01',cost:100000,life:5,ratio:100}]");
  const before=a.run("JSON.stringify(db)");
  assert.equal(a.run("etaxData().dep"),0);
  a.run("etaxView();dash()");
  assert.equal(a.run("JSON.stringify(db)"),before);
});

test("新規は控除未設定、既存の控除設定は保持する",()=>{
  const fresh=app();
  assert.equal(fresh.run("db.settings.deduction"),null);
  assert.ok(fresh.run("checkBlue().some(s=>s.includes('控除額が未設定'))"));
  const old=ledger();old.settings.deduction=650000;
  assert.equal(app(old).run("db.settings.deduction"),650000);
});

test("端末保存・共有同期・バックアップの状態は独立する",async()=>{
  const a=await connected();
  a.run("db.expenses[0].amount=200;save();backup()");
  assert.equal(a.run("db.dirty"),true);
  assert.equal(a.run("db.backupDirty"),false);
  await a.run("writeFile()");
  assert.equal(a.run("db.dirty"),false);
  a.run("db.expenses[0].amount=300;save()");
  await a.run("writeFile()");
  assert.equal(a.run("db.backupDirty"),true);
  assert.match(a.elements.get("lastBk").textContent,/以降に変更あり/);
});

test("保存失敗を画面に残し、メモリ内データをバックアップできる",()=>{
  const a=app();a.failStorage();
  a.run("db.expenses.push({amount:123});save();render()");
  assert.equal(a.elements.get("saveError").hidden,false);
  assert.match(a.elements.get("lastBk").textContent,/保存失敗/);
  a.run("backup()");
  assert.equal(JSON.parse(a.downloads[0].text).expenses[0].amount,123);
  assert.equal(a.elements.get("saveError").hidden,false);
});

test("暗号化バックアップ中の変更をバックアップ済みにしない",async()=>{
  const a=app(ledger());
  a.run("askPassword=async()=>'test-password';encryptText=async text=>{db.expenses[0].amount=999;save();return text;}");
  await a.run("backupEnc()");
  assert.equal(JSON.parse(a.downloads[0].text).expenses[0].amount,100);
  assert.equal(a.run("db.backupDirty"),true);
});

test("管理項目・キー順の差は競合にせず、同じ版数の内容差は検出する",()=>{
  const a=app(ledger());
  assert.ok(a.run("ledgerSignature(db)===ledgerSignature({...db,rev:99,dirty:true,lastBackup:'2026-11-11',backupDirty:false})"));
  assert.ok(a.run("ledgerSignature(db)!==ledgerSignature({...db,expenses:[{amount:200}]})"));
});

for(const rev of [0,1,9]){
  test(`再接続時、相手の版数${rev}でも異なる内容を自動上書きしない`,async()=>{
    const a=app(ledger()),f=fileHandle(ledger(200,rev));a.context.fh=f;
    await a.run("startSync(fh,'reconnect',true)");
    assert.equal(a.run("sync.state"),"conflict");
    assert.equal(a.run("db.expenses[0].amount"),100);
    assert.equal(f.writes,0);
  });
}

test("空の端末には共有ファイルを読み込める",async()=>{
  const a=app(),f=fileHandle(ledger());a.context.fh=f;
  await a.run("startSync(fh,'open',false)");
  assert.equal(a.run("db.expenses[0].amount"),100);
  assert.equal(a.run("sync.state"),"ok");
});

test("同一更新日時・同一版数でも競合を検出し、保留中は書き込まない",async()=>{
  const a=await connected();
  a.run("db.expenses[0].amount=300;save()");
  a.f.replace(ledger(200),true);
  await a.run("writeFile()");
  assert.equal(a.run("sync.state"),"conflict");
  await a.run("resolveSyncConflict('hold');writeFile();pollTick()");
  assert.equal(a.f.writes,0);
  assert.equal(a.run("db.expenses[0].amount"),300);
});

for(const choice of ["local","remote"]){
  test(`${choice}を採用する前に両方を退避する`,async()=>{
    const a=await connected();a.f.replace(ledger(200));
    a.run("db.expenses[0].amount=300;save()");
    await a.run("writeFile()");
    await a.run(`resolveSyncConflict('${choice}')`);
    const copies=JSON.parse(a.storage.get("agri-ledger-v1-conflict-pair"));
    assert.equal(copies.local.expenses[0].amount,300);
    assert.equal(copies.remote.expenses[0].amount,200);
    assert.equal(a.run("db.expenses[0].amount"),choice==="local"?300:200);
    assert.equal(a.f.data.expenses[0].amount,choice==="local"?300:200);
    assert.equal(a.run("sync.state"),"ok");
  });
}

test("退避できないときは両方とも変更しない",async()=>{
  const a=await connected();a.f.replace(ledger(200));
  a.run("db.expenses[0].amount=300;save()");await a.run("writeFile()");a.failStorage();
  await a.run("resolveSyncConflict('remote')");
  assert.equal(a.run("db.expenses[0].amount"),300);
  assert.equal(a.f.writes,0);
  assert.equal(a.run("sync.state"),"conflict");
});

test("選択中に共有内容が変わったら再確認する",async()=>{
  const a=await connected();a.f.replace(ledger(200));
  a.run("db.expenses[0].amount=300;save()");await a.run("writeFile()");
  a.f.replace(ledger(400));await a.run("resolveSyncConflict('local')");
  assert.equal(a.run("sync.conflict.obj.expenses[0].amount"),400);
  assert.equal(a.f.writes,0);
});

test("送信中に追加した変更を同期済みにしない",async()=>{
  const a=await connected();a.run("db.expenses[0].amount=200;save()");
  a.f.afterClose(()=>a.run("db.expenses[0].amount=300;save()"));
  await a.run("writeFile()");
  assert.equal(a.f.data.expenses[0].amount,200);
  assert.equal(a.run("db.dirty"),true);
  assert.equal(a.run("sync.state"),"queued");
  await a.run("writeFile()");
  assert.equal(a.f.data.expenses[0].amount,300);
  assert.equal(a.run("db.dirty"),false);
});

test("自動読込の通信中に入力された変更を消さない",async()=>{
  const a=await connected();a.f.replace(ledger(200));
  a.f.duringRead(()=>a.run("db.expenses[0].amount=300;save()"));
  await a.run("pollTick()");
  assert.equal(a.run("sync.state"),"conflict");
  assert.equal(a.run("db.expenses[0].amount"),300);
});

test("端末が未変更なら同じ版数の共有更新も読み込む",async()=>{
  const a=await connected();a.f.replace(ledger(200),true);
  await a.run("pollTick()");
  assert.equal(a.run("db.expenses[0].amount"),200);
  assert.equal(a.run("db.backupDirty"),true);
});

test("壊れた・空の共有ファイルを自動で上書きしない",async()=>{
  for(const raw of ["null","[]","{bad","",'{"fields":[],"expenses":[],"sales":{}}']){
    const a=await connected();a.f.raw(raw);
    a.run("db.expenses[0].amount=200;save()");await a.run("writeFile()");
    assert.equal(a.f.writes,0,raw);
    assert.equal(a.run("sync.state"),"err",raw);
  }
});

test("暗号化した共有ファイルでも変更を保存・検証できる",async()=>{
  const a=await connected();
  await a.run("newCrypto('test-password').then(c=>sync.crypto=c)");
  a.run("db.expenses[0].amount=200;save()");await a.run("writeFile()");
  assert.equal(a.f.data.format,"agri-ledger-enc");
  assert.equal(a.run("sync.state"),"ok");
  assert.equal(await a.run("readRemote(false).then(r=>r.obj.expenses[0].amount)"),200);
});

test("暗号化途中に版数が進んでも、封筒と中身の版数は一致する",async()=>{
  const a=app(ledger());
  await a.run("newCrypto('test-password').then(c=>sync.crypto=c)");
  const result=await a.run("(async()=>{const pending=encryptText(JSON.stringify(db),sync.crypto);db.rev=99;return JSON.parse(await pending);})()");
  assert.equal(result.rev,1);
});

test("パスワード変更・暗号化解除でも旧鍵で内容を確認してから保存する",async()=>{
  const a=await connected();
  await a.run("newCrypto('old-password').then(c=>sync.crypto=c)");
  await a.run("writeFile()");
  const oldSalt=a.f.data.salt;
  await a.run("newCrypto('new-password').then(c=>{sync.previousCrypto=sync.crypto;sync.crypto=c;})");
  a.run("save()");await a.run("writeFile()");
  assert.notEqual(a.f.data.salt,oldSalt);
  assert.equal(a.run("sync.state"),"ok");
  a.run("sync.previousCrypto=sync.crypto;sync.crypto=null;save()");await a.run("writeFile()");
  assert.equal(a.f.data.expenses[0].amount,100);
  assert.equal(a.run("sync.state"),"ok");
});

test("他端末で暗号鍵が変わったファイルを同じ更新日時でも上書きしない",async()=>{
  const a=await connected();
  await a.run("newCrypto('test-password').then(c=>sync.crypto=c)");
  await a.run("writeFile()");
  a.f.replace({...a.f.data,salt:'different-salt'},true);
  a.run("db.expenses[0].amount=300;save()");
  await a.run("writeFile()");
  assert.equal(a.f.writes,1);
  assert.equal(a.run("sync.state"),"err");
});

test("数量・単価の小数は一覧と検索で丸めない",()=>{
  const a=app();
  assert.equal(a.run("cell('sales',ENT.sales.cols.find(c=>c.k==='qty'),{qty:0.25})"),'0.25');
  assert.equal(a.run("expText(ENT.expenses.cols.find(c=>c.k==='qty'),{qty:1.25})"),'1.25');
  assert.equal(a.run("cell('expenses',ENT.expenses.cols.find(c=>c.k==='unitPrice'),{unitPrice:12.5})"),'12.5');
});

test("分離した濁点・半角カナを同じ語で検索し、元の表記をハイライトする",()=>{
  const a=app();
  assert.equal(a.run("expNormStr('か\\u3099')"),'が');
  assert.equal(a.run("expNormStr('ｶﾞ')"),'が');
  assert.equal(a.run("expMarkHtml('か\\u3099',expRanges('か\\u3099',['が'],false))"),'<mark>が</mark>');
});

test("作付削除で経費・売上の紐づけを解除し、元に戻すと復旧する",()=>{
  const a=app();a.context.confirm=()=>true;
  a.run("db.plantings=[{id:2,year:2026}];db.expenses=[{id:3,plantingId:2,amount:100}];db.sales=[{id:4,plantingId:2,amount:200}];resetHist();del('plantings',2)");
  assert.equal(a.run("db.expenses[0].plantingId"),'');
  assert.equal(a.run("db.sales[0].plantingId"),'');
  a.run("undo()");
  assert.equal(a.run("db.expenses[0].plantingId"),2);
  assert.equal(a.run("db.plantings.length"),1);
});

test("作付で使っている圃場は削除して参照切れにしない",()=>{
  const a=app();a.context.confirm=()=>true;
  a.run("db.fields=[{id:1,name:'畑'}];db.plots=[{id:2,fieldId:1}];db.plantings=[{id:3,fieldId:1,plotId:2}];del('fields',1)");
  assert.equal(a.run("db.fields.length"),1);
  assert.equal(a.run("db.plots.length"),1);
});

test("連番の古いバックアップを復元しても既存IDを再利用しない",()=>{
  const a=app();
  a.run("db.seq=1;db.expenses=[{id:1}];db.plantings=[{id:99}]");
  assert.equal(a.run("uid()"),100);
  assert.equal(a.run("uid()"),101);
});

test("特殊な名前の作物・取引先も通常どおり集計する",()=>{
  const a=app();
  a.run("db.fields=[{id:1,area:10}];db.plantings=[{id:2,fieldId:1,year:2026,variety:'__proto__',yield:30}];db.expenses=[{date:'2026-01-01',category:'小作料・賃借料',vendor:'constructor',amount:100}]");
  assert.equal(a.run("etaxData().crops['__proto__'].area"),10);
  assert.equal(a.run("etaxData().rents.constructor"),100);
  assert.ok(a.run("Object.keys(etaxData().crops).includes('__proto__')"));
});

test("減価償却の事業割合未設定は100%、不正値でNaNやInfinityを出さない",()=>{
  const a=app();
  assert.equal(a.run("depreciation({acquireDate:'2026-01-01',cost:100000,life:5},2026).biz"),20000);
  for(const life of [0,-1]){
    assert.ok(a.run(`Object.values(depreciation({acquireDate:'2026-01-01',cost:100000,life:${life}},2026)).every(Number.isFinite)`));
  }
});

test("コピー失敗時に成功と表示しない",async()=>{
  const a=app();
  a.context.navigator={};
  a.context.document.createElement=()=>({value:'',select(){},remove(){}});
  a.context.document.body={appendChild(){}};
  a.context.document.execCommand=()=>false;
  a.context.btn={textContent:'コピー',dataset:{}};
  await a.run("copyVal(123,btn)");
  assert.equal(a.context.btn.textContent,'コピー');
  assert.ok(a.alerts.length>0);
});

test("入力検証は空白・存在しない参照・不正な数値を保存前に拒否する",()=>{
  const a=app();
  assert.notEqual(a.run("recordError({name:'   '},ENT.fields.cols)"),'');
  assert.notEqual(a.run("recordError({year:2026,fieldId:999,variety:'米'},ENT.plantings.cols)"),'');
  for(const value of ['Infinity','NaN','-1']){
    assert.notEqual(a.run(`recordError({life:${value}},[ENT.assets.cols.find(c=>c.k==='life')])`),'');
  }
  assert.notEqual(a.run("recordError({ratio:101},[ENT.assets.cols.find(c=>c.k==='ratio')])"),'');
  assert.equal(a.run("recordError({ratio:0},[ENT.assets.cols.find(c=>c.k==='ratio')])"),'');
  assert.equal(a.run("recordError({qty:0.25},[ENT.expenses.cols.find(c=>c.k==='qty')])"),'');
});

test("正常なコピーは成功と表示し、拒否時は代替方式で再試行する",async()=>{
  const a=app();let copied='';
  a.context.btn={textContent:'コピー',dataset:{}};
  a.context.navigator={clipboard:{writeText:async text=>{copied=text;}}};
  await a.run("copyVal(-123,btn)");
  assert.equal(copied,'-123');assert.equal(a.context.btn.textContent,'✔ コピーしました');
  a.context.navigator.clipboard.writeText=async()=>{throw new Error('Denied');};
  a.context.document.createElement=()=>({select(){},remove(){}});
  a.context.document.body={appendChild(){}};
  a.context.document.execCommand=()=>true;
  await a.run("copyVal(0,btn)");
  assert.equal(a.alerts.length,0);
});

test("減価償却の初年度月割り・償却終了・事業割合0%を保つ",()=>{
  const a=app();
  assert.equal(a.run("depreciation({acquireDate:'2026-07-01',cost:100000,life:5,ratio:100},2026).dep"),10000);
  assert.equal(a.run("depreciation({acquireDate:'2026-01-01',cost:100000,life:5,ratio:0},2026).biz"),0);
  assert.equal(a.run("depreciation({acquireDate:'2020-01-01',cost:100000,life:5,ratio:100},2026).rest"),1);
});

test("償却率は国の償却率表どおり、小数第3位を切り上げる",()=>{
  const a=app();
  assert.equal(a.run("JSON.stringify([3,4,6,7,9,12,14,15].map(l=>depreciation({acquireDate:'2026-01-10',cost:1000000,life:l,ratio:100},2026).rate))"),
    JSON.stringify([0.334,0.25,0.167,0.143,0.112,0.084,0.072,0.067]));
  // 取得日は文字から年月を読む（時差で前の月・前の年にずれない）
  assert.equal(a.run("depreciation({acquireDate:'2026-01-01',cost:120000,life:4,ratio:100},2026).months"),12);
  assert.equal(a.run("depreciation({acquireDate:'2026-13-01',cost:120000,life:4,ratio:100},2026).dep"),0);
});

test("一覧が壊れた保存データでも起動でき、残りの記録はそのまま読める",()=>{
  const a=app({fields:"x",expenses:null,plantings:[{id:5,year:2026,variety:"米"},null],sales:[],accounts:[],assets:[],settings:null,seq:9});
  assert.equal(a.run("JSON.stringify([db.fields.length,db.expenses.length,db.plantings.length,db.seq,typeof db.settings])"),JSON.stringify([0,0,1,9,"object"]));
});

test("削除済みの作付を指したままの経費も、共通費として原価に入る",()=>{
  const a=app();
  a.run(`mode='rice';db.fields=[{id:1,name:'田',area:10,div:'田'}];
    db.plantings=[{id:2,year:2026,fieldId:1,variety:'米',div:'田'}];
    db.expenses=[{id:3,date:'2026-05-01',category:'肥料費',amount:1000,plantingId:2,div:'田'},
                 {id:4,date:'2026-05-02',category:'肥料費',amount:500,plantingId:999,div:'田'}];`);
  assert.equal(a.run("(()=>{const c=dashCalc('田');return c.prow.reduce((s,r)=>s+r.cost,0)===c.exTotal&&c.exTotal===1500;})()"),true);
});

test("年産は一覧でカンマを付けない",()=>{
  const a=app();
  assert.equal(a.run("cell('plantings',ENT.plantings.cols.find(c=>c.k=='year'),{year:2026})"),"2026");
});

test("バージョン番号が 大.中.小 の形で、更新履歴の先頭と一致する",()=>{
  const ctx=vm.createContext({console,document:{getElementById:()=>null}});
  vm.runInContext(readFileSync(new URL("../js/version.js",import.meta.url),"utf8"),ctx,{filename:"js/version.js"});
  const ver=vm.runInContext("APP_VERSION",ctx);
  assert.match(ver,/^\d+\.\d+\.\d+$/);
  assert.equal(vm.runInContext("appVersionText()",ctx),`帳簿アプリ Ver.${ver}`);
  assert.equal(vm.runInContext("showAppVersion()",ctx),false); // 表示先が無くても止まらない
  const log=readFileSync(new URL("../更新履歴.md",import.meta.url),"utf8");
  assert.equal((log.match(/^## Ver\.(\d+\.\d+\.\d+)/m)||[])[1],ver);
});
