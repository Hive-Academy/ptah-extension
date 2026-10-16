const path=require('path');const sharp=require('D:/projects/ptah-extension/node_modules/sharp');
(async()=>{for(const th of['dark','light']){
 const a=path.join('batch-22-after',`after-decision-default-section-${th}.png`), b=path.join('batch-40-recheck',`recheck-decision-default-section-${th}.png`);
 const ma=await sharp(a).metadata(), mb=await sharp(b).metadata();
 const r={left:0,top:60,width:Math.min(ma.width,mb.width),height:235};
 const A=await sharp(a).extract(r).raw().toBuffer({resolveWithObject:true});const B=await sharp(b).extract(r).raw().toBuffer({resolveWithObject:true});
 let n=0,mx=0;const ch=A.info.channels;for(let i=0;i<A.data.length;i+=ch){const d=Math.max(...[0,1,2].map(k=>Math.abs(A.data[i+k]-B.data[i+k])));if(d>0)n++;if(d>mx)mx=d;}
 console.log(th,'sizes',ma.width+'x'+ma.height,mb.width+'x'+mb.height,'six rows region diff px',n,'of',A.info.width*A.info.height,'max delta',mx);
 // full card compare sizes
 for (const s of ['default','ollama-unreachable','ollama-unsupported','ollama-ready','jev-nokey']){
   try{const x=await sharp(path.join('batch-22-after',`after-decision-${s}-card-${th}.png`)).metadata();const y=await sharp(path.join('batch-40-recheck',`recheck-decision-${s}-card-${th}.png`)).metadata();console.log(' card',s,th,x.width+'x'+x.height,'->',y.width+'x'+y.height);}catch(e){console.log(' card',s,th,'n/a')}
 }
}})();
