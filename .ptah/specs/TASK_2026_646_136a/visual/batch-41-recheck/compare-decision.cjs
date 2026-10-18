const fs=require('fs');
const v40='batch-40-recheck',v41='batch-41-recheck/decision';
for (const sc of ['default','ollama-unreachable']) {
  const a=JSON.parse(fs.readFileSync(`${v40}/recheck-decision-metrics-${sc}.json`)), b=JSON.parse(fs.readFileSync(`${v41}/b41-decision-metrics-${sc}.json`));
  console.log('==',sc,'records',a.length,b.length);
  for (let i=0;i<Math.max(a.length,b.length);i++){
    const x=a[i],y=b[i]; if(!x||!y){console.log('missing',i);continue;}
    const key=`${y.theme}/${y.width}`;
    const sameText=x.cardText===y.cardText;
    const ma=x.measure||[],mb=y.measure||[];
    const ratiosEq = ma.length===mb.length && ma.every((m,j)=>m.ratio===mb[j].ratio && m.fg===mb[j].fg && m.bg===mb[j].bg);
    const minA=Math.min(...ma.filter(m=>m.kind==='text'||m.kind==='control-text').map(m=>m.ratio)), minB=Math.min(...mb.filter(m=>m.kind==='text'||m.kind==='control-text').map(m=>m.ratio));
    console.log(key,'textEq',sameText,'measureEq',ratiosEq,`n=${ma.length}/${mb.length}`,'minRatio',minA,minB,'overflow',JSON.stringify(x.overflow)===JSON.stringify(y.overflow));
    if(!sameText) console.log('  A:',JSON.stringify(x.cardText).slice(0,300),'\n  B:',JSON.stringify(y.cardText).slice(0,300));
    if(!ratiosEq){ma.forEach((m,j)=>{const n=mb[j]; if(!n||m.ratio!==n.ratio||m.fg!==n.fg||m.bg!==n.bg) console.log('  diff',j,JSON.stringify(m).slice(0,160),JSON.stringify(n).slice(0,160));});}
  }
}
// byte compare of card PNGs
const crypto=require('crypto');const h=(p)=>crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
for (const sc of ['default','ollama-unreachable']) for (const t of ['dark','light']) for (const st of ['card','section']) {
  const a=`${v40}/recheck-decision-${sc}-${st}-${t}.png`,b=`${v41}/b41-decision-${sc}-${st}-${t}.png`;
  if(fs.existsSync(a)&&fs.existsSync(b)) console.log(sc,st,t,'identical bytes:',h(a)===h(b),fs.statSync(a).size,fs.statSync(b).size);
}
