import type { NoteKind } from './schedule';

// 音色の調整値を集めた純粋なデータ。audio.ts がここを読む。Web Audio API には依存しない。
// 聞きやすさの微調整はこのファイルだけを触ればよい。

// 種類ごとの音量・左右・リバーブ量。
// 音量の序列は、ドラムとベースが土台、ビブラフォンが主旋律、ベルとマリンバが彩り。
// ハイハットとシェイカーは 16 分で鳴り続けるので、うるさくならない小ささにする。
export interface VoiceMix {
  gain: number; // NoteSpec.gain に掛ける音量
  pan: number; // -1 が左、1 が右。ステージ上の楽器の位置（左→右）に合わせる
  verb: number; // リバーブへのセンド量（0 ならドライのみ）
}

export const MIX: Record<NoteKind, VoiceMix> = {
  kick: { gain: 0.9, pan: -0.3, verb: 0 },
  snare: { gain: 0.4, pan: -0.35, verb: 0.12 },
  hat: { gain: 0.12, pan: -0.4, verb: 0 },
  openHat: { gain: 0.16, pan: -0.4, verb: 0.12 },
  shaker: { gain: 0.07, pan: -0.25, verb: 0 },
  cymbal: { gain: 0.28, pan: -0.2, verb: 0.5 },
  vibe: { gain: 0.35, pan: -0.1, verb: 0.4 },
  bass: { gain: 0.5, pan: 0, verb: 0 },
  bassMute: { gain: 0.18, pan: 0, verb: 0 },
  bell: { gain: 0.3, pan: 0.25, verb: 0.5 },
  clack: { gain: 0.25, pan: 0.3, verb: 0.12 },
  pluck: { gain: 0.3, pan: 0.5, verb: 0.2 },
  ping: { gain: 0.12, pan: 0.5, verb: 0.5 },
};

// ベルの倍音。[周波数比, 相対音量, 減衰秒] — 高い倍音ほど小さく速く消える。
export const BELL_PARTIALS: readonly (readonly [number, number, number])[] = [
  [1, 1, 1.6],
  [2.76, 0.4, 0.7],
  [5.4, 0.18, 0.4],
];

// シンバルに混ぜる金属的な非整数倍音（矩形波）。[周波数 Hz, 相対音量, 減衰秒]
export const CYMBAL_PARTIALS: readonly (readonly [number, number, number])[] = [
  [587, 0.05, 0.35],
  [842, 0.04, 0.28],
  [1249, 0.03, 0.2],
];
