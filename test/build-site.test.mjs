import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildSite} from "../tools/build-site.mjs";

// 仮のリポジトリを作って、公開用フォルダの中身を確かめる
function repo(extra={}){
  const root=mkdtempSync(join(tmpdir(),"site-"));
  const files={"index.html":"<p>top</p>","privacy.html":"<p>p</p>","assets/icon.png":"x","css/style.css":"a{}","js/main.js":"1","js/sub/x.js":"2",
    "README.md":"doc","test/a.test.mjs":"t","backup-worker/.dev.vars":"SECRET=1",".env":"SECRET=1",...extra};
  for(const [p,s] of Object.entries(files)){
    mkdirSync(join(root,p,".."),{recursive:true});
    writeFileSync(join(root,p),s);
  }
  return root;
}

test("公開用フォルダには、決めたファイルだけが入る",()=>{
  const root=repo();
  try{
    const r=buildSite(root,join(root,"deploy"));
    assert.deepEqual(r.files,["assets/icon.png","css/style.css","index.html","js/main.js","js/sub/x.js","privacy.html"]);
    assert.equal(existsSync(join(root,"deploy","README.md")),false);
    assert.equal(existsSync(join(root,"deploy","backup-worker")),false);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("作り直すと古いファイルは残らず、以前の wrangler.jsonc は外へ退避する",()=>{
  const root=repo({"deploy/old.js":"old","deploy/wrangler.jsonc":"{\"name\":\"mine\"}"});
  try{
    const r=buildSite(root,join(root,"deploy"));
    assert.equal(existsSync(join(root,"deploy","old.js")),false);
    assert.equal(existsSync(join(root,"deploy","wrangler.jsonc")),false);
    assert.equal(readFileSync(r.moved,"utf8"),"{\"name\":\"mine\"}");
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("秘密情報らしきファイルが混ざっていたら、公開用フォルダを作らない",()=>{
  const root=repo({"js/.dev.vars":"SECRET=1"});
  try{
    assert.throws(()=>buildSite(root,join(root,"deploy")),/秘密情報/);
    assert.equal(existsSync(join(root,"deploy")),false);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("必要なファイルが無い・出力先がおかしいときは、何も消さずに止まる",()=>{
  const root=repo();
  try{
    assert.throws(()=>buildSite(root,root),/出力先/);
    assert.throws(()=>buildSite(root,join(root,"..","x")),/出力先/);
    assert.throws(()=>buildSite(root,join(root,"js")),/重なって/);
    rmSync(join(root,"privacy.html"));
    assert.throws(()=>buildSite(root,join(root,"deploy")),/privacy\.html/);
    assert.equal(existsSync(join(root,"js","main.js")),true);
  }finally{rmSync(root,{recursive:true,force:true});}
});
