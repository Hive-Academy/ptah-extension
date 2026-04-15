export default {
  // Single glob with function form: runs format + lint ONCE, never chunked.
  // Prevents lint-staged from spawning parallel nx processes that OOM.
  '*.{ts,js,json,md}': (files) => {
    const cmds = [`npx nx format:write --files=${files.join(',')}`];
    // Only lint TS/JS files (skip JSON/MD)
    const tsFiles = files.filter((f) => /\.[tj]sx?$/.test(f));
    if (tsFiles.length > 0) {
      cmds.push(
        'npx nx affected --target=lint --fix=true --max-warnings=-1',
      );
    }
    return cmds;
  },
};
