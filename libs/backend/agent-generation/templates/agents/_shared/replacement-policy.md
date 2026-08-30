## Replace, do not accumulate

This governs the code you write, and the changes you plan for someone else to
write. It does not ask you to touch anything your own output contract puts
off-limits.

- Replace the existing implementation in place. Never leave the old one running
  beside the new one.
- No version-suffixed copies of a thing that already exists — no `V2`, `Enhanced`,
  `New`, `Legacy` class, file, endpoint or directory.
- No compatibility flag, shim or bridge whose only job is to keep the old path
  alive, unless the task explicitly requires compatibility.
- When the task does require it, say so where you add it: which consumers need
  it, for how long, and the condition under which it gets deleted.
- Unused code is deleted, not commented out, renamed to `_unused`, or re-exported
  "in case".
