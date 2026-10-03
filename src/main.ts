// 起動とメインループ。
import { createWorld, stepBeat } from './sim/world';
import { createRenderer } from './render/renderer';
import { createAudio } from './audio/audio';
import { setupControls } from './ui/controls';
import { createFeedPanel } from './ui/feedPanel';
import { createChart } from './ui/chart';
import { createShowOverlay } from './ui/showOverlay';
import { DEFAULT_AGENT_COUNT, DEFAULT_BPM, DEFAULT_PARAMS } from './sim/config';
import {
  SCENES,
  SHOW_END_BEAT,
  SHOW_SEED,
  bpmAt,
  learningRateAt,
  sceneIndexAt,
} from './show/director';
import type { Params, World } from './sim/types';

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} がありません`);
  return el as T;
}

function newSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) | 0;
}

const canvas = must<HTMLCanvasElement>('stage');
const renderer = createRenderer(canvas);
const audio = createAudio();

const params: Params = { ...DEFAULT_PARAMS };
let bpm = DEFAULT_BPM;
let agentCount = DEFAULT_AGENT_COUNT;
let world: World;
let beat = 0;
let paused = false;
let selected: number | null = null;
let last = performance.now();

// 画面モード。'title' →（発表を始める）→ 'show' →（最後の拍）→ 'ending'。いつでも 'free' に抜けられる。
type Mode = 'title' | 'show' | 'ending' | 'free';
let mode: Mode = 'title';
let sceneIndex = -1; // 出している場面の添字（-1: なし）
let skipUntil: number | null = null; // → で飛ばしている先の拍。追いつくまで stepBeat だけ回す

const feedPanel = createFeedPanel(must<HTMLElement>('feed-panel'), (id) => selectAgent(id));
const chart = createChart(must<HTMLElement>('chart-panel'));
const dock = must<HTMLElement>('dock');

function selectAgent(id: number | null): void {
  selected = id === selected ? null : id;
  renderer.setSelectedAgent(selected);
  // パネルは選択中だけ出す。隠れている間は大きさが 0 で描かれないことがあるので、出し直すたびに更新する。
  dock.hidden = selected === null;
  feedPanel.update(world, selected, params);
  chart.update(world);
}

function resetWorld(seed: number = newSeed()): void {
  world = createWorld(seed, agentCount);
  beat = 0;
  selected = null;
  renderer.reset(world);
  renderer.setSelectedAgent(null);
  dock.hidden = true;
  feedPanel.update(world, null, params);
  chart.update(world);
  controls.setStats(world.stats);
}

// 設定・見方のパネルは同時に開かない（片方を開くともう片方が閉じる）
const settingsPanel = must<HTMLElement>('settings-panel');
const guidePanel = must<HTMLElement>('guide-panel');
let settingsOpen = false;
let guideOpen = false;
function setOverlays(settings: boolean, guide: boolean): void {
  settingsOpen = settings;
  guideOpen = guide;
  settingsPanel.hidden = !settings;
  guidePanel.hidden = !guide;
  controls.setSettingsOpen(settings);
  controls.setGuideOpen(guide);
}

const controls = setupControls({
  slidersEl: must<HTMLElement>('sliders'),
  buttonsEl: must<HTMLElement>('buttons'),
  params,
  onBpmChange: (v) => {
    bpm = v;
  },
  onAgentCountChange: (v) => {
    agentCount = v;
    resetWorld();
  },
  onPauseChange: (p) => {
    paused = p;
  },
  onSoundChange: (on) => audio.setEnabled(on),
  onReset: () => resetWorld(),
  onToggleSettings: () => setOverlays(!settingsOpen, false),
  onToggleGuide: () => setOverlays(false, !guideOpen),
});

const overlay = createShowOverlay(must<HTMLElement>('show-root'), {
  onStartShow: () => startShow(),
  onStartFree: () => startFree(),
  onReplay: () => startShow(),
});

// 「発表を始める」「もう一度」。ブラウザはユーザーの操作なしに音を出せないので、
// 音の有効化はクリックの中で行い、画面の入れ替えはシャッターが閉じた隙に行う。
function startShow(): void {
  audio.setEnabled(true);
  controls.setSoundOn(true);
  void overlay
    .shutter(() => {
      overlay.hideTitle();
      overlay.hideEnding();
      agentCount = DEFAULT_AGENT_COUNT;
      resetWorld(SHOW_SEED);
      paused = false;
      controls.setPaused(false);
      overlay.setPausedBadge(false);
      skipUntil = null;
      sceneIndex = sceneIndexAt(beat);
      document.body.classList.add('show-running');
      const scene = SCENES[sceneIndex];
      overlay.setScene(scene);
      renderer.setView(scene.view);
      overlay.setBubble(null);
    })
    .then(() => {
      mode = 'show';
    });
}

// 「自由に操作する」。発表の進行を止めて、いつもの操作画面に戻す。音は鳴らさない。
function startFree(): void {
  mode = 'free';
  overlay.hideTitle();
  overlay.hideEnding();
  overlay.setScene(null);
  overlay.setBubble(null);
  overlay.setPausedBadge(false);
  document.body.classList.remove('show-running');
  renderer.setView(null);
  bpm = DEFAULT_BPM;
  params.learningRate = DEFAULT_PARAMS.learningRate;
  paused = false;
  controls.setPaused(false);
  audio.setEnabled(false);
  controls.setSoundOn(false);
  skipUntil = null;
  sceneIndex = -1;
  resetWorld();
}

function currentBubble(): number {
  const m = world.metrics;
  return m.length > 0 ? m[m.length - 1].bubble : 0;
}

// 発表の進行中だけ効くキー操作。入力欄にフォーカスがあるときは無視する。
window.addEventListener('keydown', (e) => {
  if (mode !== 'show') return;
  const t = e.target as HTMLElement | null;
  if (
    t &&
    (t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT' ||
      t.isContentEditable)
  ) {
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    paused = !paused;
    controls.setPaused(paused);
    overlay.setPausedBadge(paused);
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    const next =
      sceneIndexAt(beat) + 1 < SCENES.length
        ? SCENES[sceneIndexAt(beat) + 1].startBeat
        : SHOW_END_BEAT;
    if (next > beat) {
      skipUntil = next;
      beat = next;
    }
  } else if (e.code === 'Escape') {
    startFree();
  }
});

// 押してからほとんど動かずに離したときだけクリックとみなして選択する。
let dragStart: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  dragStart = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', (e) => {
  if (!dragStart) return;
  const moved = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
  dragStart = null;
  // エージェントのクリック選択は自由操作のときだけ
  if (moved < 6 && mode === 'free') selectAgent(renderer.hitTestAgent(e.clientX, e.clientY));
});

resetWorld();
overlay.showTitle();

function frame(ts: number): void {
  if (mode === 'show') {
    bpm = bpmAt(beat);
    params.learningRate = learningRateAt(beat, DEFAULT_PARAMS.learningRate);
    const si = sceneIndexAt(beat);
    if (si !== sceneIndex) {
      sceneIndex = si;
      const scene = SCENES[si];
      overlay.setScene(scene);
      renderer.setView(scene.view);
      overlay.setBubble(scene.showBubble ? currentBubble() : null);
    }
    if (beat >= SHOW_END_BEAT) {
      mode = 'ending';
      void overlay.shutter(() => {
        overlay.setScene(null);
        overlay.setBubble(null);
        overlay.showEnding();
        audio.setEnabled(false);
        controls.setSoundOn(false);
      });
    }
  }
  const running = (mode === 'free' || mode === 'show') && !paused;
  const dt = running ? Math.min(0.1, (ts - last) / 1000) : 0;
  last = ts;
  if (dt > 0 || skipUntil !== null) {
    beat += (dt * bpm) / 60;
    while (Math.floor(beat) > world.beat) {
      // 飛ばし中は stepBeat だけ回す（renderer.onBeat と audio.onBeat は呼ばない）
      const skipping = skipUntil !== null && world.beat < skipUntil;
      // 飛ばした拍にも、その拍の時点の設定を当てる（色がつき始める拍をずらさない）
      if (mode === 'show') {
        params.learningRate = learningRateAt(world.beat + 1, DEFAULT_PARAMS.learningRate);
      }
      const events = stepBeat(world, params);
      if (!skipping) {
        renderer.onBeat(world, events);
        audio.onBeat(world, events, bpm, (beat - world.beat) * (60 / bpm));
        feedPanel.update(world, selected, params);
        chart.update(world);
        controls.setStats(world.stats);
      }
      if (skipUntil !== null && world.beat >= skipUntil) skipUntil = null;
      if (mode === 'show' && SCENES[sceneIndex].showBubble) {
        overlay.setBubble(currentBubble());
      }
    }
  }
  renderer.draw(world, beat, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
