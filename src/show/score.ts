// ボール（Candidate）の時刻表。
// 「いつ・どの楽器の・どこに当たるか」を発射時の候補データだけから決める純粋な関数群で、
// 3D 描画と音の両方がここを読む。DOM にも AudioContext にも依存しない。
// 時刻の単位はすべてビート（小数）。
import type { Candidate } from '../sim/types';
import { tourTimes } from './tour';

export const SLOTS_PER_BEAT = 4; // 1 拍を 16 分音符 4 つに分けて発射する

// ボールが当たるもの。終点になるのは scrap / reject / catch。
export type HitKind =
  | 'launch' // パイプから出る。index: 0=フォロー内, 1=フォロー外
  | 'drum' // フィルタ。index: DRUM_PADS の添字
  | 'cymbal' // フィルタで弾かれたボールが当たるシンバル。index: 0
  | 'scrap' // スクラップ箱に落ちる（終点）。index: 0
  | 'vibe' // スコアリング。index: 鍵盤の添字 0..VIBE_FREQS.length-1
  | 'bass' // 多様性調整。index: 弦の添字 0..3（= slot）
  | 'bell' // 選抜を通過。index: ベルの添字 0..2（= rank）
  | 'trap' // 選抜で落選し、落とし穴の縁に当たる。index: 0 = 落選の扉、1 = 紹介の除外の扉
  | 'reject' // 落選箱に落ちる（終点）。index: 0
  | 'catch'; // エージェントが受け止める（終点）。index: agentId

export interface Hit {
  time: number; // ビート位置（小数）
  kind: HitKind;
  index: number;
}

// フィルタに置いたドラムの並び。
export const DRUM_PADS = ['kick', 'snare', 'hat', 'openHat', 'shaker'] as const;
export type DrumPad = (typeof DRUM_PADS)[number];

// ビブラフォンの鍵盤。C ペンタトニック 2 オクターブ（C4 A5 まで）。
export const VIBE_FREQS: readonly number[] = [
  261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0,
];

// 話題 0..4 に割り当てるペンタトニック（G3 A3 C4 D4 E4）
export const TOPIC_FREQS: readonly number[] = [196.0, 220.0, 261.63, 293.66, 329.63];

// 4 拍ごとに変わるコード進行。16 拍で一巡する（C Am F G）。
export interface Chord {
  name: string;
  bassRoot: number; // Hz
  bassFifth: number; // Hz
  bells: readonly [number, number, number]; // Hz。根音・3 度・5 度
}
export const CHORDS: readonly Chord[] = [
  { name: 'C', bassRoot: 130.81, bassFifth: 98.0, bells: [1046.5, 1318.51, 1567.98] },
  { name: 'Am', bassRoot: 110.0, bassFifth: 164.81, bells: [880.0, 1046.5, 1318.51] },
  { name: 'F', bassRoot: 87.31, bassFifth: 130.81, bells: [698.46, 880.0, 1046.5] },
  { name: 'G', bassRoot: 98.0, bassFifth: 146.83, bells: [783.99, 987.77, 1174.66] },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const mod = (n: number, m: number) => ((n % m) + m) % m; // 負でも 0..m-1 になる剰余

// ビート b（整数か小数。小節位置は floor で見る）でのコード。負の beat でも CHORDS の範囲に収める。
export function chordAt(beat: number): Chord {
  return CHORDS[mod(Math.floor(beat / 4), CHORDS.length)];
}

// ドラムのどのパッドに当たるか。beat は当たる拍（整数、= startBeat + 1）。
export function drumPad(beat: number, slot: number, source: 'in' | 'out'): DrumPad {
  const bar = mod(beat, 4); // 4 拍の小節の中の位置
  switch (slot) {
    case 0:
      if (source === 'in') return 'kick';
      return bar === 1 || bar === 3 ? 'snare' : 'hat';
    case 2:
      return source === 'in' ? 'openHat' : 'hat';
    default:
      return source === 'in' ? 'hat' : 'shaker';
  }
}

// スコアが高いほど高い鍵盤に当たる。0..VIBE_FREQS.length-1。
export function vibeBar(c: Candidate): number {
  return Math.min(VIBE_FREQS.length - 1, Math.floor(clamp01(c.scoreNorm) ** 0.6 * VIBE_FREQS.length));
}

// 多様性調整で鳴らすベースの音。beat は当たる時刻（小数でよい）。null はミュート。
export function bassFreq(beat: number, slot: number): number | null {
  const chord = chordAt(beat);
  switch (slot) {
    case 0:
      return chord.bassRoot;
    case 1:
      return null;
    case 2:
      return chord.bassRoot * 2;
    default:
      return chord.bassFifth;
  }
}

// 選抜を通った順位でベルを選ぶ（0..2）
export function bellIndex(c: Candidate): number {
  return Math.min(2, Math.max(0, c.rank));
}
export function bellFreq(beat: number, index: number): number {
  return chordAt(beat).bells[index];
}

// 話題番号を音にする。範囲外は端に丸める。
export function topicFreq(topic: number): number {
  const i = Math.min(Math.max(0, Math.floor(topic)), TOPIC_FREQS.length - 1);
  return TOPIC_FREQS[i];
}

// ボール 1 個の時刻表。time の昇順で、最後の要素が終点。
export function timeline(c: Candidate): Hit[] {
  if (c.tour) return tourTimeline(c);
  const t0 = c.startBeat + c.slot / SLOTS_PER_BEAT;
  const hits: Hit[] = [
    { time: t0, kind: 'launch', index: c.source === 'in' ? 0 : 1 },
    { time: t0 + 1, kind: 'drum', index: DRUM_PADS.indexOf(drumPad(c.startBeat + 1, c.slot, c.source)) },
  ];
  if (c.dropStage === 1) {
    hits.push({ time: t0 + 1.5, kind: 'cymbal', index: 0 });
    hits.push({ time: t0 + 2, kind: 'scrap', index: 0 });
    return hits;
  }
  hits.push({ time: t0 + 2, kind: 'vibe', index: vibeBar(c) });
  hits.push({ time: t0 + 3, kind: 'bass', index: c.slot });
  if (c.dropStage === 4) {
    hits.push({ time: t0 + 4, kind: 'trap', index: 0 });
    hits.push({ time: t0 + 4.5, kind: 'reject', index: 0 });
    return hits;
  }
  hits.push({ time: t0 + 4, kind: 'bell', index: bellIndex(c) });
  hits.push({ time: t0 + 5, kind: 'catch', index: c.agentId });
  return hits;
}

// 工程の紹介（ベルトコンベア）で流すボールの時刻表。
// 絶対時刻は show/tour.ts の tourTimes が決める。Hit の kind は合奏と同じものを使うので、
// 音（audio/schedule.ts）と描画の pulse はそのまま鳴る・光る。
// パイプから出る（launch）→ ベルトに落ちる（drum: ハット / シェイカー）
//   → プレス（通過はキック、除外はシンバル）→〔除外〕扉（trap:1）→ 除外箱（scrap）
//   → 計測ゲート（vibe）→ しぼり機（bass）
//   →〔落選〕扉が開く（trap:0）→ 落選箱（reject）
//   →〔通過〕ベル（bell）→ 発射台から飛んでエージェントへ（catch）
// 通過したボールは select と発射台の launch に Hit を持たない（扉が開かないことが答え）。
function tourTimeline(c: Candidate): Hit[] {
  const T = tourTimes(c);
  const hits: Hit[] = [
    { time: T.emerge, kind: 'launch', index: c.source === 'in' ? 0 : 1 },
    {
      time: T.land,
      kind: 'drum',
      index: DRUM_PADS.indexOf(c.source === 'in' ? 'hat' : 'shaker'),
    },
  ];
  if (c.dropStage === 1) {
    hits.push({ time: T.filter, kind: 'cymbal', index: 0 });
    hits.push({ time: T.scrapDoor!, kind: 'trap', index: 1 });
    hits.push({ time: T.scrap!, kind: 'scrap', index: 0 });
    return hits;
  }
  hits.push({ time: T.filter, kind: 'drum', index: DRUM_PADS.indexOf('kick') });
  hits.push({ time: T.score!, kind: 'vibe', index: vibeBar(c) });
  hits.push({ time: T.diversity!, kind: 'bass', index: c.slot });
  if (c.dropStage === 4) {
    hits.push({ time: T.select!, kind: 'trap', index: 0 });
    hits.push({ time: T.reject!, kind: 'reject', index: 0 });
    return hits;
  }
  hits.push({ time: T.bell!, kind: 'bell', index: bellIndex(c) });
  hits.push({ time: T.catch!, kind: 'catch', index: c.agentId });
  return hits;
}
