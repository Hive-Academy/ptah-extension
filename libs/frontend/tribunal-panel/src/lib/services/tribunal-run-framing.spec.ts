import {
  buildApprovedRootFraming,
  buildTribunalFraming,
  laneTag,
  roundCapFor,
} from './tribunal-run-framing';
import type { VendorLane } from '../types/tribunal-ui.types';

const lane: VendorLane = {
  laneId: 'codex#0',
  family: 'codex',
  displayName: 'Codex',
  cli: 'codex',
};
const context = { specTaskId: null, roundCap: null, rubric: null };

describe('tribunal run framing', () => {
  it('pins the lane tag wire format and round bounds', () => {
    expect(laneTag('codex#0')).toBe('[tribunal:codex#0]');
    expect(laneTag('codex#0', 'plan')).toBe('[tribunal:codex#0] (plan)');
    expect(roundCapFor({ move: 'council' })).toBeNull();
    expect(roundCapFor({ move: 'crucible' })).toBe(2);
    expect(roundCapFor({ move: 'crucible', roundCap: -5 })).toBe(1);
    expect(roundCapFor({ move: 'crucible', roundCap: 8 })).toBe(2);
  });

  it('pins the existing council framing exactly for a single lane', () => {
    expect(buildTribunalFraming('council', [lane], context)).toBe(
      [
        'Convene a Tribunal Council. You are the Tribunal conductor running FULLY AUTONOMOUSLY.',
        '',
        'Council: each panelist weighs in independently, then synthesize a single cited verdict.',
        '',
        'This panel is EXPLICITLY defined by the user. Spawn EXACTLY these panelists with EXACTLY these spawn args via ptah_agent_spawn, passing each the objective stated at the end of this message. Do NOT run your own vendor discovery or family-spread selection, do NOT collapse duplicate vendors, and do NOT substitute models. The [tribunal:<laneId>] tag MUST be the first line of each sub-agent task, verbatim.',
        '',
        '  [tribunal:codex#0] Codex \u2014 ptah_agent_spawn({ cli: "codex" }) with the objective below as the task.',
        '',
        'Rules:',
        '- Do NOT call AskUserQuestion. Run fully autonomously and make reasonable assumptions; state assumptions inline rather than asking.',
        '- The [tribunal:<laneId>] tag MUST be the first line of each sub-agent task. Do not omit it and do not alter the laneId inside it.',
        '',
        'Objective:',
      ].join('\n'),
    );
  });

  it('adds a root continuation without replacing the existing framing', () => {
    const existing = buildTribunalFraming('council', [lane], context);
    expect(buildApprovedRootFraming('council', [lane], context)).toBe(
      `${existing}\n\nConduct this approved run, then return to your normal role.`,
    );
  });
});
