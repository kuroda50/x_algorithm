// 起動とメインループ。
import { createWorld, stepBeat } from './sim/world';
import { createRenderer } from './render/renderer';
import { createAudio } from './audio/audio';
import { setupControls } from './ui/controls';
import { createFeedPanel } from './ui/feedPanel';
import { createChart } from './ui/chart';
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

function selectAgent(id: number | null): void {
  selected = id === selected ? null : id;
  renderer.setSelectedAgent(selected);
  feedPanel.update(world, selected, params);
}

function resetWorld(): void {
  world = createWorld(newSeed(), agentCount);
  beat = 0;
  selected = null;
  renderer.reset(world);
  renderer.setSelectedAgent(null);
  feedPanel.update(world, null, params);
  chart.update(world);
  controls.setStats(world.stats);
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
});

canvas.addEventListener('click', (e) => {
  selectAgent(renderer.hitTestAgent(e.clientX, e.clientY));
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
