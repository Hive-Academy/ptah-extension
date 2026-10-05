# AF5a report

Implemented the AF5.2, AF5.4, and AF5.5 hardening changes.

## Files

- `libs/shared/src/lib/types/execution/schemas.ts` — accepts optional `isError`.
- `libs/shared/src/lib/types/execution/schemas.spec.ts` — verifies parsed nodes retain both `isError: true` and `isError: false`.
- `scripts/generate-host-source-registry-baseline.ts` — regenerates sorted RPC and message baseline arrays.
- `libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts` — header now points to the generator and retains the Gate 2 exception requirement.
- `libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts` — pins both additions and removals for host-source-pattern names.

## Regeneration check

Ran `npx tsx scripts/generate-host-source-registry-baseline.ts`. The baseline diff stat is `1 file changed, 2 insertions(+), 1 deletion(-)` (`2\t1`), confirming only the three-line header changed and both generated arrays are byte-identical to their prior contents.

## Verification

`git diff --check` completed with no whitespace errors for all requested source files.

Launched `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared --parallel=1`. Its single 60-second completion check had not completed and emitted no target output, so no typecheck, test-suite/test-case, or lint counts were observed. The scoped diagnostics service also remained unavailable after 45 seconds while its TypeScript check continued; it reported 5 files unchecked.
