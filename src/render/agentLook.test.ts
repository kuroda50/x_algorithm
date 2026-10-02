import { describe, expect, it } from 'vitest';
import { interestTint, TINT_FULL } from './agentLook';

describe('interestTint', () => {
  it('均等な興味なら amount 0（白のまま）', () => {
    const t = interestTint([0.2, 0.2, 0.2, 0.2, 0.2]);
    expect(t.amount).toBe(0);
  });

  it('1 話題が TINT_FULL 以上なら amount 1 でその話題', () => {
    const t = interestTint([0.55, 0.15, 0.1, 0.1, 0.1]);
    expect(t.topic).toBe(0);
    expect(t.amount).toBe(1);
    const t2 = interestTint([0.1, 0.1, 0.5, 0.2, 0.1]);
    expect(t2.topic).toBe(2);
    expect(t2.amount).toBe(1);
  });

  it('途中の値は 0 と 1 の間', () => {
    const t = interestTint([0.35, 0.2, 0.15, 0.15, 0.15]);
    expect(t.topic).toBe(0);
    expect(t.amount).toBeGreaterThan(0);
    expect(t.amount).toBeLessThan(1);
  });

  it('TINT_FULL は話題の半分の割合', () => {
    expect(TINT_FULL).toBe(0.5);
  });

  it('空配列・合計 0 でも NaN を返さない', () => {
    for (const v of [[], [0, 0, 0], [0.2, 0.2], [0, 0, 0, 0, 0]]) {
      const t = interestTint(v);
      expect(Number.isFinite(t.topic)).toBe(true);
      expect(Number.isFinite(t.amount)).toBe(true);
    }
  });
});
