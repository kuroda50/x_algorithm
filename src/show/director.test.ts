import { describe, expect, it } from 'vitest';
import {
  LEARN_START_BEAT,
  SCENES,
  SHOW_END_BEAT,
  STEP_COUNT,
  TOUR_END_BEAT,
  bpmAt,
  learningRateAt,
  requestAt,
  sceneAt,
  sceneIndexAt,
  showSeconds,
} from './director';
import { TOUR_SPAWN_BEAT } from './tour';

describe('SCENES', () => {
  it('startBeat の昇順で、最初が 0、最後が SHOW_END_BEAT より前', () => {
    expect(SCENES[0].startBeat).toBe(0);
    for (let i = 1; i < SCENES.length; i++) {
      expect(SCENES[i].startBeat).toBeGreaterThan(SCENES[i - 1].startBeat);
    }
    expect(SCENES[SCENES.length - 1].startBeat).toBeLessThan(SHOW_END_BEAT);
  });

  it('step が 1..6 を順に 1 回ずつ含む', () => {
    const steps = SCENES.filter((s) => s.step !== null).map((s) => s.step);
    expect(steps).toEqual([1, 2, 3, 4, 5, 6]);
    expect(steps.length).toBe(STEP_COUNT);
  });
});

describe('sceneAt / sceneIndexAt', () => {
  it('場面の途中ではその場面を返す', () => {
    expect(sceneAt(0).id).toBe('intro');
    expect(sceneAt(3.9).id).toBe('intro');
  });

  it('境界の拍ちょうどで次の場面を返す', () => {
    for (const s of SCENES) {
      expect(sceneAt(s.startBeat).id).toBe(s.id);
      expect(sceneIndexAt(s.startBeat)).toBe(SCENES.indexOf(s));
    }
  });

  it('負の拍・終了後の拍でも落ちない', () => {
    expect(sceneAt(-100).id).toBe(SCENES[0].id);
    expect(sceneIndexAt(-1)).toBe(0);
    expect(sceneAt(SHOW_END_BEAT).id).toBe(SCENES[SCENES.length - 1].id);
    expect(sceneAt(10000).id).toBe(SCENES[SCENES.length - 1].id);
  });
});

describe('bpmAt', () => {
  it('拍に対して減らない', () => {
    let prev = -Infinity;
    for (let b = -1; b <= SHOW_END_BEAT + 10; b += 0.5) {
      const v = bpmAt(b);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('learningRateAt', () => {
  it('LEARN_START_BEAT より前は 0、以降は normal', () => {
    expect(learningRateAt(63.9, 0.16)).toBe(0);
    expect(learningRateAt(LEARN_START_BEAT - 0.1, 0.16)).toBe(0);
    expect(learningRateAt(LEARN_START_BEAT, 0.16)).toBe(0.16);
    expect(learningRateAt(0, 0.16)).toBe(0);
  });
});

describe('requestAt', () => {
  it('工程の紹介中は TOUR_SPAWN_BEAT の拍だけフィード要求する', () => {
    expect(requestAt(TOUR_SPAWN_BEAT)).toBe(true);
    expect(requestAt(1)).toBe(false);
    expect(requestAt(TOUR_SPAWN_BEAT - 1)).toBe(false);
    expect(requestAt(TOUR_SPAWN_BEAT + 1)).toBe(false);
    expect(requestAt(63)).toBe(false);
  });

  it('TOUR_END_BEAT 以降は毎拍要求する', () => {
    expect(requestAt(TOUR_END_BEAT)).toBe(true);
    expect(requestAt(TOUR_END_BEAT + 1)).toBe(true);
  });
});

describe('showSeconds', () => {
  it('160〜178 秒（3 分の発表に収まる）', () => {
    expect(showSeconds()).toBeGreaterThanOrEqual(160);
    expect(showSeconds()).toBeLessThanOrEqual(178);
  });
});
