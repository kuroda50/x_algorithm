import type { BeatEvents, World } from '../sim/types';
import { scheduleBeat } from './schedule';

export interface AudioEngine {
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  // stepBeat の直後に呼ぶ。lateSeconds は拍の頭から今までに過ぎた秒数（0 以上）。
  onBeat(world: World, events: BeatEvents, bpm: number, lateSeconds: number): void;
}

export function createAudio(): AudioEngine {
  let ac: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let on = false;

  function ensure(): void {
    if (ac) return;
    const AC =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.5;
    const comp = ac.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.05), ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function tone(t: number, freq: number, gain: number, dur: number, type: OscillatorType = 'sine'): void {
    if (!ac || !master) return;
    const o = ac.createOscillator();
    const v = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    v.gain.setValueAtTime(gain, t);
    v.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(v);
    v.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function kick(t: number, accent: number): void {
    if (!ac || !master) return;
    const o = ac.createOscillator();
    const v = ac.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    v.gain.setValueAtTime(0.22 * accent, t);
    v.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(v);
    v.connect(master);
    o.start(t);
    o.stop(t + 0.22);
  }

  function hat(t: number): void {
    if (!ac || !master || !noiseBuf) return;
    const s = ac.createBufferSource();
    s.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const v = ac.createGain();
    v.gain.value = 0.05;
    s.connect(f);
    f.connect(v);
    v.connect(master);
    s.start(t);
    s.stop(t + 0.06);
  }

  return {
    get enabled() {
      return on;
    },
    setEnabled(next: boolean) {
      on = next;
      if (on) {
        ensure();
        if (ac && ac.state === 'suspended') void ac.resume();
      }
    },
    onBeat(world: World, events: BeatEvents, bpm: number, lateSeconds: number) {
      if (!on || !ac) return;
      const now = ac.currentTime;
      const head = now - Math.max(0, lateSeconds);
      const spb = 60 / bpm;
      for (const n of scheduleBeat(world.candidates, events, events.beat)) {
        const t = Math.max(now, head + n.atBeats * spb);
        switch (n.kind) {
          case 'kick':
            kick(t, n.gain);
            break;
          case 'snare':
          case 'hat':
          case 'openHat':
          case 'shaker':
          case 'cymbal':
            hat(t);
            break;
          case 'vibe':
            tone(t, n.freq, 0.07 * n.gain, 0.5);
            break;
          case 'bass':
            tone(t, n.freq, 0.1 * n.gain, 0.3, 'triangle');
            break;
          case 'bassMute':
            tone(t, 90, 0.05 * n.gain, 0.15, 'square');
            break;
          case 'bell':
            tone(t, n.freq, 0.05 * n.gain, 0.8);
            break;
          case 'clack':
            tone(t, 1200, 0.025 * n.gain, 0.05, 'triangle');
            break;
          case 'pluck':
            tone(t, n.freq, 0.07 * n.gain, 0.35);
            break;
          case 'ping':
            tone(t, n.freq, 0.03 * n.gain, 0.12);
            break;
        }
      }
    },
  };
}
