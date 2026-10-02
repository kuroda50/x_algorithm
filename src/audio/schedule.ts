import {
  bassFreq,
  bellFreq,
  DRUM_PADS,
  timeline,
  topicFreq,
  VIBE_FREQS,
} from '../show/score';
import type { BeatEvents, Candidate } from '../sim/types';

// ボールが楽器に当たって鳴る音 1 つ分。AudioContext に依存しない純粋なデータ。
// Hit（show/score.ts の時刻表）との対応:
//   drum   → kick / snare / hat / openHat / shaker（DRUM_PADS のまま）
//   cymbal → cymbal     フィルタで弾かれたボール
//   vibe   → vibe       スコアの高さが鍵盤の高さ
//   bass   → bass / bassMute（休符の弦でもボールは当たる）
//   bell   → bell       選抜通過。rank 0..2 でベルが分かれる
//   trap   → clack      落とし穴の縁に当たる音
//   catch  → pluck      エージェントが受け止める。反応があれば少し後に ping
//   launch / scrap / reject → 音なし
export type NoteKind =
  | 'kick'
  | 'snare'
  | 'hat'
  | 'openHat'
  | 'shaker'
  | 'cymbal'
  | 'vibe'
  | 'bass'
  | 'bassMute'
  | 'bell'
  | 'clack'
  | 'pluck'
  | 'ping';

export interface NoteSpec {
  atBeats: number; // 拍の頭からの拍数（0 以上 1 未満。ping だけ 1 を少し超えてよい）
  kind: NoteKind;
  freq: number; // Hz。打楽器（kick..cymbal, bassMute, clack）では 0
  gain: number; // 相対音量
}

export const REACT_DELAY = 0.125; // 反応音はキャッチの少し後（32 分音符）
export const UNISON_BOOST = 1.25; // 同じ音が重なったときに掛ける倍率

// ビブラフォン・ベースの音量は拍の中の位置で変える（1 拍目が強い）。
const VIBE_GAINS: readonly number[] = [1, 0.6, 0.8, 0.6];
const BASS_GAINS: readonly number[] = [1, 0.7, 0.7, 0.7];
const TRAP_GAIN = 0.5;
const BASS_MUTE_GAIN = 0.5;

// ビート beat（整数）の 1 拍分 [beat, beat + 1) に鳴らす音。
// candidates は world.candidates（stepBeat の後の状態）、events はそのビートの stepBeat の戻り値。
export function scheduleBeat(
  candidates: readonly Candidate[],
  events: BeatEvents,
  beat: number,
): NoteSpec[] {
  const notes = new Map<string, { spec: NoteSpec; count: number }>();
  const push = (spec: NoteSpec) => {
    const key = `${spec.kind}|${spec.freq}|${spec.atBeats}`;
    const prev = notes.get(key);
    if (prev) {
      prev.count++;
      prev.spec.gain = Math.max(prev.spec.gain, spec.gain);
    } else {
      notes.set(key, { spec, count: 1 });
    }
  };

  for (const c of candidates) {
    for (const hit of timeline(c)) {
      if (hit.time < beat || hit.time >= beat + 1) continue;
      const at = hit.time - beat;
      switch (hit.kind) {
        case 'drum':
          push({ atBeats: at, kind: DRUM_PADS[hit.index], freq: 0, gain: 1 });
          break;
        case 'cymbal':
          push({ atBeats: at, kind: 'cymbal', freq: 0, gain: 1 });
          break;
        case 'vibe':
          push({
            atBeats: at,
            kind: 'vibe',
            freq: VIBE_FREQS[hit.index],
            gain: VIBE_GAINS[c.slot] ?? 1,
          });
          break;
        case 'bass': {
          const f = bassFreq(hit.time, c.slot);
          if (f === null) {
            push({ atBeats: at, kind: 'bassMute', freq: 0, gain: BASS_MUTE_GAIN });
          } else {
            push({ atBeats: at, kind: 'bass', freq: f, gain: BASS_GAINS[c.slot] ?? 1 });
          }
          break;
        }
        case 'bell':
          push({ atBeats: at, kind: 'bell', freq: bellFreq(hit.time, hit.index), gain: 1 });
          break;
        case 'trap':
          push({ atBeats: at, kind: 'clack', freq: 0, gain: TRAP_GAIN });
          break;
        case 'catch': {
          push({ atBeats: at, kind: 'pluck', freq: topicFreq(c.topic), gain: 1 });
          // 届いた候補に反応があれば、少し後に高い音を重ねる
          const d = events.delivered.find((x) => x.candidate.id === c.id);
          const reactions = d
            ? (d.item.reactions.like ? 1 : 0) +
              (d.item.reactions.reply ? 1 : 0) +
              (d.item.reactions.repost ? 1 : 0)
            : 0;
          if (reactions > 0) {
            push({
              atBeats: at + REACT_DELAY,
              kind: 'ping',
              freq: topicFreq(c.topic) * 4,
              gain: 0.6 + 0.2 * reactions,
            });
          }
          break;
        }
        default:
          break; // launch / scrap / reject は音を出さない
      }
    }
  }

  const out: NoteSpec[] = [];
  for (const { spec, count } of notes.values()) {
    // 同じ音が重なったときは少しだけ強くする
    out.push(count > 1 ? { ...spec, gain: spec.gain * UNISON_BOOST } : spec);
  }
  out.sort((a, b) => a.atBeats - b.atBeats);
  return out;
}
