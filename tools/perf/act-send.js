// Send a prompt into the only visible composer: the baseline read-only prompt
// (3 parallel sub-agents), or the text of PTAH_PROMPT_FILE. Open and name a
// fresh session first; never use this on an existing session.
const fs = require('node:fs');
const BASELINE = `Performance test. Read only. Do not edit, create, delete or move any file. Do not run git, network, build or install commands. Use the Task tool to start 3 sub-agents in parallel, and use only Glob, Grep and Read. Agent 1: find the 5 largest TypeScript files. Agent 2: count TODO comments per top-level folder. Agent 3: list the scripts in the root package.json. When all 3 finish, reply with one short table per agent.`;
const PROMPT = process.env.PTAH_PROMPT_FILE
  ? fs.readFileSync(process.env.PTAH_PROMPT_FILE, 'utf8').trim()
  : BASELINE;
module.exports = async (page) => {
  const boxes = page.locator('ptah-chat-input textarea:visible');
  const n = await boxes.count();
  if (n !== 1)
    throw new Error(`expected exactly 1 visible composer, found ${n}`);
  await boxes.first().click();
  await boxes.first().fill(PROMPT);
  await boxes.first().press('Enter');
  console.error('prompt sent');
};
