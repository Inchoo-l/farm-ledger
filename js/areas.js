"use strict";
// 面積の単位（町・反・畝 ⇔ a）
/* ========== 面積の単位（町・反・畝 ⇔ a） ========== */
// 尺貫法: 1畝=30坪=約99.17㎡=約0.9917a ／ 概算: 1畝=1a（1反=10a）
const seA=()=>db.settings.unit=="approx"?1:12000/121/100;
function toTanba(a){
  let se=Math.round(a/seA()*100)/100;
  const cho=Math.floor(se/100+1e-9);se-=cho*100;
  const tan=Math.floor(se/10+1e-9);se=Math.round((se-tan*10)*100)/100;
  return{cho,tan,se};
}
function tanbaStr(a){
  if(!(a>0))return"0畝";
  const t=toTanba(a);
  return [t.cho&&t.cho+"町",t.tan&&t.tan+"反",t.se&&t.se+"畝"].filter(Boolean).join("")||"0畝";
}
function areaSync(src){
  const g=id=>document.getElementById(id);
  if(src=="a"){
    const a=parseFloat(g("ar_a").value);
    if(isNaN(a)){["cho","tan","se"].forEach(k=>g("ar_"+k).value="");return;}
    const t=toTanba(a);g("ar_cho").value=t.cho;g("ar_tan").value=t.tan;g("ar_se").value=t.se;
  }else{
    const n=k=>parseFloat(g("ar_"+k).value)||0;
    g("ar_a").value=Math.round((n("cho")*100+n("tan")*10+n("se"))*seA()*100)/100;
  }
}
