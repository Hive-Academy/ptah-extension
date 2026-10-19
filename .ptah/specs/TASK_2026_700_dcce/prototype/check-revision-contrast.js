const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: ['D:/projects/ptah-extension/node_modules'] }));
(async () => {
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto('file:///' + path.join(__dirname, 'command-center.html').replace(/\\/g,'/'));
  for (const theme of ['dark','light']) {
    for (const state of ['approval','child-session']) {
    const result = await page.evaluate(({theme,state}) => {
      window.commandCenter.theme(theme); window.commandCenter.preview(state);
      const rgba = value => {const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.clearRect(0,0,1,1);x.fillStyle=value;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data]};
      const under = el => {let color=[255,255,255,255];for(let node=document.body;node;node=node.parentElement){const bg=getComputedStyle(node).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)'){color=rgba(bg);break}}const layers=[];for(let node=el;node;node=node.parentElement)layers.push(rgba(getComputedStyle(node).backgroundColor));for(const layer of layers.reverse()){const a=layer[3]/255;color=[0,1,2].map(i=>Math.round(layer[i]*a+color[i]*(1-a))).concat(255)}return color};
      const lum=a=>[0,1,2].reduce((sum,i)=>{let v=a[i]/255;v=v<=.04045?v/12.92:((v+.055)/1.055)**2.4;return sum+v*[.2126,.7152,.0722][i]},0);
      const selectors=['.node-label.root .meta','.node-label.root .plate-context','.node-label:not(.root) .meta','.overflow-chip','.panel-kicker','.detail-info','.work-row .row-sub','.stat-label',...(state==='approval'?['.approve']:['.node-label.child .meta','.node-label.child.unknown .meta','.child-tab-state'])];
      const pairs=selectors.map(selector=>{let el=document.querySelector(selector);if(!el)return{selector,missing:true};let fg=rgba(getComputedStyle(el).color),bg=under(el),a=lum(fg),b=lum(bg);return{selector,foreground:fg.slice(0,3),background:bg.slice(0,3),ratio:+((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toFixed(2)}});
      {const fg=rgba(theme==='dark'?'#898ba5':'#777a91'),bg=rgba(getComputedStyle(document.querySelector('.stage')).backgroundColor),a=lum(fg),b=lum(bg);pairs.push({selector:'child silver ring / stage',foreground:fg.slice(0,3),background:bg.slice(0,3),ratio:+((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toFixed(2)});}
      return {theme,state,pairs};
    },{theme,state});
    console.log(JSON.stringify(result));
    }
  }
  await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1});
