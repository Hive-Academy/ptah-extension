import { chromium, serve, setup } from './lib.mjs';
import fs from 'node:fs';
const OUT='D:/projects/ptah-extension/.claude-worktrees/task-584/.ptah/specs/TASK_2026_584_5e7a/visual-b7/r1';
const PARENT='11111111-1111-4111-8111-111111111111', CHILD='22222222-2222-4222-8222-222222222222', CSESS='33333333-3333-4333-8333-333333333333';
const tab=(id,title,o={})=>({id,claudeSessionId:null,name:title,title,titleOrigin:'user',order:0,status:'fresh',isDirty:false,lastActivityAt:1790867200000,messages:[],streamingState:null,attachedBinding:null,...o});
const BS=String.fromCharCode(92);
const tabs=[tab(PARENT,'Parent: refactor auth'),tab(CHILD,'Agent: add auth tests',{order:1,status:'loaded',claudeSessionId:CSESS,agentOrigin:{parentTabId:PARENT,parentSessionId:null,label:'Child',branch:'feat/agent-auth-tests',worktreePath:['C:','ws','.worktrees','feat-agent-auth-tests'].join(BS),startedAt:1}}),tab('44444444-4444-4444-8444-444444444444','Notes',{order:2})];
const storage=JSON.stringify({tabs,activeTabId:PARENT,version:2});
const srv=await serve('D:/tmp/vr584/after'); const b=await chromium.launch(); const res={};
for (const [theme,name] of [['dark','anubis'],['light','anubis-light']]) {
  const ctx=await b.newContext({viewport:{width:1400,height:700}});
  await setup(ctx,{theme:name,fixtures:{'chat:agent-sessions':{sessions:[]}}});
  await ctx.addInitScript(({storage})=>{localStorage.setItem('ptah-layout-mode','single');localStorage.setItem('ptah.tabs.vr',storage);},{storage});
  const page=await ctx.newPage();
  await page.goto(srv.url); await page.waitForSelector('ptah-tab-item'); await page.waitForTimeout(1500);
  await page.getByRole('button',{name:'Dismiss Thoth hint'}).click({timeout:1500}).catch(()=>{});
  await page.evaluate(()=>document.activeElement.blur());
  for(let i=0;i<30;i++){ await page.keyboard.press('Tab'); const dt=await page.evaluate(()=>document.activeElement.getAttribute('data-test')); if(dt==='tab-bar-agent-badge')break; }
  await page.waitForTimeout(400);
  res[theme]=await page.evaluate(()=>{const e=document.activeElement;const cs=getComputedStyle(e);const cv=document.createElement('canvas');cv.width=cv.height=1;const cx=cv.getContext('2d',{willReadFrequently:true});const px=f=>{cx.clearRect(0,0,1,1);for(const c of f){cx.fillStyle=c;cx.fillRect(0,0,1,1);}const d=cx.getImageData(0,0,1,1).data;return[d[0],d[1],d[2]]};const lum=([r,g,b])=>{const f=c=>{c/=255;return c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4)};return .2126*f(r)+.7152*f(g)+.0722*f(b)};const ch=[];for(let x=e.parentElement;x;x=x.parentElement)ch.unshift(getComputedStyle(x).backgroundColor);const c2=ch.filter(c=>c!=='rgba(0, 0, 0, 0)');const bg=px(c2);const ring=px([...c2,cs.outlineColor]);const[p,q]=[lum(ring),lum(bg)].sort((m,n)=>n-m);
    const t=document.querySelector('[data-test="tab-bar-agent-badge-tooltip"]');
    return {focused:e.getAttribute('data-test'),outline:cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor,offset:cs.outlineOffset,boxShadow:cs.boxShadow,ringContrast:+((p+.05)/(q+.05)).toFixed(2),tooltipShown:!!t,describedby:e.getAttribute('aria-describedby')}});
  const box=await page.locator('[data-test="tab-bar-agent-badge"]').boundingBox();
  await page.screenshot({path:`${OUT}/s5-focus-badge-${theme}-tab-key-1400.png`,clip:{x:Math.max(0,box.x-160),y:0,width:520,height:150}});
  await ctx.close();
}
console.log(JSON.stringify(res,null,1)); await b.close(); srv.close();
