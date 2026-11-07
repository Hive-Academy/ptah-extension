# @ptah-extension/review-contracts

Shared schemas and ports for the pull-request review feature: review config, findings, runs, the
review RPC messages (`src/lib/review-*.schema.ts`) and the GitHub port (`src/lib/github-review.port.ts`).
Tagged `scope:shared`, `type:util`, so backend and frontend libs may import it.

```bash
npm run verify -- -p review-contracts
```
