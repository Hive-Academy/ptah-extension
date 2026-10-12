// Open a new session and send a read-only prompt that starts 3 sub-agents.
const PROMPT = `Performance test. Read only. Do not edit, create, delete or move any file. Do not run git, network, build or install commands. Use the Task tool to start 3 sub-agents in parallel, and use only Glob, Grep and Read. Agent 1: find the 5 largest TypeScript files. Agent 2: count TODO comments per top-level folder. Agent 3: list the scripts in the root package.json. When all 3 finish, reply with one short table per agent.`;
module.exports = async (page) => {
  const before = await page.locator('ptah-chat-input textarea:visible').count();
  await page.getByText('New Session', { exact: false }).first().click();
  await page.waitForTimeout(2000);
  const boxes = page.locator('ptah-chat-input textarea:visible');
  const n = await boxes.count();
  const box = boxes.nth(n - 1);
  console.error(`textareas ${before} -> ${n}`);
  await box.click();
  await box.fill(PROMPT);
  await box.press('Enter');
  console.error('prompt sent');
};
