import { describe, expect, it } from 'vitest';
import { MOVE_FRACTION } from '../sim/config';
import { beltProgress, isAccent, SLAT_PITCH, slatDistances, strokeAt } from './factory';

describe('strokeAt', () => {
  it('hit の瞬間に 1 で、拍をまたいで連続する', () => {
    expect(strokeAt(0, 0)).toBe(1);
    expect(strokeAt(0.75, 0.75)).toBe(1);
    // hit の直前（前の拍の終わり）は 1 に近い
    expect(strokeAt(0.99, 0)).toBeGreaterThan(0.7);
  });

  it('hit から release 以上たつと 0 に戻る', () => {
    expect(strokeAt(0.25, 0)).toBe(0);
    expect(strokeAt(0.5, 0)).toBe(0);
    expect(strokeAt(0.26, 0.9)).toBe(0); // hit から 0.36 後
  });

  it('hit 直前の windup 区間は単調増加する', () => {
    let prev = -1;
    for (const phase of [0.89, 0.92, 0.95, 0.98]) {
      const v = strokeAt(phase, 0);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('hit の直後は 1 から減衰する', () => {
    expect(strokeAt(0.1, 0)).toBeCloseTo(0.6);
    expect(strokeAt(0.9, 0.75)).toBeCloseTo(0.4);
  });
});

describe('beltProgress', () => {
  it('整数ビートで 0、phase が MOVE_FRACTION 以上で 1', () => {
    expect(beltProgress(3)).toBe(0);
    expect(beltProgress(3 + MOVE_FRACTION)).toBe(1);
    expect(beltProgress(3.99)).toBe(1);
  });

  it('1 拍の中では phase に対して単調非減少', () => {
    let prev = -1;
    for (let i = 0; i < 40; i++) {
      const v = beltProgress(i / 40);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('slatDistances', () => {
  const LEN = 100;

  it('0 以上 pathLen 未満・昇順で、本数は pathLen/SLAT_PITCH の丸め（最低 1）', () => {
    const d = slatDistances(LEN, 0);
    expect(d.length).toBe(Math.round(LEN / SLAT_PITCH));
    for (let i = 0; i < d.length; i++) {
      expect(d[i]).toBeGreaterThanOrEqual(0);
      expect(d[i]).toBeLessThan(LEN);
      if (i > 0) expect(d[i]).toBeGreaterThan(d[i - 1]);
    }
    expect(slatDistances(5, 0).length).toBe(1);
  });

  it('progress 0 と 1 で同じ並びになる', () => {
    const a = slatDistances(LEN, 0);
    const b = slatDistances(LEN, 1);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i]);
  });

  it('progress 0.5 では 0 のときとずれている', () => {
    const a = slatDistances(LEN, 0);
    const b = slatDistances(LEN, 0.5);
    expect(b.some((v, i) => Math.abs(v - a[i]) > 1e-9)).toBe(true);
  });
});

describe('isAccent', () => {
  it('4 拍ごとの拍頭が強拍になる', () => {
    for (const beat of [4, 8, 3.9, 4.2]) expect(isAccent(beat)).toBe(true);
    for (const beat of [1, 2.4, 5]) expect(isAccent(beat)).toBe(false);
  });
});
