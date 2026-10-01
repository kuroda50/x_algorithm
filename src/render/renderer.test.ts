// Node には Canvas が無いので、呼び出しを記録するだけの偽物の ctx を渡して
// 「例外なく描画ループが回ること」とヒットテストを確認する。
import { describe, expect, it } from 'vitest';
import type { Agent, BeatEvents, Candidate, World } from '../sim/types';
import { initialAgentPos } from './agentMotion';
import { CANVAS_H, CANVAS_W, createRenderer } from './renderer';

type Call = [string, unknown[]];

class FakeCtx {
  calls: Call[] = [];
  fillStyle: unknown = '';
  strokeStyle: unknown = '';
  lineWidth = 0;
  globalAlpha = 1;
  font = '';
  textAlign = '';
  textBaseline = '';
  lineCap = '';
  lineJoin = '';
  private rec(name: string, args: unknown[]) {
    this.calls.push([name, args]);
  }
  scale(...a: unknown[]) { this.rec('scale', a); }
  clearRect(...a: unknown[]) { this.rec('clearRect', a); }
  beginPath(...a: unknown[]) { this.rec('beginPath', a); }
  closePath(...a: unknown[]) { this.rec('closePath', a); }
  moveTo(...a: unknown[]) { this.rec('moveTo', a); }
  lineTo(...a: unknown[]) { this.rec('lineTo', a); }
  arc(...a: unknown[]) { this.rec('arc', a); }
  rect(...a: unknown[]) { this.rec('rect', a); }
  fill(...a: unknown[]) { this.rec('fill', a); }
  stroke(...a: unknown[]) { this.rec('stroke', a); }
  fillText(...a: unknown[]) { this.rec('fillText', a); }
  strokeText(...a: unknown[]) { this.rec('strokeText', a); }
  save(...a: unknown[]) { this.rec('save', a); }
  restore(...a: unknown[]) { this.rec('restore', a); }
  translate(...a: unknown[]) { this.rec('translate', a); }
  rotate(...a: unknown[]) { this.rec('rotate', a); }
}

function mkCanvas(ctx: FakeCtx): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: CANVAS_W / 2,
      height: CANVAS_H / 2,
      right: CANVAS_W / 2,
      bottom: CANVAS_H / 2,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  } as unknown as HTMLCanvasElement;
}

function mkAgent(id: number, interest = [0.2, 0.2, 0.2, 0.2, 0.2]): Agent {
  return { id, name: `A${id}`, interest, follows: new Set(), seen: new Set(), feed: [] };
}

function mkCandidate(over: Partial<Candidate>): Candidate {
  return {
    id: 0,
    agentId: 0,
    postId: 0,
    topic: 0,
    authorId: 0,
    source: 'in',
    startBeat: 0,
    pLike: 0.5,
    pReply: 0.5,
    pRepost: 0.5,
    score: 40,
    adjusted: 30,
    dropStage: null,
    dropReason: null,
    ...over,
  };
}

function mkWorld(over: Partial<World>): World {
  return {
    seed: 1,
    rng: () => 0.5,
    beat: 0,
    authors: [],
    posts: new Map(),
    agents: [mkAgent(0), mkAgent(1)],
    candidates: [],
    metrics: [],
    stats: { posts: 0, dropped: 0, reactions: 0 },
    nextPostId: 0,
    nextCandidateId: 0,
    ...over,
  };
}

function mkEvents(over: Partial<BeatEvents>): BeatEvents {
  return { beat: 0, spawned: [], dropped: [], delivered: [], ...over };
}

describe('createRenderer', () => {
  it('小さな world で描画ループが例外なく回る', () => {
    const ctx = new FakeCtx();
    const r = createRenderer(mkCanvas(ctx));
    const world = mkWorld({
      candidates: [
        mkCandidate({ id: 1, agentId: 0, topic: 0, source: 'in' }),
        mkCandidate({ id: 2, agentId: 1, topic: 2, source: 'out' }),
        mkCandidate({ id: 3, agentId: 0, topic: 4, source: 'in', dropStage: 1, dropReason: 'bad' }),
        mkCandidate({ id: 4, agentId: 1, topic: 1, source: 'out', dropStage: 4, dropReason: 'rank' }),
      ],
    });
    r.reset(world);
    for (let f = 0; f < 60; f++) {
      const beat = f / 20; // 3 ビート分
      expect(() => r.draw(world, beat, 1 / 60)).not.toThrow();
    }
    // 後半: 終端演出（落下・縮小・吸収）も通す
    for (let f = 0; f < 60; f++) {
      const beat = 3 + f / 20;
      expect(() => r.draw(world, beat, 1 / 60)).not.toThrow();
    }
    const names = ctx.calls.filter(([n]) => n === 'fillText').map(([, a]) => a[0]);
    expect(names).toContain('フィルタ');
    expect(names).toContain('スコアリング');
    expect(names).toContain('Thunder');
    expect(names).toContain('Phoenix 検索');
    expect(ctx.calls.some(([n]) => n === 'fill')).toBe(true);
  });

  it('配信イベントで反応アイコンと「+フォロー」が出る', () => {
    const ctx = new FakeCtx();
    const r = createRenderer(mkCanvas(ctx));
    const world = mkWorld({});
    r.reset(world);
    const cand = mkCandidate({ id: 9, agentId: 0, topic: 1 });
    r.onBeat(
      world,
      mkEvents({
        beat: 0,
        delivered: [
          {
            candidate: cand,
            item: {
              postId: 0,
              topic: 1,
              authorId: 0,
              source: 'in',
              score: 30,
              deliveredBeat: 0,
              reactions: { like: true, reply: true, repost: true },
            },
            followed: true,
          },
        ],
      }),
    );
    r.draw(world, 0.5, 1 / 60); // まだ +0.75 前なので発火しない
    let texts = ctx.calls.filter(([n]) => n === 'fillText').map(([, a]) => a[0]);
    expect(texts).not.toContain('♥');
    r.draw(world, 0.8, 1 / 60); // +0.75 を越えて発火
    texts = ctx.calls.filter(([n]) => n === 'fillText').map(([, a]) => a[0]);
    expect(texts).toContain('♥');
    expect(texts).toContain('↻');
    expect(texts).toContain('+フォロー');
  });

  it('hitTestAgent は client 座標から最寄りのエージェントを返す', () => {
    const ctx = new FakeCtx();
    const canvas = mkCanvas(ctx);
    const r = createRenderer(canvas);
    const world = mkWorld({ agents: [mkAgent(0)] });
    r.reset(world);
    r.draw(world, 0, 0); // dt=0 なので初期位置のまま
    const p = initialAgentPos(0);
    // canvas の表示サイズは論理サイズの半分 → client 座標は論理/2
    expect(r.hitTestAgent(p.x / 2, p.y / 2)).toBe(0);
    expect(r.hitTestAgent(5, 5)).toBeNull();
  });

  it('setSelectedAgent と reset が例外なく動く', () => {
    const ctx = new FakeCtx();
    const r = createRenderer(mkCanvas(ctx));
    const world = mkWorld({});
    r.reset(world);
    r.setSelectedAgent(0);
    expect(() => r.draw(world, 1.2, 1 / 60)).not.toThrow();
    r.setSelectedAgent(null);
    // エージェント数を変えて reset
    const world2 = mkWorld({ agents: [mkAgent(0), mkAgent(1), mkAgent(2), mkAgent(3)] });
    r.reset(world2);
    expect(() => r.draw(world2, 1.2, 1 / 60)).not.toThrow();
  });

  it('フィルタ除外・選抜落選の候補を含む world で各 phase の描画が例外なく回る', () => {
    const ctx = new FakeCtx();
    const r = createRenderer(mkCanvas(ctx));
    const world = mkWorld({
      candidates: [
        mkCandidate({ id: 1, agentId: 0, topic: 0, source: 'in', dropStage: 1, dropReason: 'bad' }),
        mkCandidate({ id: 2, agentId: 1, topic: 2, source: 'out', dropStage: 4, dropReason: 'rank' }),
        mkCandidate({ id: 3, agentId: 0, topic: 1, source: 'in' }),
      ],
    });
    r.reset(world);
    // phase 0, 0.5, 0.75, 0.9 を含む数拍ぶん（除外 1.75・落選 4.75 の前後を通る）
    for (const beat of [0, 0.5, 0.75, 0.9, 1, 1.75, 1.9, 2.2, 4, 4.75, 5, 5.4, 5.9]) {
      expect(() => r.draw(world, beat, 1 / 60)).not.toThrow();
    }
  });

  it('機械と箱のラベルが描かれる', () => {
    const ctx = new FakeCtx();
    const r = createRenderer(mkCanvas(ctx));
    const world = mkWorld({});
    r.reset(world);
    r.draw(world, 0, 1 / 60);
    const names = ctx.calls.filter(([n]) => n === 'fillText').map(([, a]) => a[0]);
    for (const t of ['検品', 'プレス', '削り', 'スクラップ', '落選']) {
      expect(names).toContain(t);
    }
  });
});
