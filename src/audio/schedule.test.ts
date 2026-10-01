import { describe, expect, it } from 'vitest';
import {
  ARPEGGIO_STEP,
  ARRIVAL_BEAT,
  CLACK_FREQ,
  MAX_ARRIVAL_NOTES,
  REACT_DELAY,
  REACT_FREQ,
  THUD_FREQ,
  TOPIC_SCALE,
  scheduleBeat,
  topicFreq,
} from './schedule';
import type { BeatEvents, Candidate, Delivery, Reactions } from '../sim/types';

const NO_REACT: Reactions = { like: false, reply: false, repost: false };

function cand(over: Partial<Candidate> = {}): Candidate {
  return {
    id: 0,
    agentId: 0,
    postId: 0,
    topic: 0,
    authorId: 0,
    source: 'in',
    startBeat: 0,
    pLike: 0,
    pReply: 0,
    pRepost: 0,
    score: 0,
    adjusted: 0,
    dropStage: null,
    dropReason: null,
    ...over,
  };
}

function delivery(topic: number, reactions: Reactions = NO_REACT): Delivery {
  return {
    candidate: cand({ topic }),
    item: { postId: 0, topic, authorId: 0, source: 'in', score: 0, deliveredBeat: 0, reactions },
    followed: false,
  };
}

function ev(over: Partial<BeatEvents> = {}): BeatEvents {
  return { beat: 1, spawned: [], dropped: [], delivered: [], ...over };
}

describe('scheduleBeat', () => {
  it('毎拍キックと裏拍のハットを入れる', () => {
    const notes = scheduleBeat(ev({ beat: 3 }));
    const kick = notes.find((n) => n.kind === 'kick');
    const hat = notes.find((n) => n.kind === 'hat');
    expect(kick?.atBeats).toBe(0);
    expect(hat?.atBeats).toBe(0.5);
  });

  it('4 拍ごとのキックが強い', () => {
    const accent = scheduleBeat(ev({ beat: 8 })).find((n) => n.kind === 'kick');
    const normal = scheduleBeat(ev({ beat: 9 })).find((n) => n.kind === 'kick');
    expect(accent!.gain).toBeGreaterThan(normal!.gain);
  });

  it('届いた投稿は話題の音を +0.75 拍から 0.25 拍刻みで鳴らす', () => {
    const notes = scheduleBeat(ev({ delivered: [delivery(0), delivery(2), delivery(4)] }));
    const plucks = notes.filter((n) => n.kind === 'pluck');
    expect(plucks.map((n) => n.atBeats)).toEqual([
      ARRIVAL_BEAT,
      ARRIVAL_BEAT + ARPEGGIO_STEP,
      ARRIVAL_BEAT + ARPEGGIO_STEP * 2,
    ]);
    expect(plucks.map((n) => n.freq)).toEqual([
      TOPIC_SCALE[0],
      TOPIC_SCALE[2],
      TOPIC_SCALE[4],
    ]);
  });

  it('到着音は 1 拍あたり 4 音まで', () => {
    const notes = scheduleBeat(
      ev({ delivered: [0, 1, 2, 3, 4, 0].map((t) => delivery(t)) }),
    );
    expect(notes.filter((n) => n.kind === 'pluck')).toHaveLength(MAX_ARRIVAL_NOTES);
  });

  it('反応のある到着だけ高い音を少し後に鳴らす（最大 3）', () => {
    const like: Reactions = { like: true, reply: false, repost: false };
    const notes = scheduleBeat(
      ev({
        delivered: [delivery(0, like), delivery(1), delivery(2, like), delivery(3, like), delivery(4, like)],
      }),
    );
    const pings = notes.filter((n) => n.kind === 'ping');
    expect(pings).toHaveLength(3);
    expect(pings[0].atBeats).toBeCloseTo(ARRIVAL_BEAT + REACT_DELAY);
    expect(pings.every((n) => n.freq === REACT_FREQ)).toBe(true);
  });

  it('dropStage 1 の除外で低い音が 1 つだけ鳴る', () => {
    const notes = scheduleBeat(
      ev({ dropped: [cand({ dropStage: 1, dropReason: 'bad' }), cand({ dropStage: 4, dropReason: 'rank' })] }),
    );
    const thuds = notes.filter((n) => n.kind === 'thud');
    expect(thuds).toHaveLength(1);
    expect(thuds[0].atBeats).toBe(ARRIVAL_BEAT);
    expect(thuds[0].freq).toBe(THUD_FREQ);
  });

  it('選抜落ちだけでは低い音を鳴らさない', () => {
    const notes = scheduleBeat(ev({ dropped: [cand({ dropStage: 4, dropReason: 'rank' })] }));
    expect(notes.some((n) => n.kind === 'thud')).toBe(false);
  });

  it('dropStage 4 が複数あってもカチッは 1 つだけ鳴る', () => {
    const notes = scheduleBeat(
      ev({
        dropped: [
          cand({ dropStage: 4, dropReason: 'rank' }),
          cand({ dropStage: 4, dropReason: 'rank' }),
          cand({ dropStage: 4, dropReason: 'rank' }),
        ],
      }),
    );
    const clacks = notes.filter((n) => n.kind === 'clack');
    expect(clacks).toHaveLength(1);
    expect(clacks[0].atBeats).toBe(ARRIVAL_BEAT);
    expect(clacks[0].freq).toBe(CLACK_FREQ);
  });

  it('フィルタ落ちだけではカチッを鳴らさない', () => {
    const notes = scheduleBeat(ev({ dropped: [cand({ dropStage: 1, dropReason: 'bad' })] }));
    expect(notes.some((n) => n.kind === 'clack')).toBe(false);
  });

  it('何も落ちないときはカチッを鳴らさない', () => {
    const notes = scheduleBeat(ev({ delivered: [delivery(0)] }));
    expect(notes.some((n) => n.kind === 'clack')).toBe(false);
  });
});

describe('topicFreq', () => {
  it('範囲外の話題は両端に丸める', () => {
    expect(topicFreq(0)).toBe(TOPIC_SCALE[0]);
    expect(topicFreq(4)).toBe(TOPIC_SCALE[4]);
    expect(topicFreq(99)).toBe(TOPIC_SCALE[4]);
  });
});
