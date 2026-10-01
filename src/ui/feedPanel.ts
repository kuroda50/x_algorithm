import { TOPICS, agentColor } from '../sim/config';
import { feedDistribution } from '../sim/metrics';
import { scorePost } from '../sim/pipeline';
import type { Agent, FeedItem, Params, World } from '../sim/types';

const FEED_TOP = 6;
const TILE_FADE_MS = 320;

const ICONS = {
  like: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13.8C3.8 10.6 1.5 8.1 1.5 5.7 1.5 3.7 3 2.2 4.9 2.2c1.2 0 2.3.6 3.1 1.7.8-1.1 1.9-1.7 3.1-1.7 1.9 0 3.4 1.5 3.4 3.5 0 2.4-2.3 4.9-6.5 8.1z" fill="#E24B4A"/></svg>',
  reply:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2.5h12v9H8.5L5 14v-2.5H2v-9z" fill="#378ADD"/></svg>',
  repost:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 1 1.8 4.2 5 7.4V5.4h7V3H5V1zm6 14 3.2-3.2L11 8.6v2H4v2.4h7V15z" fill="#1D9E75"/></svg>',
};

// 今の重みで取りうる最大のスコア（興味が最大・品質が最高の投稿）
const FULL_INTEREST = TOPICS.map((_, i) => (i === 0 ? 1 : 0));
export function maxScore(params: Params): number {
  return scorePost(FULL_INTEREST, 0, 1, params).score;
}

// スコアを取りうる最大値で正規化したタイルの棒の太さ（%）
export function scoreBarWidth(score: number, params: Params): number {
  const max = maxScore(params);
  if (max <= 0) return 0;
  return Math.min(100, Math.max(4, (score / max) * 100));
}

export function authorName(world: World, authorId: number): string {
  return world.authors.find((a) => a.id === authorId)?.name ?? `#${authorId}`;
}

export interface FeedPanel {
  // ビートごとに呼ぶ。selectedId が null なら一覧表示。
  update(world: World, selectedId: number | null, params: Params): void;
}

export function createFeedPanel(el: HTMLElement, onSelect: (agentId: number) => void): FeedPanel {
  let shownId: number | null = null;
  let tiles = new Map<number, HTMLElement>();
  let feedEl: HTMLElement | null = null;
  // 一覧表示の行（エージェントごとの、話題別の区切り）。毎拍作り直すとクリックを取りこぼすので使い回す。
  let overviewSegs: HTMLElement[][] | null = null;

  function clearTiles(): void {
    for (const t of tiles.values()) t.remove();
    tiles = new Map();
  }

  function updateOverview(world: World): void {
    if (!overviewSegs || overviewSegs.length !== world.agents.length) {
      renderOverview(world);
      return;
    }
    world.agents.forEach((agent, i) => {
      const dist = feedDistribution(agent);
      overviewSegs![i].forEach((seg, t) => {
        seg.style.width = `${(dist ? dist[t] : 0) * 100}%`;
      });
    });
  }

  function renderOverview(world: World): void {
    clearTiles();
    feedEl = null;
    el.textContent = '';
    const hint = document.createElement('p');
    hint.className = 'fp-hint';
    hint.textContent = 'エージェントをクリックするとフィードが見られます';
    el.append(hint);
    const list = document.createElement('div');
    list.className = 'fp-overview';
    const total = world.agents.length;
    overviewSegs = [];
    for (const agent of world.agents) {
      const row = document.createElement('div');
      row.className = 'fp-ov-row';
      row.addEventListener('click', () => onSelect(agent.id));
      const name = document.createElement('span');
      name.className = 'fp-ov-name';
      const dot = document.createElement('span');
      dot.className = 'fp-ov-dot';
      dot.style.background = agentColor(agent.id, total);
      name.append(dot, document.createTextNode(agent.name));
      const bar = document.createElement('div');
      bar.className = 'fp-ov-bar';
      const dist = feedDistribution(agent);
      const segs = TOPICS.map((topic, i) => {
        const seg = document.createElement('div');
        seg.className = 'fp-ov-seg';
        seg.style.width = `${(dist ? dist[i] : 0) * 100}%`;
        seg.style.background = topic.color;
        bar.append(seg);
        return seg;
      });
      overviewSegs.push(segs);
      row.append(name, bar);
      list.append(row);
    }
    el.append(list);
  }

  function renderAgent(world: World, agent: Agent): void {
    el.textContent = '';
    overviewSegs = null;
    const head = document.createElement('div');
    head.className = 'fp-head';
    const dot = document.createElement('span');
    dot.className = 'fp-dot';
    dot.style.background = agentColor(agent.id, world.agents.length);
    const name = document.createElement('span');
    name.className = 'fp-name';
    name.textContent = agent.name;
    const follows = document.createElement('span');
    follows.className = 'fp-follows';
    follows.textContent = `フォロー ${agent.follows.size} 人`;
    head.append(dot, name, follows);

    const interests = document.createElement('div');
    interests.className = 'fp-interests';
    agent.interest.forEach((frac, i) => {
      const row = document.createElement('div');
      row.className = 'fp-int-row';
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = TOPICS[i].name;
      const track = document.createElement('div');
      track.className = 'fp-int-track';
      const fill = document.createElement('div');
      fill.className = 'fp-int-fill';
      fill.style.width = `${Math.min(100, frac * 100)}%`;
      fill.style.background = TOPICS[i].color;
      track.append(fill);
      const val = document.createElement('span');
      val.className = 'fp-int-val';
      val.textContent = `${Math.round(frac * 100)}%`;
      row.append(nm, track, val);
      interests.append(row);
    });

    const title = document.createElement('p');
    title.className = 'fp-feed-title';
    title.textContent = `フィード上位 ${FEED_TOP} 件`;
    feedEl = document.createElement('div');
    feedEl.className = 'fp-feed';
    el.append(head, interests, title, feedEl);
    tiles = new Map();
  }

  function makeTile(item: FeedItem, world: World): HTMLElement {
    const t = document.createElement('div');
    t.className = 'tile';
    const top = document.createElement('div');
    top.className = 'tl-top';
    const shape = document.createElement('span');
    shape.className = `tl-shape ${TOPICS[item.topic].shape}`;
    shape.style.background = TOPICS[item.topic].color;
    const author = document.createElement('span');
    author.className = 'tl-author';
    author.textContent = authorName(world, item.authorId);
    const src = document.createElement('span');
    src.className = 'tl-src';
    src.textContent = item.source === 'in' ? '内' : '外';
    top.append(shape, author);
    const bw = document.createElement('div');
    bw.className = 'tl-bw';
    const bar = document.createElement('div');
    bar.className = 'tl-bar';
    bar.style.background = TOPICS[item.topic].color;
    bw.append(bar);
    const bottom = document.createElement('div');
    bottom.className = 'tl-bottom';
    const react = document.createElement('div');
    react.className = 'tl-react';
    bottom.append(react, src);
    t.append(top, bw, bottom);
    return t;
  }

  function updateTile(item: FeedItem, params: Params): void {
    const t = tiles.get(item.postId);
    if (!t) return;
    const bar = t.querySelector<HTMLElement>('.tl-bar');
    if (bar) bar.style.width = `${scoreBarWidth(item.score, params)}%`;
    const react = t.querySelector<HTMLElement>('.tl-react');
    if (react) {
      react.innerHTML =
        (item.reactions.like ? ICONS.like : '') +
        (item.reactions.reply ? ICONS.reply : '') +
        (item.reactions.repost ? ICONS.repost : '');
    }
  }

  return {
    update(world: World, selectedId: number | null, params: Params): void {
      const agent = selectedId === null ? undefined : world.agents[selectedId];
      if (!agent) {
        shownId = null;
        updateOverview(world);
        return;
      }
      if (shownId !== selectedId) {
        shownId = selectedId;
        renderAgent(world, agent);
      }
      // ヘッダと興味バーは反応で変わるので毎ビート更新
      const follows = el.querySelector<HTMLElement>('.fp-follows');
      if (follows) follows.textContent = `フォロー ${agent.follows.size} 人`;
      const fills = el.querySelectorAll<HTMLElement>('.fp-int-fill');
      const vals = el.querySelectorAll<HTMLElement>('.fp-int-val');
      agent.interest.forEach((frac, i) => {
        const f = fills[i];
        const v = vals[i];
        if (f) f.style.width = `${Math.min(100, frac * 100)}%`;
        if (v) v.textContent = `${Math.round(frac * 100)}%`;
      });
      if (!feedEl) return;
      const top = agent.feed.slice(0, FEED_TOP);
      const keep = new Set(top.map((it) => it.postId));
      for (const [pid, tile] of tiles) {
        if (!keep.has(pid)) {
          tiles.delete(pid);
          tile.style.opacity = '0';
          setTimeout(() => tile.remove(), TILE_FADE_MS);
        }
      }
      top.forEach((item, i) => {
        let tile = tiles.get(item.postId);
        if (!tile) {
          tile = makeTile(item, world);
          tile.style.left = `${(i * 100) / FEED_TOP}%`;
          tiles.set(item.postId, tile);
          feedEl!.append(tile);
          requestAnimationFrame(() => {
            tile!.style.opacity = '1';
          });
        }
        tile.style.left = `${(i * 100) / FEED_TOP}%`;
        updateTile(item, params);
      });
    },
  };
}
