// ボール（Candidate）の軌道。時刻表（show/score.ts の timeline）だけから
// 今の位置・大きさ・不透明度を決める純粋な関数で、状態を持たない。
// 各 Hit の時刻にちょうど打点に居ることが、音との同期の約束。
import type { Candidate } from '../sim/types';
import { TOPICS } from '../sim/config';
import { timeline } from '../show/score';
import { clamp01, hitPoint, p3, type P3 } from './stageLayout';

export const HOP_HEIGHT = 2.2; // 1 拍の区間で跳ねたときの最高到達点
export const BALL_R = 0.22; // 基準の半径
export const TAIL_STEPS = 10; // 尾の数
export const TAIL_DT = 0.016; // 尾 1 つ分の時間差（ビート）
export const VANISH_CATCH = 0.25; // 受け止められて縮んで消えるまでのビート数
export const VANISH_BIN = 0.3; // 箱に落ちて消えるまでのビート数
export const SIZE_BLEND = 0.15; // 大きさが切り替わるまでのビート数

export const CYMBAL_COLOR = '#e24b4a'; // フィルタで弾かれたあとの色
export const TRAP_COLOR = '#8b8f96'; // 落選したあとの色

export interface BallState {
  pos: P3;
  radius: number; // 描画半径。消えていく演出で 0 まで小さくなる
  opacity: number; // 0..1
  color: string;
  visible: boolean;
}

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const smooth = (u: number): number => {
  const t = clamp01(u);
  return t * t * (3 - 2 * t);
};

// ボール 1 個の今の状態。beat は小数のビート位置、agentPos は捕まえるエージェントの受け皿の今の位置。
export function ballState(c: Candidate, beat: number, agentPos: P3): BallState {
  const hits = timeline(c);
  const first = hits[0];
  const base: BallState = {
    pos: hitPoint(first, c, agentPos),
    radius: 0,
    opacity: 0,
    color: TOPICS[c.topic].color,
    visible: false,
  };
  if (!Number.isFinite(beat) || beat < first.time) return base;

  // 大きさ: vibe の打点でスコア、bass の打点で多様性調整が効く。
  let scale = 1;
  for (const h of hits) {
    if (h.kind === 'vibe') {
      const f = 0.75 + 0.65 * clamp01(c.scoreNorm);
      scale *= 1 + (f - 1) * smooth((beat - h.time) / SIZE_BLEND);
    } else if (h.kind === 'bass') {
      const f = c.score > 0 ? Math.min(1, Math.max(0.5, c.adjusted / c.score)) : 1;
      scale *= 1 + (f - 1) * smooth((beat - h.time) / SIZE_BLEND);
    }
  }

  // 色: 話題の色。フィルタで弾かれたあとは赤、落選したあとは灰色。
  let color = base.color;
  for (const h of hits) {
    if (h.kind === 'cymbal' && beat >= h.time) color = CYMBAL_COLOR;
    if (h.kind === 'trap' && beat >= h.time) color = TRAP_COLOR;
  }

  const last = hits[hits.length - 1];
  if (beat >= last.time) {
    const age = beat - last.time;
    const P = hitPoint(last, c, agentPos);
    if (last.kind === 'catch') {
      // 受け皿の中で縮んで消える（位置は受け皿についていく）
      const s = Math.max(0, 1 - age / VANISH_CATCH);
      return { pos: P, radius: BALL_R * scale * s, opacity: s, color, visible: s > 0 };
    }
    // scrap / reject: 箱の中へ沈みながら消える
    const s = Math.max(0, 1 - age / VANISH_BIN);
    return {
      pos: p3(P.x, P.y - age * 1.4, P.z),
      radius: BALL_R * scale,
      opacity: s,
      color,
      visible: s > 0,
    };
  }

  // 今いる区間 hits[i] -> hits[i+1] を探す
  let i = 0;
  while (i < hits.length - 2 && beat >= hits[i + 1].time) i++;
  const h0 = hits[i];
  const h1 = hits[i + 1];
  const dur = h1.time - h0.time;
  const u = dur > 0 ? clamp01((beat - h0.time) / dur) : 1;
  const P0 = hitPoint(h0, c, agentPos);
  const P1 = hitPoint(h1, c, agentPos);
  // 放物線: 区間の両端でちょうど打点（u=0,1 で高さ 0）、中央で HOP_HEIGHT * dur²。
  // dur² に比例させるので、半拍の跳ねは 1/4 の高さ = 重力が一定に見える。
  const hop = HOP_HEIGHT * dur * dur * 4 * u * (1 - u);
  return {
    pos: p3(lerp(P0.x, P1.x, u), lerp(P0.y, P1.y, u) + hop, lerp(P0.z, P1.z, u)),
    radius: BALL_R * scale,
    opacity: 1,
    color,
    visible: true,
  };
}
