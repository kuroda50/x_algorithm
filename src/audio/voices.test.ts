import { describe, expect, it } from 'vitest';
import type { NoteKind } from './schedule';
import { BELL_PARTIALS, CYMBAL_PARTIALS, MIX } from './voices';

const ALL_KINDS: readonly NoteKind[] = [
  'kick',
  'snare',
  'hat',
  'openHat',
  'shaker',
  'cymbal',
  'vibe',
  'bass',
  'bassMute',
  'bell',
  'clack',
  'pluck',
  'ping',
];

describe('MIX', () => {
  it('全ての NoteKind ちょうどに設定がある', () => {
    expect(Object.keys(MIX).sort()).toEqual([...ALL_KINDS].sort());
  });

  it('音量・パン・リバーブ量が妥当な範囲', () => {
    for (const k of ALL_KINDS) {
      const m = MIX[k];
      expect(m.gain).toBeGreaterThan(0);
      expect(m.gain).toBeLessThanOrEqual(1);
      expect(m.pan).toBeGreaterThanOrEqual(-1);
      expect(m.pan).toBeLessThanOrEqual(1);
      expect(m.verb).toBeGreaterThanOrEqual(0);
      expect(m.verb).toBeLessThanOrEqual(1);
    }
  });

  it('16 分で鳴り続けるハイハットとシェイカーは小さい', () => {
    expect(MIX.hat.gain).toBeLessThan(MIX.kick.gain * 0.25);
    expect(MIX.shaker.gain).toBeLessThan(MIX.hat.gain);
    expect(MIX.openHat.gain).toBeLessThan(MIX.snare.gain);
  });
});

describe('倍音データ', () => {
  it('ベルは高い倍音ほど小さく速く減衰する', () => {
    for (let i = 1; i < BELL_PARTIALS.length; i++) {
      expect(BELL_PARTIALS[i][0]).toBeGreaterThan(BELL_PARTIALS[i - 1][0]);
      expect(BELL_PARTIALS[i][1]).toBeLessThan(BELL_PARTIALS[i - 1][1]);
      expect(BELL_PARTIALS[i][2]).toBeLessThan(BELL_PARTIALS[i - 1][2]);
    }
  });

  it('シンバルの倍音は整数倍でない（金属的な響きのため）', () => {
    const base = CYMBAL_PARTIALS[0][0];
    for (const [freq] of CYMBAL_PARTIALS.slice(1)) {
      const ratio = freq / base;
      expect(Math.abs(ratio - Math.round(ratio))).toBeGreaterThan(0.05);
    }
  });
});
