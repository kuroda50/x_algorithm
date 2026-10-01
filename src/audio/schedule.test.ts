import { describe, expect, it } from 'vitest';
import { REACT_DELAY, UNISON_BOOST, scheduleBeat } from './schedule';
import { CHORDS, TOPIC_FREQS, VIBE_FREQS } from '../show/score';
import type { BeatEvents, Candidate, Delivery, Reactions } from '../sim/types';

const NO_REACT: Reactions = { like: false, reply: false, repost: false };
const ALL_REACT: Reactions = { like: true, reply: true, repost: true };

function cand(over: Partial<Candidate> = {}): Candidate {
  return {
    id: 0,
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
    score: 0,
    scoreNorm: 0,
    adjusted: 0,
    rank: -1,
    dropStage: null,
    dropReason: null,
    ...over,
  };
}

function delivery(c: Candidate, reactions: Reactions = NO_REACT): Delivery {
  return {
    candidate: c,
    item: {
      postId: c.postId,
      topic: c.topic,
      authorId: c.authorId,
      source: c.source,
      score: 0,
      deliveredBeat: 0,
      reactions,
    },
    followed: false,
  };
}

const ev = (beat: number, over: Partial<BeatEvents> = {}): BeatEvents => ({
  beat,
  spawned: [],
  dropped: [],
  delivered: [],
  ...over,
});

describe('scheduleBeat の時間窓', () => {
  // startBeat=10, slot=0 の届くボール: drum=11, vibe=12, bass=13, bell=14, catch=15
  const c = cand({ startBeat: 10, slot: 0, rank: 0 });

  it('[beat, beat + 1) に入る Hit だけを音にする', () => {
    expect(scheduleBeat([c], ev(10), 10)).toHaveLength(0); // launch は無音
    expect(scheduleBeat([c], ev(9), 9)).toHaveLength(0); // まだ何も当たらない
    const drum = scheduleBeat([c], ev(11), 11);
    expect(drum).toEqual([{ atBeats: 0, kind: 'kick', freq: 0, gain: 1 }]);
  });

  it('slot は 16 分音符ずつ音の位置をずらす', () => {
    const s1 = cand({ startBeat: 10, slot: 1 });
    const notes = scheduleBeat([s1], ev(11), 11); // drum は 11.25
    expect(notes).toHaveLength(1);
    expect(notes[0].atBeats).toBe(0.25);
  });

  it('戻り値は atBeats の昇順', () => {
    const a = cand({ id: 1, startBeat: 10, slot: 0, scoreNorm: 0.5 }); // vibe は 12.0
    const b = cand({ id: 2, startBeat: 11, slot: 2, source: 'in' }); // drum は 12.5
    const notes = scheduleBeat([a, b], ev(12), 12);
    expect(notes.map((n) => n.atBeats)).toEqual([0, 0.5]);
  });
});

describe('Hit から音への対応', () => {
  it('drum はパッド名のまま鳴る', () => {
    const kick = scheduleBeat([cand({ startBeat: 10, slot: 0, source: 'in' })], ev(11), 11);
    expect(kick[0].kind).toBe('kick');
    // (startBeat + 1) % 4 === 1 なら out の slot 0 は snare
    const snare = scheduleBeat([cand({ startBeat: 8, slot: 0, source: 'out' })], ev(9), 9);
    expect(snare[0].kind).toBe('snare');
    const open = scheduleBeat([cand({ startBeat: 10, slot: 2, source: 'in' })], ev(11), 11);
    expect(open[0]).toMatchObject({ kind: 'openHat', atBeats: 0.5 });
  });

  it('フィルタ落ちはシンバルに飛び、スクラップ箱は無音', () => {
    const c = cand({ startBeat: 10, slot: 0, dropStage: 1, dropReason: 'bad' });
    const notes = scheduleBeat([c], ev(11), 11); // drum 11.0 + cymbal 11.5
    expect(notes).toEqual([
      { atBeats: 0, kind: 'kick', freq: 0, gain: 1 },
      { atBeats: 0.5, kind: 'cymbal', freq: 0, gain: 1 },
    ]);
    expect(scheduleBeat([c], ev(12), 12)).toHaveLength(0); // scrap は無音
  });

  it('vibe は scoreNorm で鍵盤が決まり、音量は slot で変わる', () => {
    const hi = scheduleBeat([cand({ startBeat: 10, slot: 0, scoreNorm: 1 })], ev(12), 12);
    expect(hi[0]).toMatchObject({ kind: 'vibe', freq: VIBE_FREQS[9], gain: 1 });
    const slot2 = scheduleBeat(
      [cand({ startBeat: 10, slot: 2, scoreNorm: 0.5 })],
      ev(12),
      12,
    );
    expect(slot2[0].gain).toBe(0.8);
    const slot1 = scheduleBeat(
      [cand({ startBeat: 10, slot: 1, scoreNorm: 0.5 })],
      ev(12),
      12,
    );
    expect(slot1[0].gain).toBe(0.6);
  });

  it('bass はコードの根音・5度を鳴らし、slot 1 はミュート', () => {
    // startBeat=10 の bass hit は 13.x → floor(13/4)=3 → CHORDS[3] (G)
    const root = scheduleBeat([cand({ startBeat: 10, slot: 0 })], ev(13), 13);
    expect(root[0]).toMatchObject({ kind: 'bass', freq: CHORDS[3].bassRoot, gain: 1 });
    const mute = scheduleBeat([cand({ startBeat: 10, slot: 1 })], ev(13), 13);
    expect(mute[0]).toMatchObject({ kind: 'bassMute', freq: 0, gain: 0.5 });
    const fifth = scheduleBeat([cand({ startBeat: 10, slot: 3 })], ev(13), 13);
    expect(fifth[0]).toMatchObject({ kind: 'bass', freq: CHORDS[3].bassFifth, gain: 0.7 });
  });

  it('選抜通過はベル、落選は clack で落選箱は無音', () => {
    const pass = cand({ startBeat: 10, slot: 0, rank: 1 });
    const bell = scheduleBeat([pass], ev(14), 14); // bell は 14.0 → G の小節
    expect(bell[0]).toMatchObject({ kind: 'bell', freq: CHORDS[3].bells[1], gain: 1 });
    const reject = cand({ startBeat: 10, slot: 0, dropStage: 4, dropReason: 'rank' });
    const notes = scheduleBeat([reject], ev(14), 14); // trap 14.0、reject 14.5 は無音
    expect(notes).toEqual([{ atBeats: 0, kind: 'clack', freq: 0, gain: 0.5 }]);
  });
});

describe('キャッチと反応', () => {
  const c = cand({ id: 7, startBeat: 10, slot: 0, topic: 2 }); // catch は 15.0

  it('キャッチは話題の音で pluck', () => {
    const notes = scheduleBeat([c], ev(15), 15);
    expect(notes).toEqual([{ atBeats: 0, kind: 'pluck', freq: TOPIC_FREQS[2], gain: 1 }]);
  });

  it('反応があれば REACT_DELAY 後に話題の 4 倍の ping', () => {
    const notes = scheduleBeat([c], ev(15, { delivered: [delivery(c, ALL_REACT)] }), 15);
    const ping = notes[1];
    expect(ping.kind).toBe('ping');
    expect(ping.atBeats).toBe(REACT_DELAY);
    expect(ping.freq).toBe(TOPIC_FREQS[2] * 4);
    expect(ping.gain).toBeCloseTo(1.2, 10); // 0.6 + 0.2 * 3 反応
    const one = scheduleBeat(
      [c],
      ev(15, { delivered: [delivery(c, { like: true, reply: false, repost: false })] }),
      15,
    );
    expect(one.find((n) => n.kind === 'ping')?.gain).toBeCloseTo(0.8);
  });

  it('反応なし・配信イベントに無い候補では ping は出ない', () => {
    const calm = scheduleBeat([c], ev(15, { delivered: [delivery(c)] }), 15);
    expect(calm.some((n) => n.kind === 'ping')).toBe(false);
    const other = delivery(cand({ id: 99 }), ALL_REACT); // 別の候補の反応では鳴らない
    const stray = scheduleBeat([c], ev(15, { delivered: [other] }), 15);
    expect(stray.some((n) => n.kind === 'ping')).toBe(false);
  });
});

describe('音のまとめ', () => {
  it('同じ kind・freq・atBeats は 1 つにまとめて gain を UNISON_BOOST 倍にする', () => {
    const a = cand({ id: 1, startBeat: 10, slot: 0, source: 'in' });
    const b = cand({ id: 2, startBeat: 10, slot: 0, source: 'in' });
    const notes = scheduleBeat([a, b], ev(11), 11);
    expect(notes).toEqual([{ atBeats: 0, kind: 'kick', freq: 0, gain: 1 * UNISON_BOOST }]);
  });

  it('鍵盤が違えばまとめない', () => {
    const a = cand({ id: 1, startBeat: 10, slot: 0, scoreNorm: 0.2 });
    const b = cand({ id: 2, startBeat: 10, slot: 0, scoreNorm: 0.9 });
    const notes = scheduleBeat([a, b], ev(12), 12);
    expect(notes.filter((n) => n.kind === 'vibe')).toHaveLength(2);
  });
});
