// HUD の DOM 組み立てと開閉まわり。

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
