import { describe, expect, it } from 'vitest';
import { spreadLabels, xScale } from './chart';
import type { MetricsPoint } from '../sim/types';

const pt = (beat: number, bubble = 0, similarity = 0): MetricsPoint => ({ beat, bubble, similarity });

describe('spreadLabels', () => {
  it('十分離れていればそのまま', () => {
    expect(spreadLabels(10, 40, 14, 0, 100)).toEqual([10, 40]);
  });

  it('近いときは中点の周りに minGap だけ離す', () => {
    const [a, b] = spreadLabels(20, 24, 14, 0, 100);
    expect(b - a).toBe(14);
    expect((a + b) / 2).toBeCloseTo(22);
  });

  it('上端に張り付くときは下にずらす', () => {
    const [a, b] = spreadLabels(0, 3, 14, 0, 100);
    expect(a).toBe(0);
    expect(b).toBe(14);
  });

  it('下端に張り付くときは上にずらす', () => {
    const [a, b] = spreadLabels(97, 100, 14, 0, 100);
    expect(b).toBe(100);
    expect(a).toBe(86);
  });
});

describe('xScale', () => {
  const points = [pt(10), pt(20), pt(30)];

  it('先頭が左端・末尾が右端', () => {
    const x = xScale(points, 200, 26);
    expect(x(10)).toBe(26);
    expect(x(30)).toBe(226);
    expect(x(20)).toBe(126);
  });

  it('点が 1 つなら中央に置く', () => {
    const x = xScale([pt(5)], 200, 26);
    expect(x(5)).toBe(126);
  });
});
