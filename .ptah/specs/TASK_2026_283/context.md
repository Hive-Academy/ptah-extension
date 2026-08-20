# TASK_2026_283 — the seed prompt names skills that may not exist

## User intent (2026-08-18)

Split out of TASK_2026_276. While scoping whether the Python profile could be
postponed to a later release, the honest answer turned out to be "postponing is
fine, but a broken path ships either way" — and the breakage is not
Python-specific. The user's call: fix the class now, before publishing, so that
when Python lands nothing needs changing.

That forward-compatibility is the point. The fallback is gated on actual skill
availability, so shipping `ptah-python` in TASK_2026_276 makes it stop firing on
its own. No follow-up edit, no flag to remember to flip.

## The defect

`buildProcedureSteps` (`libs/backend/rpc-handlers/src/lib/harness/harness-constants.ts:158-172`)
takes a `StackProfile | null` and unconditionally interpolates the profile's skill
names into the Stage A instructions:

```
Use the `${profile.skills.initializer}` skill and run its Stage A.
```

and at `:201-208`:

```
... then the `${profile.skills.architect}` skill to derive the library layout from them
```

There is no check that either skill is installed. A user selecting Python in New
Project today gets an agent instructed to invoke `python-workspace-initializer`
and `python-workspace-architect`, neither of which exists, with no warning
anywhere. The agent improvises from there.

## Why the existing honesty path does not catch it

`partitionRequiredPlugins` (`libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts:694-710`)
is the mechanism that reports missing pieces to the user, and its doc comment is
explicit that failing closed is the honest answer. But it reads **only**
`profile.requiredPlugins`. `PYTHON_PROFILE.requiredPlugins` is `[]`, so the
method returns early at `:708-710` with `missingExternal: []` and reports
nothing.

The machinery is real. Python never trips it, precisely _because_ the array is
empty. So TASK_2026_276's premise that "the handler reports the missing plugins
honestly rather than pretending" is optimistic — for Python it reports nothing at
all. That gap is what this task closes.

## The fix

The prose to fall back to already exists. The `other`-platform branch at
`harness-constants.ts:165-172` carries exactly the right wording for "no preset
skill applies here, follow the generic Stage A contract" — written for the case
where the user declined to name a platform, but the shape fits equally when the
platform is known and its skill is simply absent.

The availability signal is already in reach: `this.workspaceContext.discoverAvailableSkills()`
is used three times in the same handler class (`harness-rpc.handlers.ts:350`,
`:371`, `:656`). The seed prompt is built at `:793` in that same method, so the
data is available at the call site without new plumbing.

Design constraint: `buildProcedureSteps` and `buildNewProjectSeedPrompt`
(`harness-constants.ts:241`) are pure functions over the profile. Keep them pure
— pass availability _in_ rather than resolving it inside, so the unit tests stay
free of DI.

## Scope boundary

This is the fallback only. It does NOT ship the Python plugin — that stays
TASK_2026_276, which remains open and whose `implementation-plan.md` is written
and awaiting review.

Whether the Python intake chip stays visible in the meantime is a separate
question the user has not yet answered; this fix makes leaving it visible
defensible, since the agent now gets a coherent generic contract instead of a
dangling skill name.
