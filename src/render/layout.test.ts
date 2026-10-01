import { describe, expect, it } from 'vitest';
import {
  agentRoute,
  DISTRICT_CENTER,
  DISTRICT_R,
  districtPos,
  easeInOut,
  hash01,
  IN_LINE,
  laneOffset,
  pathLength,
  pointAlong,
  pointAlongFrac,
  pt,
  STATION_FILTER,
  STATION_IN,
} from './layout';

describe('pointAlong / pointAlongFrac', () => {
  it('始点・終点・中間のセグメント上の点を返す', () => {
    const len = pathLength(IN_LINE);
    // 90->110 の水平 20 + 斜め hypot(140,140) ≈ 197.99
    expect(len).toBeCloseTo(20 + Math.hypot(140, 140), 5);

    const p0 = pointAlong(IN_LINE, 0);
    expect(p0.x).toBeCloseTo(STATION_IN.x);
    expect(p0.y).toBeCloseTo(STATION_IN.y);

    const p10 = pointAlong(IN_LINE, 10);
    expect(p10.x).toBeCloseTo(100);
    expect(p10.y).toBeCloseTo(190);
    expect(p10.dx).toBeCloseTo(1);
    expect(p10.dy).toBeCloseTo(0);

    const pEnd = pointAlong(IN_LINE, len);
    expect(pEnd.x).toBeCloseTo(STATION_FILTER.x);
    expect(pEnd.y).toBeCloseTo(STATION_FILTER.y);
    // 斜め部は 45°
    expect(pEnd.dx).toBeCloseTo(Math.SQRT1_2);
    expect(pEnd.dy).toBeCloseTo(Math.SQRT1_2);
  });

  it('frac の 0 と 1 は両端、0.5 は折れ線の中点', () => {
    const a = pointAlongFrac(IN_LINE, 0);
    expect(a.x).toBeCloseTo(90);
    const b = pointAlongFrac(IN_LINE, 1);
    expect(b.x).toBeCloseTo(250);
    const mid = pointAlongFrac(IN_LINE, 0.5);
    // 半分の距離 109 ≈ 20 + 89 → 斜め部の途中
    expect(mid.x).toBeCloseTo(110 + 89 * Math.SQRT1_2);
    expect(mid.y).toBeCloseTo(190 + 89 * Math.SQRT1_2);
  });

  it('範囲外は端に clamp される', () => {
    const a = pointAlong(IN_LINE, -50);
    expect(a.x).toBeCloseTo(90);
    const b = pointAlong(IN_LINE, 9999);
    expect(b.x).toBeCloseTo(250);
  });
});

describe('agentRoute', () => {
  it('横向きが大きいとき: 45° 斜め → 水平', () => {
    const r = agentRoute(pt(670, 330), pt(975, 500));
    expect(r).toHaveLength(3);
    const c = r[1];
    // 斜め部は 45°（|dx| == |dy|）
    expect(Math.abs(c.x - 670)).toBeCloseTo(Math.abs(c.y - 330));
    // 角のあとは水平
    expect(c.y).toBeCloseTo(500);
    expect(r[2]).toEqual({ x: 975, y: 500 });
  });

  it('縦向きが大きいとき: 45° 斜め → 垂直', () => {
    const r = agentRoute(pt(670, 330), pt(700, 600));
    expect(r).toHaveLength(3);
    const c = r[1];
    expect(Math.abs(c.x - 670)).toBeCloseTo(Math.abs(c.y - 330));
    expect(c.x).toBeCloseTo(700);
    expect(r[2]).toEqual({ x: 700, y: 600 });
  });

  it('水平・垂直だけのときは直線', () => {
    expect(agentRoute(pt(670, 330), pt(975, 330))).toHaveLength(2);
    expect(agentRoute(pt(670, 330), pt(670, 500))).toHaveLength(2);
  });
});

describe('easeInOut', () => {
  it('端点と中点', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(0.25)).toBeCloseTo(0.125);
    expect(easeInOut(0.75)).toBeCloseTo(0.875);
  });
});

describe('districtPos', () => {
  it('5 地区は半径 250 の正五角形で、先頭は真上', () => {
    const d0 = districtPos(0, 5);
    expect(d0.x).toBeCloseTo(DISTRICT_CENTER.x);
    expect(d0.y).toBeCloseTo(DISTRICT_CENTER.y - DISTRICT_R);
    for (let i = 0; i < 5; i++) {
      const d = districtPos(i, 5);
      expect(Math.hypot(d.x - DISTRICT_CENTER.x, d.y - DISTRICT_CENTER.y)).toBeCloseTo(DISTRICT_R);
    }
  });
});

describe('hash01 / laneOffset', () => {
  it('hash01 は決定的で [0,1)', () => {
    for (const n of [0, 1, 42, 12345]) {
      const v = hash01(n);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(hash01(n)).toBe(v);
    }
  });

  it('laneOffset は ±24 程度に収まる', () => {
    for (let a = 0; a < 12; a++) {
      for (let c = 0; c < 20; c++) {
        const v = laneOffset(a, 12, c);
        expect(Math.abs(v)).toBeLessThanOrEqual(24);
      }
    }
    expect(laneOffset(0, 1, 3)).toBeLessThanOrEqual(4);
  });
});
