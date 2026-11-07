# @ptah-extension/thoth-shell

Angular library that provides the Thoth hub shell, a four-tab container for the agentic platform
features in the renderer. The tab ids are `memory`, `skills`, `cron` and `gateway`
(`THOTH_TAB_IDS` in `src/lib/components/thoth-shell.component.ts`), routed as `/thoth/:tab`
(`THOTH_ROUTES`). The tab content comes from the `*-ui` feature libraries.

```bash
npm run verify -- -p thoth-shell
```
