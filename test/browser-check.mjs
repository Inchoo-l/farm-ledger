// 実ブラウザでフォームの境界ケースを確認。実際の帳簿・Googleドライブは使わない。
// npm install --no-save --package-lock=false playwright
// node test/browser-check.mjs （既定はインストール済みのEdge）
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const server=createServer(async(req,res)=>{
  try{
    const p=new URL(req.url,'http://localhost').pathname;
    const file=path.resolve(root,'.'+decodeURIComponent(p==='/'?'/index.html':p));
    if(path.relative(root,file).startsWith('..'))throw new Error('Outside project');
    const data=await readFile(file);
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'text/html; charset=utf-8');
    res.end(data);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
  browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
  const page=await browser.newPage(),errors=[],observed={};
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  const reset=async()=>page.evaluate(()=>{
    $('dlg').close();db=empty();mode='rice';year=2026;tab='dash';
    db.accounts=[{id:1,name:'現金',type:'現金（手元）',balance:0}];db.seq=2;resetHist();render();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await reset();await page.evaluate(()=>edit('plantings'));
  await page.locator('[name=variety]').fill('コシヒカリ');
  observed.missingFieldBlocked=await page.evaluate(()=>!$('frm').checkValidity());
  observed.labelsAssociated=await page.locator('#frm .fld').evaluateAll(items=>items.every(d=>!!d.querySelector('label').control));

  await reset();await page.evaluate(()=>edit('expenses',null,null,{category:'肥料費',date:'2026-06-01',vendor:'店',desc:'肥料',qty:0,unitPrice:120,accountId:1}));
  await page.locator('#frm button[value=ok]').click();
  observed.zeroCalculated=await page.evaluate(()=>db.expenses.length===1&&db.expenses[0].amount===0);

  await reset();await page.evaluate(()=>{
    db.fields=[{id:2,name:'田',area:10}];db.plantings=[{id:3,fieldId:2,year:2023,variety:'米'}];
    db.expenses=[{id:4,date:'2026-06-01',category:'肥料費',vendor:'店',desc:'肥料',amount:120,accountId:1,plantingId:3}];edit('expenses',4);
  });
  observed.oldLinkPreserved=await page.locator('#frm [name=plantingId]').inputValue()==='3';
  await page.locator('#frm button[value=ok]').click();
  observed.oldLinkSaved=await page.evaluate(()=>db.expenses[0].plantingId===3);

  await reset();await page.evaluate(()=>edit('assets',null,null,{name:'機械',acquireDate:'2026-01-01',cost:100000,life:0,ratio:100}));
  observed.zeroLifeBlocked=await page.evaluate(()=>!$('frm').checkValidity());

  await reset();await page.evaluate(()=>{
    edit('expenses',null,null,{date:'2026-06-01'});window.dateEvents=[];
    for(const e of ['input','change'])$('frm').elements.date.addEventListener(e,()=>window.dateEvents.push(e));
  });
  await page.locator('#cal_date button[data-d="2026-06-05"]').click();
  observed.calendarEvents=await page.evaluate(()=>window.dateEvents.join(',')==='input,change');

  await reset();await page.evaluate(()=>{db.accounts=[];edit('sales',null,null,{kind:'家事消費',date:'2026-06-01',amount:100});});
  if(await page.locator('#dlg').isVisible())await page.locator('#frm button[value=ok]').click();
  observed.noCashWithoutAccount=await page.evaluate(()=>db.sales.length===1&&db.sales[0].accountId==='');

  await reset();await page.evaluate(()=>edit('expenses',null,null,{category:'肥料費',date:'2026-06-01',vendor:'店',desc:'肥料',amount:100,accountId:1}));
  await page.locator('#frm [name=desc]').fill('   ');
  await page.locator('#frm button[value=ok]').click();
  observed.whitespaceBlocked=await page.evaluate(()=>db.expenses.length===0);

  await reset();await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>edit('sales',null,null,{date:'2026-06-01',amount:100,qty:1.5,accountId:1}));
  await page.locator('#frm button[value=ok]').click();
  observed.mobileSubmit=await page.evaluate(()=>db.sales.length===1&&db.sales[0].qty===1.5);
  observed.mobileWidth=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
  console.log(JSON.stringify(observed,null,2));
  assert.deepEqual(errors,[]);
  for(const [name,ok] of Object.entries(observed))assert.equal(ok,true,name);
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
