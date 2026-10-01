import { describe, expect, it } from 'vitest';
import {
  CHORDS,
  DRUM_PADS,
  TOPIC_FREQS,
  VIBE_FREQS,
  bassFreq,
  bellFreq,
  bellIndex,
  chordAt,
  drumPad,
  timeline,
  topicFreq,
  vibeBar,
} from './score';
import type { Candidate } from '../sim/types';

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

describe('timeline', () => {
  it('届くボール: launch → drum → vibe → bass → bell → catch', () => {
    const c = cand({ startBeat: 10, slot: 0, rank: 1, agentId: 2, source: 'in' });
    const hits = timeline(c);
    expect(hits.map((h) => h.kind)).toEqual([
      'launch',
      'drum',
      'vibe',
      'bass',
      'bell',
      'catch',
    ]);
    expect(hits.map((h) => h.time)).toEqual([10, 11, 12, 13, 14, 15]);
    expect(hits[0].index).toBe(0); // フォロー内のパイプ
    expect(hits[1].index).toBe(DRUM_PADS.indexOf('kick')); // in・slot0 は kick
    expect(hits[4].index).toBe(1); // rank 1 → 2 番目のベル
    // 最後の Hit が終点
    expect(hits.at(-1)?.kind).toBe('catch');
    expect(hits.at(-1)?.index).toBe(2); // 受け止めるエージェント
  });

  it('フィルタ落ち: launch → drum → cymbal → scrap で終わる', () => {
    const c = cand({
      startBeat: 10,
      slot: 2,
      source: 'out',
      dropStage: 1,
      dropReason: 'bad',
    });
    const hits = timeline(c);
    expect(hits.map((h) => h.kind)).toEqual(['launch', 'drum', 'cymbal', 'scrap']);
    expect(hits.map((h) => h.time)).toEqual([10.5, 11.5, 12, 12.5]);
    expect(hits[0].index).toBe(1); // フォロー外のパイプ
    expect(hits.at(-1)?.kind).toBe('scrap');
  });

  it('落選: launch → drum → vibe → bass → trap → reject で終わる', () => {
    const c = cand({ startBeat: 10, slot: 1, dropStage: 4, dropReason: 'rank' });
    const hits = timeline(c);
    expect(hits.map((h) => h.kind)).toEqual([
      'launch',
      'drum',
      'vibe',
      'bass',
      'trap',
      'reject',
    ]);
    expect(hits.map((h) => h.time)).toEqual([10.25, 11.25, 12.25, 13.25, 14.25, 14.75]);
    expect(hits.at(-1)?.kind).toBe('reject');
  });

  it('時刻は常に昇順で、slot が拍の中の位置をずらす', () => {
    for (const dropStage of [null, 1, 4] as const) {
      for (let slot = 0; slot < 4; slot++) {
        const hits = timeline(cand({ startBeat: 10, slot, dropStage, rank: 0 }));
        for (let i = 1; i < hits.length; i++) {
          expect(hits[i].time).toBeGreaterThan(hits[i - 1].time);
        }
        expect(hits[0].time).toBe(10 + slot / 4);
      }
    }
  });
});

describe('drumPad', () => {
  it('slot 0: in は kick、out は小節の 2・4 拍目で snare、他は hat', () => {
    expect(drumPad(0, 0, 'in')).toBe('kick');
    expect(drumPad(6, 0, 'in')).toBe('kick');
    for (const beat of [1, 3, 5, 7, 9]) expect(drumPad(beat, 0, 'out')).toBe('snare');
    for (const beat of [0, 2, 4, 6, 8]) expect(drumPad(beat, 0, 'out')).toBe('hat');
  });

  it('slot 2: in は openHat、out は hat', () => {
    expect(drumPad(0, 2, 'in')).toBe('openHat');
    expect(drumPad(1, 2, 'out')).toBe('hat');
    expect(drumPad(3, 2, 'out')).toBe('hat');
  });

  it('slot 1,3: in は hat、out は shaker', () => {
    for (const slot of [1, 3]) {
      expect(drumPad(0, slot, 'in')).toBe('hat');
      expect(drumPad(2, slot, 'out')).toBe('shaker');
    }
  });
});

describe('vibeBar', () => {
  it('scoreNorm 0 → 0、1 → いちばん高い鍵盤', () => {
    expect(vibeBar(cand({ scoreNorm: 0 }))).toBe(0);
    expect(vibeBar(cand({ scoreNorm: 1 }))).toBe(VIBE_FREQS.length - 1);
  });

  it('scoreNorm に対して単調非減少', () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = vibeBar(cand({ scoreNorm: i / 20 }));
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(prev).toBe(VIBE_FREQS.length - 1);
  });

  it('範囲外の scoreNorm は端に丸める', () => {
    expect(vibeBar(cand({ scoreNorm: -0.5 }))).toBe(0);
    expect(vibeBar(cand({ scoreNorm: 2 }))).toBe(VIBE_FREQS.length - 1);
  });
});

describe('chordAt', () => {
  it('4 拍ごとに C → Am → F → G と変わり、16 拍で一巡する', () => {
    expect(chordAt(0).name).toBe('C');
    expect(chordAt(3.9).name).toBe('C');
    expect(chordAt(4).name).toBe('Am');
    expect(chordAt(8).name).toBe('F');
    expect(chordAt(12).name).toBe('G');
    expect(chordAt(16).name).toBe('C');
  });

  it('負の beat でも CHORDS の範囲に収まる', () => {
    expect(chordAt(-0.5).name).toBe('G'); // 直前の小節
    expect(chordAt(-4).name).toBe('G');
    expect(chordAt(-5).name).toBe('F');
    expect(chordAt(-16).name).toBe('C');
  });
});

describe('bassFreq', () => {
  it('slot 0 根音 / 1 ミュート / 2 オクターブ上の根音 / 3 5 度', () => {
    const c = CHORDS[0]; // beat 0 は C
    expect(bassFreq(0, 0)).toBe(c.bassRoot);
    expect(bassFreq(0, 1)).toBeNull();
    expect(bassFreq(0, 2)).toBe(c.bassRoot * 2);
    expect(bassFreq(0, 3)).toBe(c.bassFifth);
  });

  it('コードは当たる時刻で決まる', () => {
    expect(bassFreq(4.5, 0)).toBe(CHORDS[1].bassRoot);
    expect(bassFreq(12.75, 3)).toBe(CHORDS[3].bassFifth);
  });
});

describe('bellIndex / bellFreq', () => {
  it('rank を 0..2 に丸める', () => {
    expect(bellIndex(cand({ rank: -1 }))).toBe(0);
    expect(bellIndex(cand({ rank: 0 }))).toBe(0);
    expect(bellIndex(cand({ rank: 1 }))).toBe(1);
    expect(bellIndex(cand({ rank: 2 }))).toBe(2);
    expect(bellIndex(cand({ rank: 9 }))).toBe(2);
  });

  it('ベルの音はコードの構成音', () => {
    expect(bellFreq(0, 0)).toBe(CHORDS[0].bells[0]);
    expect(bellFreq(4, 2)).toBe(CHORDS[1].bells[2]);
  });
});

describe('topicFreq', () => {
  it('話題 0..4 に G3..E4、範囲外は端に丸める', () => {
    expect(topicFreq(0)).toBe(TOPIC_FREQS[0]);
    expect(topicFreq(4)).toBe(TOPIC_FREQS[4]);
    expect(topicFreq(99)).toBe(TOPIC_FREQS[4]);
    expect(topicFreq(-1)).toBe(TOPIC_FREQS[0]);
  });
});
