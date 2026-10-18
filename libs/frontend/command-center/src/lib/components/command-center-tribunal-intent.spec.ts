import { hasTribunalIntent } from './command-center-tribunal-intent';

describe('hasTribunalIntent', () => {
  it.each([
    ['fix the race condition', false],
    ['run a council on X', true],
    ['start tribunal', true],
    ['convene the forge', true],
    ['launch relay', true],
    ['have a council review this', true],
    ['get a council on it', true],
    ['kick off a forge', true],
    ['spin up a crucible', true],
    ['hold a council', true],
    ['run 3 councils', true],
    ['Review with Council', true],
    ['review via the relay', true],
    ['review using a crucible', true],
    ["let's run a council", true],
    ["let's have a council", true],
    ['fire up a race', true],
    ['set up the forges', true],
    ['run the race condition tests', false],
    ['launch the relay server', false],
    ['start the forge build', false],
    ['the tribunal panel crashes', false],
    ['tribunal code', false],
    ['run the race crashes', false],
    ['tribunals are unavailable', false],
  ])('%s -> %s', (content, expected) => {
    expect(hasTribunalIntent(content)).toBe(expected);
  });
});
