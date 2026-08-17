import type { NewProjectIntake } from '@ptah-extension/shared';
import { buildNewProjectSeedPrompt } from './harness-constants';

const BASE_INTAKE: NewProjectIntake = {
  what: 'A booking tool for physiotherapy clinics',
  audience: 'b2b',
  stack: 'recommend',
};

describe('buildNewProjectSeedPrompt', () => {
  it('opens with a Project intake block carrying the brief verbatim', () => {
    const prompt = buildNewProjectSeedPrompt(BASE_INTAKE);

    expect(prompt).toContain('## Project intake');
    expect(prompt).toContain('A booking tool for physiotherapy clinics');
    expect(prompt.indexOf('## Project intake')).toBeLessThan(
      prompt.indexOf('## How to proceed'),
    );
  });

  it('renders each audience as a readable label rather than the wire value', () => {
    const audiences: NewProjectIntake['audience'][] = [
      'b2b',
      'b2c',
      'internal',
      'unsure',
    ];
    const labels = audiences.map((audience) =>
      buildNewProjectSeedPrompt({ ...BASE_INTAKE, audience }),
    );

    expect(labels[0]).toContain('Businesses (B2B)');
    expect(labels[1]).toContain('Consumers (B2C)');
    expect(labels[2]).toContain('Internal tool');
    expect(labels[3]).toContain('Not sure yet');
    for (const prompt of labels) {
      expect(prompt).not.toMatch(
        /Who is it for\?\*\* (b2b|b2c|internal|unsure)/,
      );
    }
  });

  it('defers the stack choice to the agent when the user has no preference', () => {
    const prompt = buildNewProjectSeedPrompt(BASE_INTAKE);
    expect(prompt).toContain('recommend a stack for me');
  });

  it('appends the free-text stack when the user picked Other', () => {
    const prompt = buildNewProjectSeedPrompt({
      ...BASE_INTAKE,
      stack: 'other',
      stackOther: 'Remix + Go',
    });
    expect(prompt).toContain('Other — Remix + Go');
  });

  it('omits the stack free text when Other was not selected', () => {
    const prompt = buildNewProjectSeedPrompt({
      ...BASE_INTAKE,
      stack: 'angular-nestjs',
      stackOther: 'stale value',
    });
    expect(prompt).toContain('Angular + NestJS');
    expect(prompt).not.toContain('stale value');
  });

  it('omits the constraints section entirely when none were given', () => {
    expect(buildNewProjectSeedPrompt(BASE_INTAKE)).not.toContain(
      'Must-haves / constraints',
    );
    expect(
      buildNewProjectSeedPrompt({
        ...BASE_INTAKE,
        constraints: 'Must run on-premise',
      }),
    ).toContain('Must run on-premise');
  });

  it('treats whitespace-only constraints as absent', () => {
    const prompt = buildNewProjectSeedPrompt({
      ...BASE_INTAKE,
      constraints: '   \n  ',
    });
    expect(prompt).not.toContain('Must-haves / constraints');
  });

  it('mandates AskUserQuestion discovery and forbids self-answering', () => {
    const prompt = buildNewProjectSeedPrompt(BASE_INTAKE);
    expect(prompt).toContain('AskUserQuestion');
    expect(prompt).toContain('never answer a discovery question on my behalf');
    expect(prompt).toContain(
      'Skip any question the intake above already answers',
    );
  });

  it('sequences the Stage A skills: initializer, then ddd, then nx', () => {
    const prompt = buildNewProjectSeedPrompt(BASE_INTAKE);
    const initializer = prompt.indexOf('saas-workspace-initializer');
    const ddd = prompt.indexOf('ddd-architecture');
    const nx = prompt.indexOf('nx-workspace-architect');

    expect(initializer).toBeGreaterThan(-1);
    expect(initializer).toBeLessThan(ddd);
    expect(ddd).toBeLessThan(nx);
  });

  it('asks for the roadmap, a foundation-only scaffold, then a stop', () => {
    const prompt = buildNewProjectSeedPrompt(BASE_INTAKE);
    expect(prompt).toContain('.ptah/roadmap.md');
    expect(prompt).toContain('ONLY the foundation');
    expect(prompt).toContain('then stop');
  });

  it('closes with the harness design pass and a complete proposeConfig', () => {
    const prompt = buildNewProjectSeedPrompt(BASE_INTAKE);
    expect(prompt).toContain('ptah.harness');
    expect(prompt).toContain('proposeConfig with isConfigComplete=true');
  });

  it('stays vendor-neutral so any adapter can serve it', () => {
    const prompt = buildNewProjectSeedPrompt({
      ...BASE_INTAKE,
      constraints: 'None',
    }).toLowerCase();

    for (const vendor of [
      'claude',
      'anthropic',
      'openai',
      'codex',
      'copilot',
      'gemini',
    ]) {
      expect(prompt).not.toContain(vendor);
    }
  });
});
