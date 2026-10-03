// 発表モードの DOM オーバーレイ。タイトル・字幕・工程・偏り指数・締めの画面を全部ここで作る。
import { SCENES, STEP_COUNT } from '../show/director';
import type { Scene } from '../show/director';
import { TOPICS } from '../sim/config';
import './show.css';

export interface ShowOverlay {
  // タイトル画面を出す / 隠す
  showTitle(): void;
  hideTitle(): void;
  // 字幕と工程の進み具合を切り替える。null で消す
  setScene(scene: Scene | null): void;
  // 個数の表示。null で隠す。active は強調する項目（0: 集めた, 1: 通過, 2: 届く, null: 強調なし）
  setFunnel(
    f: {
      launched: number;
      passed: number;
      selected: number;
      active: 0 | 1 | 2 | null;
    } | null,
  ): void;
  // 偏り指数（0..1）。null で隠す
  setBubble(value: number | null): void;
  // 一時停止中の小さな表示
  setPausedBadge(paused: boolean): void;
  // 黒い板が閉じる → onClosed → 開く。開ききったら resolve
  shutter(onClosed: () => void): Promise<void>;
  // 締めの画面を出す / 隠す
  showEnding(): void;
  hideEnding(): void;
}

const LOGO_TEXT = 'ビートオーケストラ';
// タイルごとの傾き（deg）と上下のずらし（タイルの辺に対する割合）。文字ごとに決め打ち。
const TILTS = [-6, 4, -3, 7, -5, 2, -7, 5, -2];
const DYS = [0.05, -0.06, 0.02, -0.04, 0.07, -0.07, 0.04, -0.02, 0.03];

// シャッターの時間（show.css の transition と合わせる）
const SHUTTER_CLOSE_MS = 400;
const SHUTTER_HOLD_MS = 250;
const SHUTTER_OPEN_MS = 400;

function div(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

function btn(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `show-btn ${cls}`;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// 「ビートオーケストラ」のタイルロゴ。大きさは親の --tile で決まる。
function buildLogo(): HTMLElement {
  const logo = div('show-logo');
  [...LOGO_TEXT].forEach((ch, i) => {
    const t = div('show-tile');
    t.textContent = ch;
    t.style.setProperty('--rot', `${TILTS[i % TILTS.length]}deg`);
    t.style.setProperty('--dyf', String(DYS[i % DYS.length]));
    t.style.animationDelay = `${i * 70}ms`;
    logo.append(t);
  });
  return logo;
}

export function createShowOverlay(
  root: HTMLElement,
  handlers: {
    onStartShow(): void; // 「発表を始める」
    onStartFree(): void; // 「自由に操作する」
    onReplay(): void; // 締めの画面の「もう一度」
  },
): ShowOverlay {
  // --- タイトル画面 ---
  const title = div('show-title');
  title.hidden = true;
  const brand = div('show-title-brand');
  brand.textContent = 'X レコメンド';
  const balls = div('show-balls');
  TOPICS.forEach((topic, i) => {
    const b = div('show-ball');
    b.style.setProperty('--c', topic.color);
    b.style.animationDelay = `${i * 0.9}s`;
    const inner = document.createElement('span');
    inner.className = 'show-ball-in';
    inner.style.animationDelay = `${i * -0.31}s`; // 弾みの位相をずらす
    b.append(inner);
    balls.append(b);
  });
  const sub = div('show-title-sub');
  sub.textContent = 'おすすめフィードのアルゴリズムを、音で聴く。';
  const actions = div('show-title-actions');
  actions.append(
    btn('発表を始める', 'big', handlers.onStartShow),
    btn('自由に操作する', '', handlers.onStartFree),
  );
  const hint = div('show-title-hint');
  hint.textContent = 'Space 一時停止 / → 次の場面 / Esc 自由に操作';
  title.append(brand, balls, buildLogo(), sub, actions, hint);

  // --- 字幕（左下） ---
  const caption = div('show-caption');
  caption.hidden = true;

  // 個数の表示（字幕の下に 1 行）。setScene の replaceChildren で外れても置き直す
  const funnel = div('show-funnel');
  const funnelNums: HTMLElement[] = [];
  ['集めた', '通過', '届く'].forEach((label, i) => {
    const item = div('show-funnel-item');
    const lab = document.createElement('span');
    lab.className = 'show-funnel-label';
    lab.textContent = label;
    const num = document.createElement('span');
    num.className = 'show-funnel-num';
    item.append(lab, num);
    funnel.append(item);
    funnelNums.push(num);
    if (i < 2) {
      const arrow = document.createElement('span');
      arrow.className = 'show-funnel-arrow';
      arrow.textContent = '→';
      funnel.append(arrow);
    }
  });
  let funnelOn = false;

  // --- 上中央（工程の進み具合 + 一時停止の表示） ---
  const top = div('show-top');
  top.hidden = true;
  const steps = div('show-steps');
  const squares: HTMLElement[] = [];
  for (let i = 0; i < STEP_COUNT; i++) {
    const s = div('show-step');
    squares.push(s);
    steps.append(s);
  }
  const pauseBadge = div('show-pause-badge');
  pauseBadge.textContent = '一時停止中（Space で再開）';
  pauseBadge.hidden = true;
  top.append(steps, pauseBadge);

  // --- 偏り指数（右上） ---
  const bubble = div('show-bubble');
  bubble.hidden = true;
  const bubbleLabel = div('show-bubble-label');
  bubbleLabel.textContent = 'フィードの偏り';
  const bubbleVal = div('show-bubble-val');
  bubble.append(bubbleLabel, bubbleVal);

  // --- 締めの画面 ---
  const ending = div('show-ending');
  ending.hidden = true;
  const lines = div('show-end-lines');
  const line1 = div('show-end-line');
  line1.textContent = 'あなたのタイムラインは、';
  const line2 = div('show-end-line');
  line2.textContent = 'あなたの反応でできている。';
  lines.append(line1, line2);
  const endName = div('show-end-name');
  endName.textContent = 'X レコメンド・ビートオーケストラ';
  const endActions = div('show-end-actions');
  endActions.append(
    btn('もう一度', 'big', handlers.onReplay),
    btn('自由に操作する', '', handlers.onStartFree),
  );
  ending.append(lines, buildLogo(), endName, endActions);

  // --- 場面転換の黒い板（最前面） ---
  const shutter = div('show-shutter');
  const halfTop = div('show-shutter-half top');
  const halfBottom = div('show-shutter-half bottom');
  shutter.append(halfTop, halfBottom);

  root.append(title, caption, top, bubble, ending, shutter);

  // 連続して呼ばれても順番に処理する
  let shutterChain: Promise<void> = Promise.resolve();

  return {
    showTitle() {
      title.hidden = false;
    },
    hideTitle() {
      title.hidden = true;
    },
    setScene(scene) {
      if (scene === null) {
        caption.hidden = true;
        top.hidden = true;
        return;
      }
      // 工程の番号がついていない場面は、それまでに始まった工程の数だけ塗る
      // （intro は 0、ensemble 以降は全部黒）
      const filled =
        scene.step ??
        SCENES.filter((s) => s.step !== null && s.startBeat <= scene.startBeat).length;
      squares.forEach((s, i) => s.classList.toggle('on', i < filled));
      top.hidden = false;

      caption.replaceChildren();
      if (scene.step !== null) {
        const badge = div('show-step-badge');
        badge.textContent = `${scene.step} / ${STEP_COUNT}`;
        caption.append(badge);
      }
      const t = div('show-cap-title');
      t.textContent = scene.title;
      caption.append(t);
      if (scene.caption) {
        const c = div('show-cap-sub');
        c.textContent = scene.caption;
        caption.append(c);
      }
      if (funnelOn) caption.append(funnel); // 個数は字幕の最後に置き直す
      caption.hidden = false;
    },
    setFunnel(f) {
      funnelOn = f !== null;
      if (f === null) {
        funnel.remove();
        return;
      }
      const vals = [f.launched, f.passed, f.selected];
      funnelNums.forEach((num, i) => {
        num.textContent = String(vals[i]);
        num.classList.toggle('active', f.active === i);
      });
      if (caption.lastElementChild !== funnel) caption.append(funnel);
    },
    setBubble(value) {
      if (value === null) {
        bubble.hidden = true;
        return;
      }
      bubbleVal.textContent = `${Math.round(value * 100)}%`;
      bubble.hidden = false;
    },
    setPausedBadge(paused) {
      pauseBadge.hidden = !paused;
    },
    shutter(onClosed) {
      const run = () =>
        new Promise<void>((resolve) => {
          shutter.classList.add('closed');
          setTimeout(() => {
            onClosed(); // 閉じきった瞬間に画面を入れ替える
            setTimeout(() => {
              shutter.classList.remove('closed');
              setTimeout(resolve, SHUTTER_OPEN_MS);
            }, SHUTTER_HOLD_MS);
          }, SHUTTER_CLOSE_MS);
        });
      const p = shutterChain.then(run);
      shutterChain = p;
      return p;
    },
    showEnding() {
      ending.hidden = false;
    },
    hideEnding() {
      ending.hidden = true;
    },
  };
}
