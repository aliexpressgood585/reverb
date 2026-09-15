import { describe, it, expect } from 'vitest';
import { nextGoal, readChallenge, challengeURL } from '../cairn/src/climb.js';
import { Sim } from '../cairn/src/sim.js';

describe('climb milestones and shared starting towers', () => {
  it('advances at milestone boundaries and never returns a target below the player', () => {
    expect(nextGoal(-2)).toBe(100);
    expect(nextGoal(99.9)).toBe(100);
    expect(nextGoal(100)).toBe(200);
    expect(nextGoal(315)).toBe(400);
  });

  it('round-trips the actual seed and earned height without carrying unrelated URL data', () => {
    const url = new URL(challengeURL('https://example.com/cairn/?old=1#menu', 0x1a2b3c, 141.8));
    expect(url.pathname).toBe('/cairn/');
    expect(url.hash).toBe('');
    expect(url.searchParams.has('old')).toBe(false);
    expect(readChallenge(url.search)).toEqual({ seed: 0x1a2b3c, target: 141 });
  });

  it('rejects invalid, unsupported and unbounded challenge links', () => {
    for (const query of ['', '?challenge=2&seed=1&target=20',
      '?challenge=1&seed=0&target=20', '?challenge=1&seed=-1&target=20',
      '?challenge=1&seed=4294967296&target=20', '?challenge=1&seed=1&target=Infinity',
      '?challenge=1&seed=1&target=0', '?challenge=1&seed=1&target=1000001',
      '?challenge=1&seed=1&target=1.5']) expect(readChallenge(query)).toBeNull();
  });

  it('reconstructs the same starting geometry on a recipient device', () => {
    const source = new Sim(0x1a2b3c);
    const link = new URL(challengeURL('https://example.com/cairn/', source.world.seed, 141));
    const challenge = readChallenge(link.search);
    expect(challenge).not.toBeNull();
    const recipient = new Sim(challenge?.seed || 1);
    source.reset(true); recipient.reset(true);
    expect(recipient.world.solids.map(s => [s.x, s.y, s.hw, s.hh]))
      .toEqual(source.world.solids.map(s => [s.x, s.y, s.hw, s.hh]));
    expect(recipient.world.corpseCount).toBe(0);
  });
});
