import { describe, expect, it } from 'vitest';
import type { Agent, World } from '../sim/types';
import { createAgentMotion, initialAgentPos } from './agentMotion';
import { DISTRICT_CENTER, districtPos } from './layout';

function mkAgent(id: number, interest: number[]): Agent {
  return {
    id,
    name: `A${id}`,
    interest,
    follows: new Set(),
    seen: new Set(),
    feed: [],
  };
}

function mkWorld(interests: number[][]): World {
  return {
    seed: 1,
    rng: () => 0.5,
    beat: 0,
    authors: [],
    posts: new Map(),
    agents: interests.map((it, i) => mkAgent(i, it)),
    candidates: [],
    metrics: [],
    stats: { posts: 0, dropped: 0, reactions: 0 },
    nextPostId: 0,
    nextCandidateId: 0,
  };
}

function run(motion: ReturnType<typeof createAgentMotion>, world: World, steps: number, dt = 1 / 60) {
  for (let i = 0; i < steps; i++) motion.update(world, dt);
}

describe('createAgentMotion', () => {
  it('reset は中心付近に散らして置く', () => {
    const m = createAgentMotion();
    m.reset(12);
    expect(m.count()).toBe(12);
    for (let i = 0; i < 12; i++) {
      const p = m.pos(i)!;
      const d = Math.hypot(p.x - DISTRICT_CENTER.x, p.y - DISTRICT_CENTER.y);
      expect(d).toBeLessThan(130);
    }
  });

  it('興味が偏ったエージェントはその地区へ近づく', () => {
    const m = createAgentMotion();
    const world = mkWorld([[1, 0, 0, 0, 0]]);
    m.reset(1);
    run(m, world, 300);
    const p = m.pos(0)!;
    const d0 = districtPos(0, 5);
    // ふらつき ±9 とばねの残りを考えて 40 以内
    expect(Math.hypot(p.x - d0.x, p.y - d0.y)).toBeLessThan(40);
  });

  it('均等な興味の集団は中心付近に残るが、反発で重ならない', () => {
    const m = createAgentMotion();
    const world = mkWorld([
      [0.2, 0.2, 0.2, 0.2, 0.2],
      [0.2, 0.2, 0.2, 0.2, 0.2],
    ]);
    m.reset(2);
    run(m, world, 300);
    const a = m.pos(0)!;
    const b = m.pos(1)!;
    const sep = Math.hypot(a.x - b.x, a.y - b.y);
    expect(sep).toBeGreaterThan(20);
    expect(Math.hypot(a.x - DISTRICT_CENTER.x, a.y - DISTRICT_CENTER.y)).toBeLessThan(80);
    expect(Math.hypot(b.x - DISTRICT_CENTER.x, b.y - DISTRICT_CENTER.y)).toBeLessThan(80);
  });

  it('dt = 0 では動かない', () => {
    const m = createAgentMotion();
    const world = mkWorld([[1, 0, 0, 0, 0]]);
    m.reset(1);
    const before = { ...m.pos(0)! };
    m.update(world, 0);
    const after = m.pos(0)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  it('kick / beatHop で跳ねる', () => {
    const m = createAgentMotion();
    const world = mkWorld([[0.2, 0.2, 0.2, 0.2, 0.2], [0.2, 0.2, 0.2, 0.2, 0.2]]);
    m.reset(2);
    m.kick(0, 200);
    const y0 = m.pos(0)!.y;
    m.update(world, 1 / 60);
    expect(m.pos(0)!.y).toBeLessThan(y0);
    const y1 = m.pos(1)!.y;
    m.beatHop(1);
    m.update(world, 1 / 60);
    expect(m.pos(1)!.y).toBeLessThan(y1);
  });

  it('エージェント数が変わると update 内で作り直す', () => {
    const m = createAgentMotion();
    m.reset(2);
    const world = mkWorld([[1, 0, 0, 0, 0]]);
    m.update(world, 1 / 60);
    expect(m.count()).toBe(1);
  });
});

describe('initialAgentPos', () => {
  it('決定的で重ならない', () => {
    const a = initialAgentPos(0);
    const b = initialAgentPos(1);
    expect(initialAgentPos(0)).toEqual(a);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(5);
  });
});
