import { chromium, serve, setup, inject } from './lib.mjs';
import fs from 'node:fs';
const OUT='D:/projects/ptah-extension/.claude-worktrees/task-584/.ptah/specs/TASK_2026_584_5e7a/visual-b7';
const PARENT='11111111-1111-4111-8111-111111111111', CHILD='22222222-2222-4222-8222-222222222222', CSESS='33333333-3333-4333-8333-333333333333';
const tab=(id,title,o={})=>({id,claudeSessionId:null,name:title,title,titleOrigin:'user',order:0,status:'fresh',isDirty:false,lastActivityAt:1790867200000,messages:[],streamingState:null,attachedBinding:null,...o});
const storage=JSON.stringify({tabs:[tab(PARENT,'Parent: refactor auth'),tab('44444444-4444-4444-8444-444444444444','Notes',{order:1})],activeTabId:PARENT,version:2});
const HIST=[['m1','user','Write unit tests for the auth module.'],['m2','assistant','I added 14 tests for the auth module in the worktree and they pass.']].flatMap(([m,role,t],i)=>[
 {id:'a'+i,eventType:'message_start',timestamp:1,sessionId:CSESS,source:'history',messageId:m,role},
 {id:'b'+i,eventType:'text_delta',timestamp:2,sessionId:CSESS,source:'history',messageId:m,blockIndex:0,delta:t},
 {id:'c'+i,eventType:'message_complete',timestamp:3,sessionId:CSESS,source:'history',messageId:m}]);
const payload={tabId:CHILD,sessionId:CSESS,parentTabId:PARENT,parentSessionId:null,workspaceRoot:'C:\\ws',worktreePath:'C:\\ws\\.worktrees\\feat-agent-auth-tests',branch:'feat/agent-auth-tests',label:'Agent: add auth tests',displayPrompt:'Write unit tests for the auth module.',startedAt:Date.now()};
const fx={'chat:agent-sessions':{sessions:[payload]},'session:load':{success:true},'chat:resume':{success:true,sessionId:CSESS,events:HIST,stats:null}};
const srv=await serve('D:/tmp/vr584/after'); const b=await chromium.launch(); const res={};
for (const [theme,name] of [['dark','anubis'],['light','anubis-light']]) {
  const ctx=await b.newContext({viewport:{width:1400,height:700}});
  await setup(ctx,{theme:name,fixtures:fx});
  await ctx.addInitScript(({storage})=>{localStorage.setItem('ptah-layout-mode','single');localStorage.setItem('ptah.tabs.vr',storage);},{storage});
  const page=await ctx.newPage();
  page.on('console',m=>{ if(/AgentSession/i.test(m.text())) console.log('C',theme,m.text().slice(0,160)); });
  await page.goto(srv.url);
  await page.waitForSelector('[data-test="tab-bar-agent-badge"]',{timeout:10000});
  await page.getByRole('button',{name:'Dismiss Thoth hint'}).click({timeout:1500}).catch(()=>{});
  // diagnostic only: emulate an active workspace path (Electron-style) so findTabByIdAcrossWorkspaces resolves tabs in the active set
  res[theme+'-emulate']=await page.evaluate(()=>{const tm=window.ng.getComponent(document.querySelector('ptah-tab-bar')).tabManager; tm.workspacePartition._activeWorkspacePath.set('C:\ws'); return tm.findTabByIdAcrossWorkspaces('22222222-2222-4222-8222-222222222222')?'lookup-ok':'lookup-null';});
  await page.evaluate(()=>{window.__out.length=0; window.__log=[]; window.__t0=Math.round(performance.now());});
  await page.locator('ptah-tab-item',{hasText:'Agent: add auth tests'}).first().click();
  await page.waitForTimeout(2500);
  res[theme+'-outbound']=await page.evaluate(()=>window.__out.filter(m=>m.type==='rpc:call'&&true).map(m=>m.payload.method+' '+JSON.stringify(m.payload.params).slice(0,90)));
  res[theme+'-log']=await page.evaluate(()=>window.__log.filter(l=>l[1]==='rpc:call').map(l=>(l[0]-window.__t0)+'ms '+l[2]+' '+l[3]));
  res[theme+'-msgs']=await page.evaluate(()=>window.ng.getComponent(document.querySelector('ptah-tab-bar')).tabManager.tabs().find(t=>t.id==='22222222-2222-4222-8222-222222222222').messages.length);
  await page.screenshot({path:`${OUT}/s4b-late-${theme}-after-first-activation-workspace-active-1400.png`});
  // re-activation
  await page.evaluate(()=>{window.__out.length=0;});
  await page.locator('ptah-tab-item').first().click(); await page.waitForTimeout(400);
  await page.locator('ptah-tab-item',{hasText:'Agent: add auth tests'}).first().click(); await page.waitForTimeout(800);
  res[theme+'-reactivation']=await page.evaluate(()=>window.__out.filter(m=>m.type==='rpc:call').map(m=>m.payload.method));
  await ctx.close();
}
console.log(JSON.stringify(res,null,1)); await b.close(); srv.close();
