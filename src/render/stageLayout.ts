// 3D ステージ上の楽器・箱・地区の位置と、ボールが各 Hit で触れる点。
// three.js にも DOM にも依存しない純粋なデータと関数だけを置く。
// 座標系は y が上で、ボールは左（-x）のパイプから右（+x）のエージェントの街へ進む。
import type { Hit } from '../show/score';
import type { Candidate } from '../sim/types';

export interface P3 {
  x: number;
  y: number;
  z: number;
}

export const p3 = (x: number, y: number, z: number): P3 => ({ x, y, z });

export const clamp01 = (u: number): number => Math.min(1, Math.max(0, u));

// 決定的な疑似乱数 [0, 1)。配置のゆらぎや火花の向きに使う。
export function hash01(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

// --- 発射パイプ（口の位置がボールの発射点） ---
export const PIPE_IN_MOUTH = p3(-11, 6.5, -2.2);
export const PIPE_OUT_MOUTH = p3(-11, 6.5, 2.2);
export const PIPE_IN_COLOR = '#5aa2e8';
export const PIPE_OUT_COLOR = '#f0a040';

export function pipeMouth(index: number): P3 {
  return index === 0 ? PIPE_IN_MOUTH : PIPE_OUT_MOUTH;
}

// --- フィルタのドラム。添字は DRUM_PADS と同じ（kick, snare, hat, openHat, shaker）。
// 打点は打面の中心。
export const DRUM_HITS: readonly P3[] = [
  p3(-7.0, 1.35, 0.0), // kick（大きい胴）
  p3(-7.6, 1.75, -1.5), // snare
  p3(-6.3, 2.2, -2.6), // hat
  p3(-7.6, 2.0, 1.5), // openHat
  p3(-6.4, 1.75, 2.5), // shaker
];

// --- 除外シンバルとスクラップ箱 ---
export const CYMBAL_POS = p3(-5, 4.2, 4);
export const SCRAP_BIN = p3(-3.5, 0, 5.5);
export const BIN_SIZE = { w: 1.5, h: 1.0, d: 1.5 };
export const SCRAP_MOUTH = p3(SCRAP_BIN.x, BIN_SIZE.h, SCRAP_BIN.z);

// --- スコアリングのビブラフォン。鍵盤は z 方向に並ぶ ---
export const VIBE_X = -2.5;
export const VIBE_BAR_Y = 1.8; // 鍵盤の上面
export const VIBE_Z0 = -3.2;
export const VIBE_DZ = 6.4 / 9; // 10 枚を z = -3.2..3.2 に並べる
export const VIBE_BAR_W = 0.52; // 鍵盤の幅（z 方向）
export const VIBE_BAR_T = 0.09; // 厚さ

export function vibeBarZ(i: number): number {
  return VIBE_Z0 + i * VIBE_DZ;
}

// 鍵盤の長さ（x 方向）。低い音（添字が小さい）ほど長い。
export function vibeBarLen(i: number): number {
  return 1.8 - i * 0.09;
}

export function vibeBarHit(i: number): P3 {
  return p3(VIBE_X, VIBE_BAR_Y, vibeBarZ(i));
}

// --- 多様性調整のベース弦。弦は x 方向に張り、z 方向に 4 本並べる ---
export const BASS_Y = 1.5;
export const BASS_HIT_X = 2.0;
export const BASS_STRING_ZS: readonly number[] = [-1.35, -0.45, 0.45, 1.35];
export const BASS_STRING_X0 = 0.9; // 弦の両端（枠の内側）
export const BASS_STRING_X1 = 3.1;

export function bassStringHit(i: number): P3 {
  return p3(BASS_HIT_X, BASS_Y, BASS_STRING_ZS[i]);
}

// --- 選抜のベル（0..2 = 1位〜3位） ---
export const BELL_ZS: readonly number[] = [-1.5, 0, 1.5];
export const BELL_X = 6;
export const BELL_Y = 2.4; // ベルの中心
export const BELL_HIT_Y = 2.1; // 打点はベルの下縁あたり
export const BELL_COLORS: readonly string[] = ['#e8c35a', '#c8ccd4', '#b0783f']; // 金・銀・銅

export function bellHit(i: number): P3 {
  return p3(BELL_X, BELL_HIT_Y, BELL_ZS[i]);
}

// --- 落とし穴（落選）と落選箱 ---
export const TRAP_RIM = p3(6, 1.0, 3.6); // じょうごの縁（打点）
export const TRAP_CENTER = p3(6, 0.55, 4.2); // じょうごの中心
export const REJECT_BIN = p3(7, 0, 5);
export const REJECT_MOUTH = p3(REJECT_BIN.x, BIN_SIZE.h, REJECT_BIN.z);

// --- 興味の街（話題の地区が床に並ぶ円） ---
export const DISTRICT_CENTER = p3(13, 0, 0);
export const DISTRICT_R = 4.5;
export const DISTRICT_DISC_R = 1.15;
export const AGENT_BOWL_Y = 0.8; // エージェントの受け皿の高さ
export const BOWL_R = 0.38;

// 話題 i の地区の位置。正 n 角形の頂点で、奥（-z）から時計回り。
export function districtPos(i: number, n: number): P3 {
  const a = -Math.PI / 2 + (i * Math.PI * 2) / Math.max(1, n);
  return p3(
    DISTRICT_CENTER.x + Math.cos(a) * DISTRICT_R,
    0,
    DISTRICT_CENTER.z + Math.sin(a) * DISTRICT_R,
  );
}

// 同じスロットで発射されるフォロー内・フォロー外の 2 個が打点で重ならないよう、
// source で打面の中に収まる程度にずらす量。
const LANE_OFF = 0.16;
const BASS_LANE_OFF = 0.3; // 弦は x 方向なので進行方向にずらす

// Hit ごとのボールの打点。catch だけエージェントの今の位置（agentPos）を使う。
export function hitPoint(hit: Hit, c: Candidate, agentPos: P3): P3 {
  const zo = c.source === 'in' ? -LANE_OFF : LANE_OFF;
  switch (hit.kind) {
    case 'launch':
      return pipeMouth(hit.index);
    case 'drum': {
      const p = DRUM_HITS[hit.index];
      return p3(p.x, p.y, p.z + zo);
    }
    case 'cymbal':
      return CYMBAL_POS;
    case 'scrap':
      return SCRAP_MOUTH;
    case 'vibe': {
      const p = vibeBarHit(hit.index);
      return p3(p.x, p.y, p.z + zo * 0.7);
    }
    case 'bass': {
      const p = bassStringHit(hit.index);
      return p3(p.x + (c.source === 'in' ? -BASS_LANE_OFF : BASS_LANE_OFF), p.y, p.z);
    }
    case 'bell': {
      const p = bellHit(hit.index);
      return p3(p.x, p.y, p.z + zo);
    }
    case 'trap':
      return TRAP_RIM;
    case 'reject':
      return REJECT_MOUTH;
    case 'catch':
      return agentPos;
  }
}
