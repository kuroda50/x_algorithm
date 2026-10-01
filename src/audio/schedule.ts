import type { BeatEvents } from '../sim/types';

// 1 ビートに鳴らす音 1 つ分。AudioContext に依存しない純粋なデータ。
// 音と画面の対応:
//   kick  0     スコアリングのプレスと多様性調整の削り機が打つ（4 拍ごとに強い）
//   hat   0.5   搬入口のシャッターが開き、新しい投稿が出る
//   thud  0.75  検品機が不良品をはじく
//   clack 0.75  選抜の仕分けアームが落選品を払い落とす
//   pluck 0.75〜 投稿がエージェントに届く
//   ping  pluck の少し後 エージェントが反応する
export type NoteKind = 'kick' | 'hat' | 'pluck' | 'ping' | 'thud' | 'clack';

export interface NoteSpec {
  atBeats: number; // 拍の頭からの拍数
  kind: NoteKind;
  freq: number; // Hz。kick / hat では未使用
  gain: number; // 相対音量
}

// 話題 0..4 に割り当てるペンタトニック（C D E G A）
export const TOPIC_SCALE: readonly number[] = [261.63, 293.66, 329.63, 392.0, 440.0];

export const ARRIVAL_BEAT = 0.75; // 駅への到着が起きるビート位置（MOVE_FRACTION と同じ）
export const ARPEGGIO_STEP = 0.25; // 同時到着をずらす間隔（16 分音符）
export const MAX_ARRIVAL_NOTES = 4;
export const MAX_REACT_NOTES = 3;
export const REACT_DELAY = 0.125; // 反応音は到着音の少し後
export const REACT_FREQ = 880;
export const THUD_FREQ = 90;
export const CLACK_FREQ = 1200;

export function topicFreq(topic: number): number {
  const i = Math.min(Math.max(0, Math.floor(topic)), TOPIC_SCALE.length - 1);
  return TOPIC_SCALE[i];
}

// ビート 1 回分の発音スケジュールを決める。
export function scheduleBeat(events: BeatEvents): NoteSpec[] {
  const notes: NoteSpec[] = [];
  notes.push({ atBeats: 0, kind: 'kick', freq: 0, gain: events.beat % 4 === 0 ? 1.6 : 1 });
  notes.push({ atBeats: 0.5, kind: 'hat', freq: 0, gain: 1 });

  let reacts = 0;
  events.delivered.slice(0, MAX_ARRIVAL_NOTES).forEach((d, i) => {
    const at = ARRIVAL_BEAT + i * ARPEGGIO_STEP;
    notes.push({ atBeats: at, kind: 'pluck', freq: topicFreq(d.item.topic), gain: 1 });
    const r = d.item.reactions;
    if ((r.like || r.reply || r.repost) && reacts < MAX_REACT_NOTES) {
      reacts++;
      notes.push({ atBeats: at + REACT_DELAY, kind: 'ping', freq: REACT_FREQ, gain: 1 });
    }
  });

  if (events.dropped.some((c) => c.dropStage === 1)) {
    notes.push({ atBeats: ARRIVAL_BEAT, kind: 'thud', freq: THUD_FREQ, gain: 1 });
  }
  if (events.dropped.some((c) => c.dropStage === 4)) {
    notes.push({ atBeats: ARRIVAL_BEAT, kind: 'clack', freq: CLACK_FREQ, gain: 1 });
  }
  return notes;
}
