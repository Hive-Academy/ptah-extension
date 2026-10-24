import path from 'node:path';

export default {
  // Single glob with function form: runs format + lint ONCE, never chunked.
  // Prevents lint-staged from spawning parallel nx processes that OOM.
  '*.{ts,js,json,md}': (files) => {
    const cmds = [`npx nx format:write --files=${files.join(',')}`];
    // Only lint TS/JS files (skip JSON/MD)
    const tsFiles = files.filter((f) => /\.[tj]sx?$/.test(f));
    if (tsFiles.length > 0) {
      // --files: lint the tasks the staged TS/JS files affect, not every task the
      // branch diff affects. Without it a branch that changes nx.json lints
      // all ~80 projects on every commit, and fails on lint debt elsewhere.
      // A heavy check: it queues on the machine-wide verify lock
      // (scripts/verify-lock.mjs) like `npm run verify` and the pre-push hook.
      const staged = tsFiles
        .map((f) => path.relative(process.cwd(), f).split(path.sep).join('/'))
        .join(',');
      cmds.push(
        `node scripts/verify.mjs --exec --task lint-staged -- npx nx affected --target=lint --files=${staged} --max-warnings=-1`,
      );
    }
    return cmds;
  },
};
