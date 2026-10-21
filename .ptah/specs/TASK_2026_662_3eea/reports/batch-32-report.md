## Changed lines

- `libs/backend/vscode-core/src/messaging/rpc-handler.ts:82`: replaced the obsolete pipeline method comment with retained Skills Library methods; kept the `skillSynthesis:` prefix.

## Removed vs kept methods

| Removed | Kept |
| --- | --- |
| Obsolete names in the prefix comment: `listCandidates`, `getCandidate`, `promote`, `reject`, `invocations`, `stats`. | `skillSynthesis:` namespace and Library method names in its comment: `listClones`, `getClone`, `saveCloneBody`, `invocationStats`, `scorecards`, `models`, `telemetry`. |
| No dispatch entries: this handler routes registered methods through a Map and contains no method-specific dispatch table. | All runtime routing and exports. |

## Post-cut grep

- Scoped search of `rpc-handler.ts` for the obsolete method names found zero hits after the edit. The broader search returned only the retained `skillSynthesis:` Library comment and an unrelated `memory:` curator comment.
- File has LF line endings. Scoped `ptah_get_diagnostics` reported zero errors and zero warnings. Nx/Jest/typecheck were not run, per the batch instruction.

## Decisions

- Kept `skillSynthesis:` because it is the namespace used by the Library; the prefix whitelist does not name individual RPC methods. This is reversible by editing the comment.
- Kept all routing code and exports because the file has no obsolete method-specific dispatch entries. This is reversible if a later consumer cut changes the contract.

## Proposed Removals

- None in this file.
