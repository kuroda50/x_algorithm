import { describe, expect, it } from 'vitest';
import { timeline } from '../show/score';
import { TOPICS } from '../sim/config';
import type { Candidate } from '../sim/types';
import {
  BALL_R,
  ballState,
  DROPPED_COLOR,
  HOP_HEIGHT,
  SQUASH_BEATS,
  VANISH_BIN,
  VANISH_CATCH,
} from './trajectory';
import { hitPoint, type P3 } from './stageLayout';

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

describe('ballState', () => {
  it('発射前は非表示', () => {
    const c = mkCand({ startBeat: 2, slot: 1 });
    expect(ballState(c, 0, AGENT).visible).toBe(false);
    expect(ballState(c, 2.24, AGENT).visible).toBe(false);
    expect(ballState(c, 2.25, AGENT).visible).toBe(true);
  });

  it('各 Hit の時刻にちょうど打点に居る', () => {
    const c = mkCand({ startBeat: 1, slot: 2 });
    for (const h of timeline(c)) {
      const s = ballState(c, h.time, AGENT);
      expect(s.visible).toBe(true);
      const p = hitPoint(h, c, AGENT);
      expect(dist(s.pos, p)).toBeLessThan(1e-9);
    }
  });

  it('区間の中央では 2 点を結ぶ直線より上に居る', () => {
    const c = mkCand();
    const hits = timeline(c);
    for (let i = 0; i < hits.length - 1; i++) {
      const t = (hits[i].time + hits[i + 1].time) / 2;
      const s = ballState(c, t, AGENT);
      const p0 = hitPoint(hits[i], c, AGENT);
      const p1 = hitPoint(hits[i + 1], c, AGENT);
      const linY = (p0.y + p1.y) / 2;
      const dur = hits[i + 1].time - hits[i].time;
      expect(s.pos.y).toBeCloseTo(linY + HOP_HEIGHT * dur * dur, 6);
    }
  });

  it('catch のあと 0.25 拍で縮んで消える', () => {
    const c = mkCand();
    const hits = timeline(c);
    const end = hits[hits.length - 1].time;
    const mid = ballState(c, end + VANISH_CATCH / 2, AGENT);
    expect(mid.visible).toBe(true);
    expect(mid.radius).toBeLessThan(BALL_R);
    expect(mid.pos).toEqual(AGENT); // 円についていく
    expect(ballState(c, end + VANISH_CATCH + 0.01, AGENT).visible).toBe(false);
  });

  it('フィルタ除外は scrap で沈みながら消える', () => {
    const c = mkCand({ dropStage: 1, dropReason: 'bad' });
    const hits = timeline(c);
    expect(hits[hits.length - 1].kind).toBe('scrap');
    const end = hits[hits.length - 1].time;
    const s = ballState(c, end + VANISH_BIN / 2, AGENT);
    expect(s.visible).toBe(true);
    expect(s.pos.y).toBeLessThan(hitPoint(hits[hits.length - 1], c, AGENT).y);
    expect(ballState(c, end + VANISH_BIN + 0.01, AGENT).visible).toBe(false);
  });

  it('落選は reject で消える', () => {
    const c = mkCand({ dropStage: 4, dropReason: 'rank', rank: 3 });
    const hits = timeline(c);
    expect(hits[hits.length - 1].kind).toBe('reject');
    const end = hits[hits.length - 1].time;
    expect(ballState(c, end + VANISH_BIN + 0.01, AGENT).visible).toBe(false);
  });

  it('3 通りの運命どれでも NaN が出ない', () => {
    for (const dropStage of [null, 1, 4] as const) {
      const c = mkCand({ dropStage, rank: dropStage === 4 ? 3 : 0 });
      for (let b = -0.5; b < 9; b += 0.037) {
        const s = ballState(c, b, AGENT);
        expect(Number.isFinite(s.pos.x)).toBe(true);
        expect(Number.isFinite(s.pos.y)).toBe(true);
        expect(Number.isFinite(s.pos.z)).toBe(true);
        expect(Number.isFinite(s.radius)).toBe(true);
        expect(Number.isFinite(s.opacity)).toBe(true);
        expect(Number.isFinite(s.squash)).toBe(true);
      }
    }
  });

  it('vibe の打点からスコアに応じて大きくなる', () => {
    const lo = mkCand({ scoreNorm: 0 });
    const hi = mkCand({ scoreNorm: 1 });
    const vibeT = (c: Candidate) => timeline(c).find((h) => h.kind === 'vibe')!.time;
    // 切り替わりが終わったあとで比べる
    expect(ballState(lo, vibeT(lo) + 0.2, AGENT).radius).toBeCloseTo(BALL_R * 0.75, 6);
    expect(ballState(hi, vibeT(hi) + 0.2, AGENT).radius).toBeCloseTo(BALL_R * 1.4, 6);
    // 当たる直前は基準の大きさ
    expect(ballState(hi, vibeT(hi) - 0.01, AGENT).radius).toBeCloseTo(BALL_R, 6);
  });

  it('bass の打点から多様性調整の比が効く', () => {
    const flat = mkCand({ score: 4, adjusted: 4 });
    const down = mkCand({ score: 4, adjusted: 1.6 }); // 比 0.4 → 0.5 に丸める
    const bassT = (c: Candidate) => timeline(c).find((h) => h.kind === 'bass')!.time;
    const rFlat = ballState(flat, bassT(flat) + 0.2, AGENT).radius;
    const rDown = ballState(down, bassT(down) + 0.2, AGENT).radius;
    expect(rDown).toBeCloseTo(rFlat / 2, 6);
    // score が 0 なら比は 1（vibe までの倍率だけ残る = flat と同じ）
    const zero = mkCand({ score: 0, adjusted: 0 });
    expect(ballState(zero, bassT(zero) + 0.2, AGENT).radius).toBeCloseTo(rFlat, 6);
  });

  it('cymbal のあとも trap のあとも灰色', () => {
    const dropped = mkCand({ dropStage: 1, dropReason: 'bad' });
    const cym = timeline(dropped).find((h) => h.kind === 'cymbal')!.time;
    expect(ballState(dropped, cym - 0.01, AGENT).color).toBe(TOPICS[0].color);
    expect(ballState(dropped, cym + 0.01, AGENT).color).toBe(DROPPED_COLOR);

    const rejected = mkCand({ dropStage: 4, dropReason: 'rank', rank: 3 });
    const trap = timeline(rejected).find((h) => h.kind === 'trap')!.time;
    expect(ballState(rejected, trap - 0.01, AGENT).color).toBe(TOPICS[0].color);
    expect(ballState(rejected, trap + 0.01, AGENT).color).toBe(DROPPED_COLOR);
  });

  it('当たった直後は squash が効き、0.12 拍で消える', () => {
    const c = mkCand({ startBeat: 0, slot: 0 });
    const hits = timeline(c);
    const launch = hits[0].time;
    const drum = hits[1].time;
    // 発射直後は 0（launch には付かない）
    expect(ballState(c, launch + 0.01, AGENT).squash).toBe(0);
    // 当たった直後は 1 に近い
    expect(ballState(c, drum + 0.01, AGENT).squash).toBeGreaterThan(0);
    expect(ballState(c, drum, AGENT).squash).toBe(1);
    // 0.12 拍より後は 0
    expect(ballState(c, drum + SQUASH_BEATS + 0.01, AGENT).squash).toBe(0);
  });

  it('フォロー外のボールは hollow（輪）', () => {
    expect(ballState(mkCand({ source: 'out' }), 0.5, AGENT).hollow).toBe(true);
    expect(ballState(mkCand({ source: 'in' }), 0.5, AGENT).hollow).toBe(false);
  });
});
