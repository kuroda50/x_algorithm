// 起動とメインループ。
import { createWorld, stepBeat } from './sim/world';
import { createRenderer } from './render/renderer';
import { createAudio } from './audio/audio';
import { setupControls } from './ui/controls';
import { createFeedPanel } from './ui/feedPanel';
import { createChart } from './ui/chart';
import { wireStartCard } from './ui/hud';
import { DEFAULT_AGENT_COUNT, DEFAULT_BPM, DEFAULT_PARAMS } from './sim/config';
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

function resetWorld(): void {
  world = createWorld(newSeed(), agentCount);
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

// ブラウザはユーザーの操作なしに音を出せないので、開始カードで音の有無を選ばせる。
wireStartCard(must<HTMLElement>('start-card'), () => {
  audio.setEnabled(true);
  controls.setSoundOn(true);
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
  if (moved < 6) selectAgent(renderer.hitTestAgent(e.clientX, e.clientY));
});

resetWorld();

function frame(ts: number): void {
  const dt = paused ? 0 : Math.min(0.1, (ts - last) / 1000);
  last = ts;
  if (dt > 0) {
    beat += (dt * bpm) / 60;
    while (Math.floor(beat) > world.beat) {
      const events = stepBeat(world, params);
      renderer.onBeat(world, events);
      audio.onBeat(world, events, bpm, (beat - world.beat) * (60 / bpm));
      feedPanel.update(world, selected, params);
      chart.update(world);
      controls.setStats(world.stats);
    }
  }
  renderer.draw(world, beat, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
