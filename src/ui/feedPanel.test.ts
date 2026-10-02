import { describe, expect, it } from 'vitest';
import { maxScore } from '../sim/pipeline';
import { scoreBarWidth } from './feedPanel';
import { DEFAULT_PARAMS } from '../sim/config';
import type { Params } from '../sim/types';

const params = (over: Partial<Params> = {}): Params => ({ ...DEFAULT_PARAMS, ...over });

describe('scoreBarWidth', () => {
  it('取りうる最大のスコアで 100%、その半分で 50%', () => {
    const p = params({ wLike: 1, wReply: 1, wRepost: 1 });
    expect(scoreBarWidth(maxScore(p), p)).toBe(100);
    expect(scoreBarWidth(maxScore(p) / 2, p)).toBeCloseTo(50, 9);
  });

  it('重みの合計が 0 なら 0', () => {
    const p = params({ wLike: 0, wReply: 0, wRepost: 0 });
    expect(scoreBarWidth(5, p)).toBe(0);
  });

  it('小さいスコアでも見える最小幅がある', () => {
    const p = params({ wLike: 10, wReply: 10, wRepost: 10 });
    expect(scoreBarWidth(0.01, p)).toBe(4);
  });
});
