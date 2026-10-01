// HUD の DOM 組み立てと開閉まわり。
import { TOPICS } from '../sim/config';

const ICON_MINUS =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const ICON_PLUS =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9M8 3.5v9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

// 話題の色丸と名前を横並びの凡例にして入れる。
export function buildLegend(el: HTMLElement): void {
  for (const t of TOPICS) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    const dot = document.createElement('span');
    dot.className = 'legend-dot';
    dot.style.background = t.color;
    item.append(dot, document.createTextNode(t.name));
    el.append(item);
  }
}

export interface PanelFold {
  set(collapsed: boolean): void;
}

// wrap 内の .panel-fold ボタンを、.panel-body の折りたたみに配線する。
// 畳むと見出し（.panel-bar）だけが残る。
export function wirePanelFold(wrap: HTMLElement): PanelFold {
  const btn = wrap.querySelector<HTMLButtonElement>('.panel-fold');
  const body = wrap.querySelector<HTMLElement>('.panel-body');
  const set = (collapsed: boolean): void => {
    wrap.classList.toggle('collapsed', collapsed);
    if (body) body.hidden = collapsed;
    if (btn) {
      btn.setAttribute('aria-expanded', String(!collapsed));
      btn.setAttribute('aria-label', collapsed ? 'パネルを開く' : 'パネルを折りたたむ');
      btn.innerHTML = collapsed ? ICON_PLUS : ICON_MINUS;
    }
  };
  btn?.addEventListener('click', () => set(!wrap.classList.contains('collapsed')));
  set(false);
  return { set };
}

// 開始カード。「音を鳴らして始める」は onSound を呼ぶ。どちらを選んでもカードは閉じる。
// （ブラウザはユーザーの操作なしに音を出せないので、ここで音の有無を選ばせる）
export function wireStartCard(card: HTMLElement, onSound: () => void): void {
  const close = (): void => {
    card.hidden = true;
  };
  card.querySelector('#start-sound')?.addEventListener('click', () => {
    onSound();
    close();
  });
  card.querySelector('#start-mute')?.addEventListener('click', close);
}
