// Synthetic arithmetic probe; not an Electron/session reproduction.
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('D:/projects/ptah-extension/node_modules/typescript');
const sourcePath = 'D:/projects/ptah-extension/libs/shared/src/lib/utils/subagent-cost.utils.ts';
const js = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const probeExports = {};
vm.runInNewContext(js, { exports: probeExports }, { filename: sourcePath });
const messages = [
  { role: 'assistant', tokens: { input: 1000, output: 1000, cacheRead: 2000000 }, cost: 1.11, duration: 294000 },
  { role: 'assistant', tokens: { input: 100, output: 3000, cacheRead: 1794900 }, cost: 1.44, duration: 67000 },
];
const summary = probeExports.calculateSessionCostSummary(messages);
console.log(JSON.stringify({
  kind: 'SYNTHETIC: chosen fixtures, no session, no agents, not original payloads',
  sourcePath,
  headerTokens: summary.totalTokens.input + summary.totalTokens.cacheRead + summary.totalTokens.output,
  headerCost: summary.totalCost,
  headerDurationMs: summary.totalDuration,
  footerTokens: messages[1].tokens.input + messages[1].tokens.output,
  footerCost: messages[1].cost,
  footerDurationMs: messages[1].duration,
  agentCount: summary.agentCount,
}, null, 2));
