const WT='D:/projects/ptah-extension/.claude-worktrees/chat-message-stagger';
const { _electron } = require(WT+'/node_modules/playwright');
const fs=require('fs');
const UDD=process.env.TEMP+'/ptah-stagger-udd', DB=process.env.TEMP+'/ptah-stagger-db/ptah.sqlite';
const OUT=WT+'/.ptah/specs/TASK_2026_858_c7a2/visual-review';
async function goChat(page){ for(let i=0;i<8;i++){ await page.getByRole('button',{name:'Chat',exact:true}).first().click().catch(()=>{}); await page.waitForTimeout(1500); const ok=await page.evaluate(()=>!document.querySelector('[aria-label="Back to Chat"]') && /previous sessions/i.test(document.body.innerText)); if(ok) return true;} return false; }
async function launch(reduceFlag=true, extra=[]){
  const env={...process.env,NODE_ENV:'test',PTAH_E2E:'1',PTAH_DB_PATH:DB}; delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({args:[process.env.TEMP+'/ptah-stagger-app/main.mjs','--user-data-dir='+UDD,'D:/projects/ptah-extension',...(reduceFlag?['--force-prefers-no-reduced-motion']:[]),'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-features=CalculateNativeWinOcclusion',...extra],env,timeout:60000});
  const page=await app.firstWindow();
  await page.waitForURL(u=>u.protocol==='file:'&&u.pathname.endsWith('/renderer/index.html'),{timeout:60000});
  await page.waitForFunction(()=>/previous sessions/i.test(document.body.innerText),null,{timeout:60000}).catch(()=>console.log("WARN no home")); await page.waitForTimeout(2500);
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0]; w.setSize(1186,780); w.setAlwaysOnTop(true); w.show(); w.focus();}); await page.waitForTimeout(1200);
  return {app,page};
}
module.exports={launch,goChat,OUT,WT,UDD};
