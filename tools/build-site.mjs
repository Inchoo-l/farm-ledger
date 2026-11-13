// 公開用フォルダ（deploy）を、今のファイルから作り直す
// 使い方：node tools/build-site.mjs
//   ・Cloudflare の Workers Builds（GitHub に送ると自動で公開する仕組み）のビルドコマンド
//   ・パソコンで公開するとき（デプロイ用フォルダを作る.ps1）も、同じこのスクリプトを使う
// 公開してよいものだけを名前で指定してコピーする（手順書・テスト・秘密情報を公開しないため）
import {cpSync,existsSync,mkdirSync,readdirSync,renameSync,rmSync,statSync} from "node:fs";
import {dirname,join,relative,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

// 公開するファイルとフォルダ（増やすときは、ここに足す）
export const SITE_FILES=["index.html","privacy.html"];
export const SITE_DIRS=["assets","css","js"];
// 秘密情報らしいファイル名（見本の .example は除く）
const SECRET_NAME=/^\.dev\.vars|^\.env/;

// フォルダの中のファイルを、下の階層まですべて並べる
function listFiles(dir){
  const out=[];
  for(const name of readdirSync(dir)){
    const p=join(dir,name);
    if(statSync(p).isDirectory())out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

// root：リポジトリのフォルダ、outDir：公開用フォルダ。コピーしたファイルの一覧（相対パス）を返す
export function buildSite(root,outDir){
  root=resolve(root);outDir=resolve(outDir);
  // 作り直すときに中身を消すので、リポジトリの外や、リポジトリそのものを出力先にさせない
  const rel=relative(root,outDir);
  if(!rel||rel.startsWith("..")||resolve(root,rel)!==outDir)throw new Error(`出力先は、リポジトリの中の別のフォルダにしてください：${outDir}`);
  if([...SITE_FILES,...SITE_DIRS].some(n=>rel.split(/[\\/]/)[0]===n))throw new Error(`出力先が、公開するフォルダと重なっています：${outDir}`);
  for(const n of [...SITE_FILES,...SITE_DIRS]){
    if(!existsSync(join(root,n)))throw new Error(`公開に必要なものが見つかりません：${n}`);
  }
  // 以前の方式では deploy の中に wrangler.jsonc を置いていた。消す前に、外へ退避しておく
  const oldConf=join(outDir,"wrangler.jsonc");
  let moved="";
  if(existsSync(oldConf)){
    moved=join(root,"wrangler.old.jsonc");
    renameSync(oldConf,moved);
  }
  // いったん空にして、必要なものだけをコピーする（古いファイルが残らないように）
  rmSync(outDir,{recursive:true,force:true});
  mkdirSync(outDir,{recursive:true});
  for(const f of SITE_FILES)cpSync(join(root,f),join(outDir,f));
  for(const d of SITE_DIRS)cpSync(join(root,d),join(outDir,d),{recursive:true});
  // 念のため、秘密情報が紛れ込んでいないか確かめる
  const files=listFiles(outDir).map(p=>relative(outDir,p).replace(/\\/g,"/"));
  const bad=files.filter(p=>{const n=p.split("/").pop();return SECRET_NAME.test(n)&&!/example$/.test(n);});
  if(bad.length){
    rmSync(outDir,{recursive:true,force:true});
    throw new Error(`秘密情報らしきファイルが入っています：${bad.join(", ")}`);
  }
  return{files:files.sort(),moved};
}

// コマンドとして実行されたときだけ動かす（テストから読み込んだときは動かさない）
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
    const r=buildSite(root,join(root,"deploy"));
    console.log(`deploy フォルダを作りました（${r.files.length} ファイル）`);
    if(r.moved)console.log(`以前の設定を ${relative(root,r.moved)} に移しました。中身を変えていた場合は、リポジトリ直下の wrangler.jsonc に写してください`);
  }catch(e){
    console.error(`失敗しました：${e.message}`);
    process.exit(1);
  }
}
