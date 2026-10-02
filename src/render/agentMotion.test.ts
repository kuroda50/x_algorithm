import { describe, expect, it } from 'vitest';
import type { Agent, World } from '../sim/types';
import { createAgentMotion, homeOffset, initialAgentPos } from './agentMotion';
import { DISTRICT_CENTER, DISTRICT_R, districtPos } from './stageLayout';

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

const distFromCenter = (p: { x: number; y: number }) =>
  Math.hypot(p.x - DISTRICT_CENTER.x, p.y - DISTRICT_CENTER.y);

describe('createAgentMotion', () => {
  it('reset は街の中心付近に散らして置く', () => {
    const m = createAgentMotion();
    m.reset(12);
    expect(m.count()).toBe(12);
    for (let i = 0; i < 12; i++) {
      expect(distFromCenter(m.pos(i)!)).toBeLessThan(DISTRICT_R);
    }
  });

  it('興味が偏ったエージェントはその地区へ近づく', () => {
    const m = createAgentMotion();
    const world = mkWorld([[1, 0, 0, 0, 0]]);
    m.reset(1);
    run(m, world, 300);
    const p = m.pos(0)!;
    const d0 = districtPos(0, 5);
    // ふらつきとばねの残りを考えて 1.5 以内
    expect(Math.hypot(p.x - d0.x, p.y - d0.y)).toBeLessThan(1.5);
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
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.5);
    expect(distFromCenter(a)).toBeLessThan(2);
    expect(distFromCenter(b)).toBeLessThan(2);
  });

  it('街の円の外には出ない', () => {
    const m = createAgentMotion();
    const world = mkWorld([[1, 0, 0, 0, 0]]);
    m.reset(1);
    run(m, world, 600);
    expect(distFromCenter(m.pos(0)!)).toBeLessThanOrEqual(DISTRICT_R + 1e-6);
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

  it('kick / beatHop で上に跳ねて元の高さに戻る', () => {
    const m = createAgentMotion();
    const world = mkWorld([
      [0.2, 0.2, 0.2, 0.2, 0.2],
      [0.2, 0.2, 0.2, 0.2, 0.2],
    ]);
    m.reset(2);
    m.kick(0, 2);
    m.update(world, 1 / 60);
    expect(m.pos(0)!.hop).toBeGreaterThan(0);
    m.beatHop(1);
    m.update(world, 1 / 60);
    expect(m.pos(1)!.hop).toBeGreaterThan(0);
    run(m, world, 600);
    expect(m.pos(0)!.hop).toBe(0);
    expect(m.pos(1)!.hop).toBe(0);
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
    const a = initialAgentPos(0, 8);
    const b = initialAgentPos(1, 8);
    expect(initialAgentPos(0, 8)).toEqual(a);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.2);
  });
});

describe('homeOffset', () => {
  it('決定的である', () => {
    expect(homeOffset(3, 8)).toEqual(homeOffset(3, 8));
    expect(homeOffset(0, 24)).toEqual(homeOffset(0, 24));
  });

  it('i が違えば位置が違う', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const p = homeOffset(i, 24);
      const key = `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('n = 24 でも半径 4.0 以内に収まる', () => {
    for (let i = 0; i < 24; i++) {
      const p = homeOffset(i, 24);
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(4.0);
    }
  });

  it('n = 8 で隣り合う 2 体が 1.0 以上離れる', () => {
    for (let i = 0; i < 7; i++) {
      const a = homeOffset(i, 8);
      const b = homeOffset(i + 1, 8);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(1.0);
    }
  });
});
