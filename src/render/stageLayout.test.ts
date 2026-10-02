import { describe, expect, it } from 'vitest';
import { DRUM_PADS, VIBE_FREQS } from '../show/score';
import type { Candidate } from '../sim/types';
import {
  DISTRICT_CENTER,
  DISTRICT_R,
  districtPos,
  hitPoint,
  PIPE_IN_MOUTH,
  PIPE_OUT_MOUTH,
  REJECT_MOUTH,
  SCRAP_MOUTH,
  TRAP_RIM,
  vibeBarHit,
  type P3,
} from './stageLayout';

const AGENT: P3 = { x: 22, y: 8.5, z: 0 };

function mkCand(over: Partial<Candidate> = {}): Candidate {
  return {
    id: 1,
    agentId: 0,
    postId: 0,
    topic: 0,
    authorId: 0,
    source: 'in',
    startBeat: 0,
    slot: 0,
    pLike: 0,
    pReply: 0,
    pRepost: 0,
    score: 5,
    scoreNorm: 0.5,
    adjusted: 4,
    rank: 0,
    dropStage: null,
    dropReason: null,
    ...over,
  };
}

const dist = (a: P3, b: P3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('hitPoint', () => {
  it('launch は source に応じたパイプの口', () => {
    expect(hitPoint({ time: 0, kind: 'launch', index: 0 }, mkCand(), AGENT)).toEqual(
      PIPE_IN_MOUTH,
    );
    expect(hitPoint({ time: 0, kind: 'launch', index: 1 }, mkCand(), AGENT)).toEqual(
      PIPE_OUT_MOUTH,
    );
  });

  it('drum / vibe / bass / bell は source でずれて重ならない', () => {
    const inn = mkCand({ source: 'in' });
    const out = mkCand({ source: 'out' });
    for (const kind of ['drum', 'vibe', 'bass', 'bell'] as const) {
      const a = hitPoint({ time: 0, kind, index: 0 }, inn, AGENT);
      const b = hitPoint({ time: 0, kind, index: 0 }, out, AGENT);
      expect(dist(a, b)).toBeGreaterThan(0.05);
      expect(dist(a, b)).toBeLessThan(1); // ずれは打面からはみ出さない範囲
    }
  });

  it('vibe / bass / bell は index で打点が分かれる', () => {
    const c = mkCand();
    const v0 = hitPoint({ time: 0, kind: 'vibe', index: 0 }, c, AGENT);
    const v9 = hitPoint({ time: 0, kind: 'vibe', index: VIBE_FREQS.length - 1 }, c, AGENT);
    expect(v9.x - v0.x).toBeGreaterThan(5);
    const b0 = hitPoint({ time: 0, kind: 'bass', index: 0 }, c, AGENT);
    const b3 = hitPoint({ time: 0, kind: 'bass', index: 3 }, c, AGENT);
    expect(dist(b0, b3)).toBeGreaterThan(1);
    const l0 = hitPoint({ time: 0, kind: 'bell', index: 0 }, c, AGENT);
    const l2 = hitPoint({ time: 0, kind: 'bell', index: 2 }, c, AGENT);
    expect(dist(l0, l2)).toBeGreaterThan(2);
  });

  it('vibe は index が大きいほど打点が高い（右上の階段）', () => {
    let prev = vibeBarHit(0);
    for (let i = 1; i < VIBE_FREQS.length; i++) {
      const p = vibeBarHit(i);
      expect(p.y).toBeGreaterThan(prev.y);
      expect(p.x).toBeGreaterThan(prev.x);
      prev = p;
    }
  });

  it('drum は全パッド分の打点を持つ', () => {
    const c = mkCand();
    const pts = DRUM_PADS.map((_, i) =>
      hitPoint({ time: 0, kind: 'drum', index: i }, c, AGENT),
    );
    for (let i = 1; i < pts.length; i++) expect(dist(pts[0], pts[i])).toBeGreaterThan(0.3);
  });

  it('cymbal / trap / scrap / reject / catch の打点', () => {
    const c = mkCand();
    expect(hitPoint({ time: 0, kind: 'scrap', index: 0 }, c, AGENT)).toEqual(SCRAP_MOUTH);
    expect(hitPoint({ time: 0, kind: 'reject', index: 0 }, c, AGENT)).toEqual(REJECT_MOUTH);
    expect(hitPoint({ time: 0, kind: 'trap', index: 0 }, c, AGENT)).toEqual(TRAP_RIM);
    expect(hitPoint({ time: 0, kind: 'catch', index: 0 }, c, AGENT)).toEqual(AGENT);
  });
});

describe('districtPos', () => {
  it('中心から半径 DISTRICT_R の正 n 角形（XY 平面）', () => {
    for (let i = 0; i < 5; i++) {
      const p = districtPos(i, 5);
      const d = Math.hypot(p.x - DISTRICT_CENTER.x, p.y - DISTRICT_CENTER.y);
      expect(d).toBeCloseTo(DISTRICT_R, 6);
      expect(p.z).toBe(0);
    }
    // 隣接する頂点の距離が等しい
    const gap = (i: number) => {
      const a = districtPos(i, 5);
      const b = districtPos(i + 1, 5);
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    expect(gap(0)).toBeCloseTo(gap(2), 6);
  });

  it('vibeBarHit の両端', () => {
    expect(vibeBarHit(0)).toEqual({ x: -3.6, y: 2.4, z: 0 });
    expect(vibeBarHit(9)).toEqual({ x: 3.6, y: 7.35, z: 0 });
  });
});
