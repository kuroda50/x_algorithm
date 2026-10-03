import {
  DEFAULT_BPM,
  DEFAULT_AGENT_COUNT,
  MAX_AGENT_COUNT,
  MIN_AGENT_COUNT,
} from '../sim/config';
import type { Params, Stats } from '../sim/types';

export interface ControlsCallbacks {
  onBpmChange(bpm: number): void;
  onAgentCountChange(count: number): void;
  onPauseChange(paused: boolean): void;
  onSoundChange(on: boolean): void;
  onReset(): void;
  onToggleSettings(): void;
  onToggleGuide(): void;
  onBackToTitle(): void;
}

export interface Controls {
  setPaused(paused: boolean): void;
  setSoundOn(on: boolean): void;
  setStats(stats: Stats): void;
  setSettingsOpen(open: boolean): void;
  setGuideOpen(open: boolean): void;
}

export interface ControlsOptions extends ControlsCallbacks {
  slidersEl: HTMLElement;
  buttonsEl: HTMLElement;
  params: Params; // スライダーが直接書き換える
}

const SVG_OPEN = '<svg viewBox="0 0 16 16" aria-hidden="true">';
const ICONS = {
  soundOn: `${SVG_OPEN}<path d="M2 6v4h3l4 3.5v-11L5 6H2z" fill="currentColor"/><path d="M11 5.5a3.4 3.4 0 0 1 0 5M12.5 3.6a6 6 0 0 1 0 8.8" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>`,
  soundOff: `${SVG_OPEN}<path d="M2 6v4h3l4 3.5v-11L5 6H2z" fill="currentColor"/><path d="M11 6l4 4m0-4-4 4" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>`,
  pause: `${SVG_OPEN}<path d="M4.5 2.5h2.5v11H4.5zM9 2.5h2.5v11H9z" fill="currentColor"/></svg>`,
  play: `${SVG_OPEN}<path d="M5 2.5l8 5.5-8 5.5z" fill="currentColor"/></svg>`,
  reset: `${SVG_OPEN}<path d="M8 2a6 6 0 1 0 6 6h-1.6A4.4 4.4 0 1 1 8 3.6V6l4.2-3.2L8 0v2z" fill="currentColor"/></svg>`,
  settings: `${SVG_OPEN}<path d="M2 4.5h12M2 8h12M2 11.5h12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="5.5" cy="4.5" r="1.7" fill="currentColor"/><circle cx="10.5" cy="8" r="1.7" fill="currentColor"/><circle cx="6.5" cy="11.5" r="1.7" fill="currentColor"/></svg>`,
  guide: `${SVG_OPEN}<circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6.4 5.9a1.7 1.7 0 1 1 2.4 1.7c-.7.35-.8.7-.8 1.4v.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="11.4" r=".85" fill="currentColor"/></svg>`,
  home: `${SVG_OPEN}<path d="M8 1.8 1.5 7.6h1.9V14h3.4v-4h2.4v4h3.4V7.6h1.9z" fill="currentColor"/></svg>`,
};

interface SliderDef {
  label: string;
  min: number;
  max: number;
  step: number;
  initial: number;
  set(v: number): void;
}

function makeButton(html: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'btn';
  b.innerHTML = html;
  b.setAttribute('aria-label', label);
  b.title = label;
  b.addEventListener('click', onClick);
  return b;
}

export function setupControls(opts: ControlsOptions): Controls {
  const { slidersEl, buttonsEl, params } = opts;
  const defs: SliderDef[] = [
    { label: 'いいね重み', min: 0, max: 10, step: 1, initial: params.wLike, set: (v) => (params.wLike = v) },
    { label: 'リプライ重み', min: 0, max: 10, step: 1, initial: params.wReply, set: (v) => (params.wReply = v) },
    { label: 'リポスト重み', min: 0, max: 10, step: 1, initial: params.wRepost, set: (v) => (params.wRepost = v) },
    {
      label: '同じ投稿者の抑制',
      min: 0,
      max: 100,
      step: 5,
      initial: Math.round(params.diversity * 100),
      set: (v) => (params.diversity = v / 100),
    },
    {
      label: 'フォロー外の係数',
      min: 0,
      max: 150,
      step: 5,
      initial: Math.round(params.oonFactor * 100),
      set: (v) => (params.oonFactor = v / 100),
    },
    {
      label: '興味の偏りやすさ',
      min: 0,
      max: 30,
      step: 1,
      initial: Math.round(params.learningRate * 100),
      set: (v) => (params.learningRate = v / 100),
    },
    {
      label: 'エージェント数',
      min: MIN_AGENT_COUNT,
      max: MAX_AGENT_COUNT,
      step: 1,
      initial: DEFAULT_AGENT_COUNT,
      set: (v) => opts.onAgentCountChange(v),
    },
    { label: 'BPM', min: 80, max: 160, step: 5, initial: DEFAULT_BPM, set: (v) => opts.onBpmChange(v) },
  ];

  for (const def of defs) {
    const row = document.createElement('label');
    row.className = 'row';
    const name = document.createElement('span');
    name.textContent = def.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    input.value = String(def.initial);
    const out = document.createElement('b');
    out.textContent = String(def.initial);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = input.value;
      def.set(v);
    });
    row.append(name, input, out);
    slidersEl.append(row);
  }

  let paused = false;
  let soundOn = false;
  const btnSound = makeButton(ICONS.soundOff, '音を鳴らす', () => {
    soundOn = !soundOn;
    renderSound();
    opts.onSoundChange(soundOn);
  });
  const btnPause = makeButton(ICONS.pause, '一時停止', () => {
    paused = !paused;
    renderPause();
    opts.onPauseChange(paused);
  });
  const btnReset = makeButton(ICONS.reset, 'リセット', () => opts.onReset());
  const btnSettings = makeButton(ICONS.settings, '設定', () => opts.onToggleSettings());
  btnSettings.setAttribute('aria-controls', 'settings-panel');
  btnSettings.setAttribute('aria-expanded', 'false');
  const btnGuide = makeButton(ICONS.guide, '見方', () => opts.onToggleGuide());
  btnGuide.setAttribute('aria-controls', 'guide-panel');
  btnGuide.setAttribute('aria-expanded', 'false');
  const btnHome = makeButton(ICONS.home, 'タイトルに戻る', () => opts.onBackToTitle());
  const stats = document.createElement('span');
  stats.className = 'stats';
  buttonsEl.append(btnHome, btnSound, btnPause, btnReset, btnSettings, btnGuide, stats);

  function renderSound(): void {
    const label = soundOn ? '音を止める' : '音を鳴らす';
    btnSound.innerHTML = soundOn ? ICONS.soundOn : ICONS.soundOff;
    btnSound.setAttribute('aria-pressed', String(soundOn));
    btnSound.setAttribute('aria-label', label);
    btnSound.title = label;
  }
  function renderPause(): void {
    const label = paused ? '再開' : '一時停止';
    btnPause.innerHTML = paused ? ICONS.play : ICONS.pause;
    btnPause.setAttribute('aria-pressed', String(paused));
    btnPause.setAttribute('aria-label', label);
    btnPause.title = label;
  }
  renderSound();
  renderPause();

  return {
    setPaused(p: boolean) {
      paused = p;
      renderPause();
    },
    setSoundOn(on: boolean) {
      soundOn = on;
      renderSound();
    },
    setStats(s: Stats) {
      stats.textContent = `投稿 ${s.posts} / 除外 ${s.dropped} / 反応 ${s.reactions}`;
    },
    setSettingsOpen(open: boolean) {
      btnSettings.setAttribute('aria-expanded', String(open));
    },
    setGuideOpen(open: boolean) {
      btnGuide.setAttribute('aria-expanded', String(open));
    },
  };
}
