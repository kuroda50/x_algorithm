// schedule.ts の NoteSpec を Web Audio API の合成音で鳴らす。
// 音声ファイルは使わず、全て Oscillator / 共有ノイズ + フィルタで作る。
// 信号経路: ボイス → StereoPanner → dry ──┐
//                        └→ センド → Convolver ┴→ master → Compressor → 出力
import type { BeatEvents, World } from '../sim/types';
import { scheduleBeat, type NoteKind } from './schedule';
import { BELL_PARTIALS, CYMBAL_PARTIALS, MIX } from './voices';

export interface AudioEngine {
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  // stepBeat の直後に呼ぶ。lateSeconds は拍の頭から今までに過ぎた秒数（0 以上）。
  onBeat(world: World, events: BeatEvents, bpm: number, lateSeconds: number): void;
}

const MASTER_GAIN = 0.5; // 全部が同時に鳴っても歪まない程度。コンプレッサーは保険
const FADE_SECONDS = 0.05; // ミュート切替時のフェード
const IR_SECONDS = 2; // リバーブの長さ
const IR_DECAY = 3; // インパルス応答の減衰カーブ（大きいほど速く静かになる）

// 鳴らすために必要なノードをまとめたもの。ensure() が一度だけ作る。
interface Graph {
  ac: AudioContext;
  master: GainNode;
  dry: GainNode; // 全ボイスのドライの合流点
  verb: ConvolverNode; // リバーブ。出力は master へ
  noiseBuf: AudioBuffer; // 使い回す 1 秒のホワイトノイズ
}

// ConvolverNode 用のインパルス応答。左右で別の乱数を敷いた指数的減衰ノイズ。
function impulse(ac: AudioContext): AudioBuffer {
  const len = Math.floor(ac.sampleRate * IR_SECONDS);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, IR_DECAY);
    }
  }
  return buf;
}

// 音量の包絡。attack 秒かけて peak まで上がり、decay 秒でほぼ 0 まで指数減衰する。
// （指数ランプの終点は 0 にできないので 0.001 で止める）
function env(p: AudioParam, t: number, peak: number, attack: number, decay: number): void {
  if (attack > 0) {
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(Math.max(peak, 0.001), t + attack);
    p.exponentialRampToValueAtTime(0.001, t + attack + decay);
  } else {
    p.setValueAtTime(Math.max(peak, 0.001), t);
    p.exponentialRampToValueAtTime(0.001, t + decay);
  }
}

// 共有ノイズを dur 秒鳴らすソース。読み出し位置をずらして同じ顔の連続を避ける。
function noise(g: Graph, t: number, dur: number): AudioBufferSourceNode {
  const s = g.ac.createBufferSource();
  s.buffer = g.noiseBuf;
  s.start(t, Math.random() * Math.max(0, g.noiseBuf.duration - dur));
  s.stop(t + dur);
  return s;
}

// 1 音ぶんの出口。種類ごとの音量・パン・リバーブのセンドを持ち、
// release() に渡したソースが全部止まったらノードを外す。
function openChannel(
  g: Graph,
  kind: NoteKind,
): { input: GainNode; release: (src: AudioScheduledSourceNode) => void } {
  const mix = MIX[kind];
  const input = g.ac.createGain();
  input.gain.value = mix.gain;
  const pan = g.ac.createStereoPanner();
  pan.pan.value = mix.pan;
  input.connect(pan);
  pan.connect(g.dry);
  let send: GainNode | null = null;
  if (mix.verb > 0) {
    send = g.ac.createGain();
    send.gain.value = mix.verb;
    pan.connect(send);
    send.connect(g.verb);
  }
  let left = 0;
  return {
    input,
    release(src) {
      left++;
      src.onended = () => {
        if (--left === 0) {
          input.disconnect();
          pan.disconnect();
          send?.disconnect();
        }
      };
    },
  };
}

function osc(g: Graph, type: OscillatorType, freq: number): OscillatorNode {
  const o = g.ac.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  return o;
}

// バスドラム。サイン波を 150→45Hz に落とした胴 + 頭の短いクリック。
function kick(g: Graph, t: number, gain: number): void {
  const ch = openChannel(g, 'kick');
  const o = osc(g, 'sine', 150);
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  const v = g.ac.createGain();
  env(v.gain, t, gain, 0, 0.25);
  o.connect(v);
  v.connect(ch.input);
  o.start(t);
  o.stop(t + 0.3);
  ch.release(o);
  const s = noise(g, t, 0.05);
  const f = g.ac.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 1200;
  const cv = g.ac.createGain();
  env(cv.gain, t, gain * 0.5, 0, 0.02);
  s.connect(f);
  f.connect(cv);
  cv.connect(ch.input);
  ch.release(s);
}

// スネア。1.8kHz あたりのバンドパスノイズ + 190Hz の短いトーン。
function snare(g: Graph, t: number, gain: number): void {
  const ch = openChannel(g, 'snare');
  const s = noise(g, t, 0.2);
  const f = g.ac.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 1800;
  f.Q.value = 0.8;
  const nv = g.ac.createGain();
  env(nv.gain, t, gain, 0, 0.15);
  s.connect(f);
  f.connect(nv);
  nv.connect(ch.input);
  ch.release(s);
  const o = osc(g, 'sine', 190);
  const ov = g.ac.createGain();
  env(ov.gain, t, gain * 0.6, 0, 0.08);
  o.connect(ov);
  ov.connect(ch.input);
  o.start(t);
  o.stop(t + 0.12);
  ch.release(o);
}

// ハイハット。7kHz ハイパスのノイズ。開いている方を長くする。
function hat(g: Graph, t: number, gain: number, open: boolean): void {
  const ch = openChannel(g, open ? 'openHat' : 'hat');
  const dur = open ? 0.18 : 0.04;
  const s = noise(g, t, dur + 0.05);
  const f = g.ac.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 7000;
  const v = g.ac.createGain();
  env(v.gain, t, gain, 0, dur);
  s.connect(f);
  f.connect(v);
  v.connect(ch.input);
  ch.release(s);
}

// シェイカー。5kHz バンドパスのノイズ。立ち上がりを作って「チッ」とさせる。
function shaker(g: Graph, t: number, gain: number): void {
  const ch = openChannel(g, 'shaker');
  const s = noise(g, t, 0.15);
  const f = g.ac.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 5000;
  f.Q.value = 1.2;
  const v = g.ac.createGain();
  env(v.gain, t, gain, 0.02, 0.06);
  s.connect(f);
  f.connect(v);
  v.connect(ch.input);
  ch.release(s);
}

// シンバル。4kHz ハイパスのノイズ + 少しの金属倍音。
function cymbal(g: Graph, t: number, gain: number): void {
  const ch = openChannel(g, 'cymbal');
  const s = noise(g, t, 0.8);
  const f = g.ac.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 4000;
  const v = g.ac.createGain();
  env(v.gain, t, gain, 0.004, 0.7);
  s.connect(f);
  f.connect(v);
  v.connect(ch.input);
  ch.release(s);
  for (const [freq, amp, decay] of CYMBAL_PARTIALS) {
    const o = osc(g, 'square', freq);
    const ov = g.ac.createGain();
    env(ov.gain, t, gain * amp, 0, decay);
    o.connect(ov);
    ov.connect(ch.input);
    o.start(t);
    o.stop(t + decay + 0.05);
    ch.release(o);
  }
}

// ビブラフォン（主旋律）。基音 + 速く消える 4 倍音、柔らかい立ち上がりと浅いトレモロ。
function vibe(g: Graph, t: number, freq: number, gain: number): void {
  const ch = openChannel(g, 'vibe');
  const v = g.ac.createGain();
  env(v.gain, t, gain, 0.005, 1.2);
  v.connect(ch.input);
  // 5Hz のごく浅いトレモロを掛ける
  const trem = g.ac.createGain();
  const lfo = osc(g, 'sine', 5);
  const depth = g.ac.createGain();
  depth.gain.value = 0.1;
  lfo.connect(depth);
  depth.connect(trem.gain);
  trem.connect(v);
  lfo.start(t);
  lfo.stop(t + 1.3);
  ch.release(lfo);
  const o = osc(g, 'sine', freq);
  o.connect(trem);
  o.start(t);
  o.stop(t + 1.3);
  ch.release(o);
  const o4 = osc(g, 'sine', freq * 4);
  const v4 = g.ac.createGain();
  env(v4.gain, t, gain * 0.2, 0.005, 0.3);
  o4.connect(v4);
  v4.connect(ch.input);
  o4.start(t);
  o4.stop(t + 0.4);
  ch.release(o4);
}

// ベース。三角波 + 少しののこぎり波を、カットオフが下がるローパスに通して丸くする。
function bass(g: Graph, t: number, freq: number, gain: number): void {
  const ch = openChannel(g, 'bass');
  const f = g.ac.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(900, t);
  f.frequency.exponentialRampToValueAtTime(250, t + 0.25);
  const v = g.ac.createGain();
  env(v.gain, t, gain, 0.004, 0.3);
  f.connect(v);
  v.connect(ch.input);
  const o1 = osc(g, 'triangle', freq);
  o1.connect(f);
  const o2 = osc(g, 'sawtooth', freq);
  const g2 = g.ac.createGain();
  g2.gain.value = 0.35;
  o2.connect(g2);
  g2.connect(f);
  for (const o of [o1, o2]) {
    o.start(t);
    o.stop(t + 0.35);
    ch.release(o);
  }
}

// ミュートしたベース。80Hz 付近の短い「トッ」。
function bassMute(g: Graph, t: number, gain: number): void {
  const ch = openChannel(g, 'bassMute');
  const o = osc(g, 'triangle', 85);
  o.frequency.setValueAtTime(85, t);
  o.frequency.exponentialRampToValueAtTime(60, t + 0.05);
  const v = g.ac.createGain();
  env(v.gain, t, gain, 0.002, 0.05);
  o.connect(v);
  v.connect(ch.input);
  o.start(t);
  o.stop(t + 0.1);
  ch.release(o);
}

// ベル（選抜通過）。基音 + 非整数倍音。高い倍音ほど速く消える。
function bell(g: Graph, t: number, freq: number, gain: number): void {
  const ch = openChannel(g, 'bell');
  for (const [ratio, amp, decay] of BELL_PARTIALS) {
    const o = osc(g, 'sine', freq * ratio);
    const v = g.ac.createGain();
    env(v.gain, t, gain * amp, 0.003, decay);
    o.connect(v);
    v.connect(ch.input);
    o.start(t);
    o.stop(t + decay + 0.05);
    ch.release(o);
  }
}

// ウッドブロック（落選）。900Hz 付近の短い音 + ごく短いノイズ。
function clack(g: Graph, t: number, gain: number): void {
  const ch = openChannel(g, 'clack');
  const o = osc(g, 'sine', 900);
  o.frequency.setValueAtTime(900, t);
  o.frequency.exponentialRampToValueAtTime(750, t + 0.03);
  const v = g.ac.createGain();
  env(v.gain, t, gain, 0, 0.03);
  o.connect(v);
  v.connect(ch.input);
  o.start(t);
  o.stop(t + 0.06);
  ch.release(o);
  const s = noise(g, t, 0.02);
  const f = g.ac.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 3200;
  f.Q.value = 1.5;
  const nv = g.ac.createGain();
  env(nv.gain, t, gain * 0.4, 0, 0.015);
  s.connect(f);
  f.connect(nv);
  nv.connect(ch.input);
  ch.release(s);
}

// マリンバ（エージェントに届く）。基音 + 短い 4 倍音。
function pluck(g: Graph, t: number, freq: number, gain: number): void {
  const ch = openChannel(g, 'pluck');
  const o = osc(g, 'sine', freq);
  const v = g.ac.createGain();
  env(v.gain, t, gain, 0.002, 0.35);
  o.connect(v);
  v.connect(ch.input);
  o.start(t);
  o.stop(t + 0.42);
  ch.release(o);
  const o4 = osc(g, 'sine', freq * 4);
  const v4 = g.ac.createGain();
  env(v4.gain, t, gain * 0.3, 0.002, 0.05);
  o4.connect(v4);
  v4.connect(ch.input);
  o4.start(t);
  o4.stop(t + 0.1);
  ch.release(o4);
}

// 反応のきらめき。高いサイン波を短く。
function ping(g: Graph, t: number, freq: number, gain: number): void {
  const ch = openChannel(g, 'ping');
  const o = osc(g, 'sine', freq);
  const v = g.ac.createGain();
  env(v.gain, t, gain, 0.004, 0.15);
  o.connect(v);
  v.connect(ch.input);
  o.start(t);
  o.stop(t + 0.2);
  ch.release(o);
}

export function createAudio(): AudioEngine {
  let g: Graph | null = null;
  let on = false;

  function ensure(): void {
    if (g) return;
    const AC =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const master = ac.createGain();
    master.gain.value = MASTER_GAIN;
    const comp = ac.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ac.destination);
    const dry = ac.createGain();
    dry.connect(master);
    const verb = ac.createConvolver();
    verb.buffer = impulse(ac);
    verb.connect(master);
    const noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    g = { ac, master, dry, verb, noiseBuf };
  }

  return {
    get enabled() {
      return on;
    },
    setEnabled(next: boolean) {
      on = next;
      if (on) {
        ensure();
        if (g && g.ac.state === 'suspended') void g.ac.resume();
      }
      if (g) {
        // 残響も含めてすぐ静かにする（戻すときも同じ速さで）
        const t = g.ac.currentTime;
        g.master.gain.cancelScheduledValues(t);
        g.master.gain.setValueAtTime(g.master.gain.value, t);
        g.master.gain.linearRampToValueAtTime(on ? MASTER_GAIN : 0, t + FADE_SECONDS);
      }
    },
    onBeat(world: World, events: BeatEvents, bpm: number, lateSeconds: number) {
      if (!on || !g) return;
      const now = g.ac.currentTime;
      const head = now - Math.max(0, lateSeconds);
      const spb = 60 / bpm;
      for (const n of scheduleBeat(world.candidates, events, events.beat)) {
        const t = Math.max(now, head + n.atBeats * spb);
        switch (n.kind) {
          case 'kick':
            kick(g, t, n.gain);
            break;
          case 'snare':
            snare(g, t, n.gain);
            break;
          case 'hat':
            hat(g, t, n.gain, false);
            break;
          case 'openHat':
            hat(g, t, n.gain, true);
            break;
          case 'shaker':
            shaker(g, t, n.gain);
            break;
          case 'cymbal':
            cymbal(g, t, n.gain);
            break;
          case 'vibe':
            vibe(g, t, n.freq, n.gain);
            break;
          case 'bass':
            bass(g, t, n.freq, n.gain);
            break;
          case 'bassMute':
            bassMute(g, t, n.gain);
            break;
          case 'bell':
            bell(g, t, n.freq, n.gain);
            break;
          case 'clack':
            clack(g, t, n.gain);
            break;
          case 'pluck':
            pluck(g, t, n.freq, n.gain);
            break;
          case 'ping':
            ping(g, t, n.freq, n.gain);
            break;
          default: {
            // NoteKind が増えたらここで型エラーになる（見落とし防止）
            const exhaustive: never = n.kind;
            void exhaustive;
          }
        }
      }
    },
  };
}
