const fs = require('fs');
const path = require('path');
const {chromium} = require(require.resolve('playwright', {paths:['D:/projects/ptah-extension/node_modules']}));
(async()=>{
  const root=__dirname, out=path.join(root,'screenshots'); fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({headless:true});
  const cases=[['dark-start','dark','start',1440],['light-start','light','start',1440],['dark-idle','dark','idle',1440],['light-idle','light','idle',1440],['dark-speaking','dark','speaking',1440],['light-speaking','light','speaking',1440],['dark-approval','dark','approval',1440],['light-approval','light','approval',1440],['dark-question','dark','question',1440],['light-question','light','question',1440],['dark-24-nodes','dark','24-nodes',1440],['light-24-nodes','light','24-nodes',1440],['dark-child-session','dark','child-session',1440],['light-child-session','light','child-session',1440],['dark-narrow','dark','approval',900],['light-narrow','light','approval',900],['dark-tribunal-confirm','dark','tribunal-confirm',1440],['dark-480','dark','approval',480],['light-480','light','approval',480]];
  const fontBaseline=new Map(), heightByWidth=new Map();
  for(const [name,theme,state,width] of cases){
    const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1,reducedMotion:'reduce'});
    page.on('pageerror',e=>{throw e});
    await page.goto('file:///'+path.join(root,'command-center.html').replace(/\\/g,'/'));
    await page.evaluate(({theme,state})=>{window.commandCenter.theme(theme);window.commandCenter.preview(state)}, {theme,state});
    await page.evaluate(()=>document.fonts.ready);
    await page.waitForTimeout(120);
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const {root:documentNode}=await cdp.send('DOM.getDocument');
    for(const selector of ['h1','.eyebrow','#contextChip']){
      const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:documentNode.nodeId,selector});
      const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});
      const signature=fonts.map(font=>font.postScriptName).join(',');
      if(!signature) throw new Error(name+': no rendered font for '+selector);
      if(fontBaseline.has(selector)&&fontBaseline.get(selector)!==signature) throw new Error(name+': font changed for '+selector+' from '+fontBaseline.get(selector)+' to '+signature);
      fontBaseline.set(selector,signature);
    }
    await cdp.detach();
    const png=await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
    const capturedWidth=png.readUInt32BE(16), capturedHeight=png.readUInt32BE(20);
    if(capturedWidth!==width||width===1440&&capturedHeight!==900) throw new Error(name+': unexpected PNG size '+capturedWidth+'x'+capturedHeight);
    if(heightByWidth.has(width)&&heightByWidth.get(width)!==capturedHeight) throw new Error(name+': height differs from other '+width+'px captures');
    heightByWidth.set(width,capturedHeight);
    console.log(name+'.png');
    await page.close();
  }
  console.log('Verified '+cases.length+' capture sizes and rendered fonts:',Object.fromEntries(fontBaseline));
  await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1});
