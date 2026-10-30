import {query} from '/home/amun/ptah-extension/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=path.dirname(new URL(import.meta.url).pathname);
const deny=['Workflow','ReportFindings','PushNotification','DesignSync','EnterWorktree','ExitWorktree'];
const off=['keybindings-help','update-config','fewer-permission-prompts','plugin-authoring','init','workflow-authoring','code-review'];
const env={...process.env};
for(const k of Object.keys(env)) if(k.startsWith('CLAUDE_CODE_')||['CLAUDECODE','CLAUDE_PID','CLAUDE_AGENT_SDK_VERSION'].includes(k)) delete env[k];
const exe=process.env.CLAUDE_CODE_EXECPATH;
const log=[]; let observedCalls=0;
const walk=(dir)=>fs.existsSync(dir)?fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]):[];
for(const name of ['baseline','denied']) {
 const dir=path.join(root,name);fs.mkdirSync(path.join(dir,'config'),{recursive:true});fs.mkdirSync(path.join(dir,'tmp'),{recursive:true});fs.mkdirSync(path.join(dir,'workspace'),{recursive:true});
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),180000);
 const options={cwd:path.join(dir,'workspace'),pathToClaudeCodeExecutable:exe,env:{...env,CLAUDE_CONFIG_DIR:path.join(dir,'config'),TMPDIR:path.join(dir,'tmp')},settingSources:[],persistSession:true,includePartialMessages:true,maxTurns:name==='baseline'?1:6,maxBudgetUsd:2,abortController:controller,tools:{type:'preset',preset:'claude_code'},settings:{disableClaudeAiConnectors:true,...(name==='denied'?{skillOverrides:Object.fromEntries([...off,'anthropic-skills:a0-nonexistent-897f'].map(n=>[n,'off']))}:{})},...(name==='denied'?{disallowedTools:deny,agents:{'a0-generated':{description:'A0 generated tool inheritance probe',prompt:'Reply A0_GENERATED_OK only. Do not use tools.',model:'inherit',maxTurns:1}}}:{}),canUseTool:async(tool,input)=>tool==='Agent'?{behavior:'allow',updatedInput:input}:{behavior:'deny',message:'A0 fixture permits Agent only; no tool side effects.'},spawnClaudeCodeProcess:(o)=>spawn('/usr/bin/bwrap',['--ro-bind','/','/','--bind',root,root,'--bind',path.join(dir,'tmp'),'/tmp','--dev','/dev','--proc','/proc','--unshare-pid','--die-with-parent','--chdir',o.cwd,o.command,...o.args],{cwd:o.cwd,env:o.env,stdio:['pipe','pipe','pipe'],signal:o.signal})};
 log.push({case:name,options:{settingSources:[],disallowedTools:options.disallowedTools??[],skillOverrides:options.settings.skillOverrides??{},isolatedConfig:true,readOnlyRoot:true,model:'existing route default'}});
 try {
 const q=query({prompt:name==='baseline'?'Reply A0_BASELINE_OK only. Do not use tools.':'Call Agent twice, once subagent_type a0-generated and once subagent_type general-purpose. Each task: Reply A0_CHILD_OK only, do not use tools. Wait for both and reply A0_PARENT_OK. Do not call any other tools.',options});
 for await(const m of q){
 if(m.type==='system'&&m.subtype==='init')log.push({case:name,type:'init',tools:m.tools,agents:m.agents,skills:m.skills,slash_commands:m.slash_commands,model:m.model});
 if(m.type==='stream_event'&&m.event?.type==='message_start'){observedCalls++;log.push({case:name,type:'message_start',parent_tool_use_id:m.parent_tool_use_id??null});}
 if(m.type==='assistant')log.push({case:name,type:'assistant',parent_tool_use_id:m.parent_tool_use_id??null,blocks:m.message.content.filter(b=>b.type==='text'||b.type==='tool_use').map(b=>b.type==='tool_use'?{type:b.type,name:b.name,subagent_type:b.input?.subagent_type}:{type:b.type,text:/^A0_[A-Z_\s]+$/.test(b.text.trim())?b.text:'[non-marker assistant text omitted]'})});
 if(m.type==='result')log.push({case:name,type:'result',subtype:m.subtype,num_turns:m.num_turns,total_cost_usd:m.total_cost_usd,is_error:m.is_error});
 if(m.type==='system'&&m.subtype==='startup_failure')log.push({case:name,type:'startup_failure',reason:m.reason});
 }
 }catch(e){log.push({case:name,type:'exception',name:e.name,message:'Runtime query failed; raw diagnostic not exported'});}finally{clearTimeout(timer);}
 const shapes=[];
 for(const file of walk(path.join(dir,'config')).filter(f=>f.endsWith('.jsonl')))for(const line of fs.readFileSync(file,'utf8').split('\n')){try{const row=JSON.parse(line);if(row.type==='api-request-shape') shapes.push({relativeFile:path.relative(dir,file),record:row});}catch{}}
 // Shape records contain structure/length metadata, not private prompt bodies. Export only tool metadata and top-level shape keys below.
 fs.writeFileSync(path.join(root,`${name}-shape-inventory.json`),JSON.stringify(shapes.map(s=>({relativeFile:s.relativeFile,keys:Object.keys(s.record),shape:Object.fromEntries(Object.entries(s.record).filter(([k])=>/tool|model|agent|skill|length|size|count/i.test(k)))})),null,2));
 fs.writeFileSync(path.join(root,'sanitized-stream.json'),JSON.stringify({observedMessageStarts:observedCalls,events:log},null,2));
 console.log(JSON.stringify({case:name,shapeRecords:shapes.length,observedMessageStarts:observedCalls,result:log.filter(x=>x.case===name&&['result','exception','startup_failure'].includes(x.type))}));
}
