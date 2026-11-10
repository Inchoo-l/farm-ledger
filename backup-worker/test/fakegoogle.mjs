// Google（トークン発行＋ドライブ API）を模した小さな HTTP サーバー。本物の通信コード（drive.js）の確認と、wrangler dev での動作確認に使う "use strict";
import http from "node:http";
export const FOLDER="application/vnd.google-apps.folder";

export function startFakeGoogle({port=0}={}){
  const st={files:new Map(),seq:1,tokens:0,validToken:null,log:[],fail:[],badRefresh:false,clock:Date.parse("2026-11-01T00:00:00Z")};
  const now=()=>new Date(st.clock+=1000).toISOString();
  const add=(o)=>{const id="g"+st.seq++;const f={id,name:o.name,parents:o.parents||[],mime:o.mime||"application/json",text:o.text||"",trashed:false,modifiedTime:now()};st.files.set(id,f);return f;};
  const unq=s=>s.replace(/\\(.)/g,"$1");
  const meta=(f,fields)=>{const m={id:f.id,name:f.name,modifiedTime:f.modifiedTime,size:String(Buffer.byteLength(f.text))};return m;};
  const send=(res,code,obj)=>{const b=typeof obj==="string"?obj:JSON.stringify(obj);res.writeHead(code,{"Content-Type":typeof obj==="string"?"text/plain; charset=utf-8":"application/json"});res.end(b);};
  const srv=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    const body=Buffer.concat(chunks).toString("utf8");
    const u=new URL(req.url,"http://x"),p=u.pathname;
    st.log.push(req.method+" "+p+(u.search?"?"+u.searchParams.get("uploadType")||"":""));
    // 指定した回数だけ失敗させる（再試行の確認用）
    const fi=st.fail.findIndex(x=>x.path.test(p));
    if(fi>=0){const x=st.fail[fi];if(x.n-->0){if(x.n<=0)st.fail.splice(fi,1);return send(res,x.code,x.body||{error:{message:"fake failure"}});}}
    if(p==="/token"){
      const f=new URLSearchParams(body);
      if(st.badRefresh||f.get("refresh_token")==="bad")return send(res,400,{error:"invalid_grant",error_description:"Token has been expired or revoked."});
      if(f.get("client_id")==="wrong")return send(res,401,{error:"invalid_client"});
      st.tokens++;st.validToken="AT"+st.tokens;
      return send(res,200,{access_token:st.validToken,expires_in:3600,token_type:"Bearer"});
    }
    if((req.headers.authorization||"")!=="Bearer "+st.validToken)return send(res,401,{error:{message:"Invalid Credentials"}});
    if(st.driveDisabled)return send(res,403,{error:{message:"Google Drive API has not been used in project 123 before or it is disabled."}});
    if(req.method==="GET"&&p==="/drive/v3/files"){
      const q=u.searchParams.get("q")||"";let m,out=[];
      const live=[...st.files.values()].filter(f=>!f.trashed).sort((a,b)=>a.modifiedTime<b.modifiedTime?1:-1);
      if(m=/^name='((?:[^'\\]|\\.)*)' and trashed=false and mimeType!='([^']*)'$/.exec(q))out=live.filter(f=>f.name===unq(m[1])&&f.mime!==m[2]);
      else if(m=/^name='((?:[^'\\]|\\.)*)' and mimeType='([^']*)' and trashed=false$/.exec(q))out=live.filter(f=>f.name===unq(m[1])&&f.mime===m[2]);
      else if(m=/^'((?:[^'\\]|\\.)*)' in parents and trashed=false$/.exec(q))out=live.filter(f=>f.parents.includes(unq(m[1])));
      else return send(res,400,{error:{message:"unsupported q: "+q}});
      return send(res,200,{files:out.map(f=>meta(f))});
    }
    let m;
    if(req.method==="GET"&&(m=/^\/drive\/v3\/files\/([^/]+)$/.exec(p))){
      const f=st.files.get(decodeURIComponent(m[1]));if(!f||f.trashed)return send(res,404,{error:{message:"File not found"}});
      if(u.searchParams.get("alt")==="media")return send(res,200,f.text);
      return send(res,200,meta(f));
    }
    if(req.method==="POST"&&p==="/drive/v3/files"){const j=JSON.parse(body);const f=add({name:j.name,mime:j.mimeType});return send(res,200,meta(f));}
    if(req.method==="POST"&&p==="/upload/drive/v3/files"){
      const bd=/boundary=(.+)$/.exec(req.headers["content-type"]||"")[1];
      const parts=body.split("--"+bd).slice(1,-1).map(s=>s.replace(/^\r\n/,"").replace(/\r\n$/,""));
      const md=JSON.parse(parts[0].split("\r\n\r\n").slice(1).join("\r\n\r\n"));
      const text=parts[1].split("\r\n\r\n").slice(1).join("\r\n\r\n");
      const f=add({name:md.name,parents:md.parents,text,mime:md.mimeType});return send(res,200,meta(f));
    }
    if(req.method==="PATCH"&&(m=/^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(p))){const f=st.files.get(decodeURIComponent(m[1]));if(!f)return send(res,404,{error:{message:"File not found"}});f.text=body;f.modifiedTime=now();return send(res,200,meta(f));}
    if(req.method==="PATCH"&&(m=/^\/drive\/v3\/files\/([^/]+)$/.exec(p))){const f=st.files.get(decodeURIComponent(m[1]));if(!f)return send(res,404,{error:{message:"File not found"}});const j=JSON.parse(body);if(j.trashed)f.trashed=true;return send(res,200,{id:f.id});}
    return send(res,404,{error:{message:"no route "+req.method+" "+p}});
  });
  return new Promise(r=>srv.listen(port,"127.0.0.1",()=>{
    const url="http://127.0.0.1:"+srv.address().port;
    r({st,url,close:()=>new Promise(x=>srv.close(x)),add,
      env:()=>({GOOGLE_TOKEN_URL:url+"/token",GOOGLE_DRIVE_API:url+"/drive/v3",GOOGLE_UPLOAD_API:url+"/upload/drive/v3",GOOGLE_CLIENT_ID:"cid",GOOGLE_CLIENT_SECRET:"sec",GOOGLE_REFRESH_TOKEN:"rt"}),
      live:()=>[...st.files.values()].filter(f=>!f.trashed),
      folderNames:()=>{const fo=[...st.files.values()].find(f=>f.mime===FOLDER&&!f.trashed);return fo?[...st.files.values()].filter(f=>!f.trashed&&f.parents.includes(fo.id)).map(f=>f.name).sort():[];}});
  }));
}