export const meta = {
  name: 'fleet-fix',
  description: 'Run checkpointed task fixes across disjoint repository areas.',
  phases: [{ title: 'Plan' }, { title: 'Implement' }, { title: 'Judge' }],
};

/*
 * Agents never commit; commits happen outside while no implementer is editing.
 * Resume by re-invoking with freshly computed args; never rely on resumeFromRunId
 * (prefix cache + parallel() ordering re-runs finished agents).
 * The sandbox cannot inspect disk, so args carry caller-computed checkpoints.
 * Agents persist artifacts before returning; those artifacts are the source of truth.
 * Existing artifacts win, making every stage safe to invoke again.
 * Tasks sharing an area stay sequential; disjoint areas cross a parallel barrier.
 */

if (!args || !Array.isArray(args.tasks) || args.tasks.length === 0) {
  log(
    'Usage: pass { repo, tasks: [{ id, title, area, stage, judgeRound, hasContext, status }], maxJudgeRounds? }.',
  );
  return { error: 'no tasks' };
}

const planSchema = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
    rootCause: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    plan: { type: 'string' },
    acceptance: { type: 'array', items: { type: 'string' } },
    testProjects: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'taskId',
    'rootCause',
    'files',
    'plan',
    'acceptance',
    'testProjects',
  ],
  additionalProperties: false,
};

const implementSchema = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testOutcome: { type: 'string' },
    typecheckOutcome: { type: 'string' },
    blocked: { type: 'boolean' },
  },
  required: [
    'taskId',
    'summary',
    'filesChanged',
    'testOutcome',
    'typecheckOutcome',
    'blocked',
  ],
  additionalProperties: false,
};

const judgeSchema = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
    round: { type: 'integer' },
    pass: { type: 'boolean' },
    defects: { type: 'array', items: { type: 'string' } },
    testsRan: { type: 'string' },
    mentorNote: { type: 'string' },
  },
  required: ['taskId', 'round', 'pass', 'defects', 'testsRan', 'mentorNote'],
  additionalProperties: false,
};

const revisionSchema = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
    round: { type: 'integer' },
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testsRan: { type: 'string' },
    blocked: { type: 'boolean' },
  },
  required: [
    'taskId',
    'round',
    'summary',
    'filesChanged',
    'testsRan',
    'blocked',
  ],
  additionalProperties: false,
};

const artifactRules = `- if your artifact already exists on disk, read it, do not redo the work, and return its content as the schema-shaped result
- Write the artifact BEFORE returning.
- do not commit, do not stash/checkout/reset
- re-Read any file immediately before editing it`;

const maxJudgeRounds = args.maxJudgeRounds || 2;

async function runTask(task) {
  const taskFolder = `${args.repo}/.ptah/specs/${task.id}`;
  let rounds = Number.isInteger(task.judgeRound) ? task.judgeRound : 0;
  let finalStage = task.stage || 'plan';
  let pass = task.stage === 'done' || task.status === 'done';
  let blocked = false;

  if (pass) {
    return { id: task.id, finalStage: 'done', pass, rounds, blocked };
  }

  try {
    if (!task.hasContext) {
      await agent(
        `Plan ${task.id}: ${task.title}\nArea: ${task.area}\nRepo: ${args.repo}\nTask folder: ${taskFolder}\n${artifactRules}\nInspect the task and repository evidence. Write ${taskFolder}/context.md with sections Evidence, Root cause, Files, Plan, Acceptance criteria, and Test projects. Return the same facts in the result schema.`,
        {
          label: `plan:${task.id}`,
          phase: 'Plan',
          schema: planSchema,
          effort: 'high',
        },
      );
      finalStage = 'plan';
    }

    if (task.status !== 'in_review' && task.status !== 'done') {
      const implementation = await agent(
        `Implement ${task.id}: ${task.title}\nArea: ${task.area}\nRepo: ${args.repo}\nTask folder: ${taskFolder}\n${artifactRules}\nRead ${taskFolder}/context.md and ${taskFolder}/task.md. Edit the code, add focused tests, and run npx nx run-many -t test -p <projects> using the Test projects from context.md. Never use positional nx test project names. Edit exactly the status: line in task.md to in_review. Append an Implementation notes section to context.md. Return the implementation result.`,
        {
          label: `implement:${task.id}`,
          phase: 'Implement',
          schema: implementSchema,
          effort: 'high',
        },
      );
      finalStage = 'implement';
      blocked = implementation.blocked;
      if (blocked) {
        return { id: task.id, finalStage, pass: false, rounds, blocked };
      }
    }

    for (let round = rounds + 1; round <= maxJudgeRounds; round += 1) {
      const verdictPath = `${taskFolder}/judge-round-${round}.json`;
      const verdict = await agent(
        `Judge ${task.id}, round ${round}, with a REFUTE stance.\nRepo: ${args.repo}\nTask folder: ${taskFolder}\n${artifactRules}\nRead the plan, implementation notes, changed files, and tests. Seek concrete counterexamples. Run the relevant tests. Write ${verdictPath} with { taskId, round, pass, defects, testsRan, mentorNote } before returning the identical object.`,
        {
          label: `judge${round}:${task.id}`,
          phase: 'Judge',
          schema: judgeSchema,
          effort: 'high',
        },
      );

      rounds = round;
      finalStage = 'judge';
      pass = verdict.pass;
      if (pass) break;

      if (round < maxJudgeRounds) {
        const revisionPath = `${taskFolder}/revision-round-${round}.json`;
        const revision = await agent(
          `Revise ${task.id} after judge round ${round}.\nRepo: ${args.repo}\nTask folder: ${taskFolder}\n${artifactRules}\nDefects to fix: ${JSON.stringify(verdict.defects)}\nRead the verdict and implementation context, fix every verified defect, add or update focused tests, and run npx nx run-many -t test -p <projects>. Write ${revisionPath} with the revision result before returning the identical object.`,
          {
            label: `revise${round}:${task.id}`,
            phase: 'Judge',
            schema: revisionSchema,
            effort: 'high',
          },
        );
        blocked = revision.blocked;
        if (blocked) break;
      }
    }
  } catch (error) {
    log(`Task ${task.id} stopped because an agent stage failed.`);
    blocked = true;
  }

  return {
    id: task.id,
    finalStage: pass ? 'done' : finalStage,
    pass,
    rounds,
    blocked,
  };
}

const tasksByArea = new Map();
for (const task of args.tasks) {
  const areaTasks = tasksByArea.get(task.area) || [];
  areaTasks.push(task);
  tasksByArea.set(task.area, areaTasks);
}

const groupedResults = await parallel(
  Array.from(tasksByArea.values()).map((areaTasks) => async () => {
    const areaResults = [];
    for (const task of areaTasks) {
      areaResults.push(await runTask(task));
    }
    return areaResults;
  }),
);

const results = [];
for (const areaResults of groupedResults) {
  if (Array.isArray(areaResults)) results.push(...areaResults);
}

return {
  results,
  summary: {
    total: results.length,
    passed: results.filter((result) => result.pass).length,
    failed: results.filter((result) => !result.pass && !result.blocked).length,
    blocked: results.filter((result) => result.blocked).length,
  },
};
