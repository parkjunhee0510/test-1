// 진입점: 화면 요소 연결, 입력 처리, 게임 루프.

import { createGame, step, tap, autopilot, altitude, multOf } from './logic.js';
import { createRenderer } from './render.js';
import { createAudio } from './audio.js';

const TICK = 1 / 120; // 시연 모드에서 자동 조종이 판단하는 간격(초)
const RETRY_LOCK = 450; // 판이 끝난 직후의 연타가 곧바로 재시작이 되지 않게 막는 시간(ms)
const BEST_KEY = 'orbit-hop.best';
const MUTE_KEY = 'orbit-hop.muted';

const OVER = {
  miss: { title: '우주 미아', line: '어느 고리에도 걸리지 못했습니다.' },
  burn: { title: '대기권 추락', line: '너무 오래 돌아 궤도가 바닥났습니다.' },
};

const el = (id) => document.getElementById(id);
const stage = el('stage');
const ui = {
  score: el('score'),
  mult: el('mult'),
  best: el('best'),
  alt: el('alt'),
  altWrap: el('alt-wrap'),
  panel: el('panel'),
  title: el('panel-title'),
  line: el('panel-line'),
  more: el('panel-more'),
  stats: el('panel-stats'),
  cta: el('panel-cta'),
  hint: el('hint'),
  mute: el('mute'),
};

// 저장소가 막힌 환경(사생활 보호 창, 미리보기 등)에서도 게임은 그대로 돌아가야 한다.
const store = {
  read(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 기록만 남지 않는다 */
    }
  },
};

// ?seed=123 은 코스를 고정하고, ?auto=1 또는 #demo 는 자동 조종 시연을 켠다.
const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
const fixedSeed = seedParam !== null && /^\d+$/.test(seedParam) ? Number(seedParam) >>> 0 : null;
const nextSeed = () => fixedSeed ?? (Math.random() * 0x100000000) >>> 0;
let demo = params.get('auto') === '1' || location.hash === '#demo';

const audio = createAudio({ muted: store.read(MUTE_KEY) === '1' });
const renderer = createRenderer(el('view'), stage);

let game = createGame(nextSeed());
let best = Number(store.read(BEST_KEY)) || 0;
let clock = null; // 마지막으로 시뮬레이션을 진행한 시각(ms)
let overAt = -Infinity;
let shownMode = '';
let shownAlt = null;

function buzz(ms) {
  if (demo) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* 진동이 없는 기기 */
  }
}

function syncHud() {
  ui.score.textContent = String(game.score);
  const mult = multOf(game.streak);
  ui.mult.hidden = mult < 2;
  ui.mult.textContent = `×${mult}`;
  ui.best.textContent = String(best);
  ui.hint.hidden = demo || game.mode === 'ready' || game.mode === 'over' || game.maxIdx >= 2;
  stage.dataset.score = String(game.score);
  stage.dataset.planet = String(game.maxIdx);
}

// 매 프레임 바뀔 수 있는 표시(모드, 고도)는 값이 달라졌을 때만 DOM에 쓴다.
function syncFrame() {
  if (game.mode !== shownMode) {
    shownMode = game.mode;
    stage.dataset.mode = game.mode;
    syncHud();
  }
  const orbiting = game.mode === 'orbit' || game.mode === 'ready';
  const alt = orbiting ? Math.round(altitude(game)) : null;
  if (alt !== shownAlt) {
    shownAlt = alt;
    ui.alt.textContent = alt === null ? '–' : String(alt);
    ui.altWrap.classList.toggle('low', alt !== null && alt <= 6);
  }
}

function finish(reason) {
  if (demo) return; // 시연은 기록을 남기지 않고 결과 화면 없이 다시 돈다
  const record = game.score > best;
  if (record) {
    best = game.score;
    store.write(BEST_KEY, String(best));
  }
  ui.title.textContent = OVER[reason].title;
  ui.line.textContent = OVER[reason].line;
  ui.more.hidden = true;
  ui.stats.textContent = `${game.score}점 · 행성 ${game.maxIdx}개${record ? ' · 최고 기록' : ''}`;
  ui.stats.hidden = false;
  ui.cta.textContent = '탭하면 다시 출발';
  ui.panel.hidden = false;
}

// 규칙 쪽에서 쌓인 사건을 소리·연출·화면 글자로 옮긴다.
function drain() {
  if (game.events.length === 0) return;
  for (const e of game.events) {
    renderer.onEvent(e, game);
    if (e.type === 'start') {
      audio.start();
      ui.panel.hidden = true;
    } else if (e.type === 'release') {
      audio.release();
    } else if (e.type === 'capture') {
      audio.capture(game.streak, e.jumped > 1);
      buzz(8);
    } else if (e.type === 'over') {
      audio.over(e.reason);
      buzz(30);
      overAt = performance.now();
      finish(e.reason);
    }
  }
  game.events.length = 0;
  syncHud();
}

function advance(to) {
  if (clock === null) clock = to;
  const dt = Math.min((to - clock) / 1000, 0.1); // 탭을 떠났다 돌아왔을 때 한꺼번에 진행되지 않게 한다
  if (dt <= 0) return;
  clock = to;
  if (demo) {
    for (let left = dt; left > 1e-9; left -= TICK) {
      if (autopilot(game)) tap(game);
      step(game, Math.min(left, TICK));
    }
  } else {
    step(game, dt);
  }
  drain();
  renderer.update(dt, game);
}

function restart({ start }) {
  game = createGame(nextSeed());
  if (start) tap(game); // 대기 화면 없이 바로 출발
  renderer.reset(game);
  ui.panel.hidden = true;
  drain();
  syncHud();
}

// 입력 시각이 지난 프레임보다 뒤라면 그 시각까지 먼저 진행한 다음 탭을 적용한다.
// 프레임 단위로 뭉개지 않아 60Hz 화면에서도 떠나는 순간이 정확하다.
function press(ev) {
  audio.unlock();
  const now = performance.now();
  const at = Number.isFinite(ev.timeStamp) && ev.timeStamp <= now && now - ev.timeStamp < 200 ? ev.timeStamp : now;
  if (clock !== null && at > clock) advance(at);
  if (demo) {
    demo = false; // 시연 중에 누르면 직접 조종으로 넘어간다
    restart({ start: true });
  } else if (game.mode === 'over') {
    if (now - overAt > RETRY_LOCK) restart({ start: true });
  } else if (tap(game)) {
    drain();
  }
  syncFrame(); // 다음 프레임을 기다리지 않고 화면 상태를 바로 맞춘다
}

stage.addEventListener('pointerdown', (ev) => {
  if (ev.button > 0 || ev.target.closest('button')) return;
  ev.preventDefault();
  press(ev);
});
// iOS Safari는 손가락을 뗄 때에야 소리 재생을 허용한다.
stage.addEventListener('pointerup', () => audio.unlock());

window.addEventListener('keydown', (ev) => {
  if (ev.repeat || ev.altKey || ev.ctrlKey || ev.metaKey) return;
  if (ev.code !== 'Space' && ev.code !== 'Enter') return;
  if (ev.target instanceof Element && ev.target.closest('button, a, input, select, textarea')) return;
  ev.preventDefault();
  press(ev);
});

function showMute() {
  ui.mute.setAttribute('aria-pressed', String(audio.muted));
}
ui.mute.addEventListener('click', () => {
  audio.unlock();
  audio.setMuted(!audio.muted);
  store.write(MUTE_KEY, audio.muted ? '1' : '0');
  showMute();
});
showMute();

new ResizeObserver(() => renderer.resize()).observe(stage);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderer.readTheme());
new MutationObserver(() => renderer.readTheme()).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme', 'class', 'style'],
});

function frame(now) {
  advance(now);
  if (demo && game.mode === 'over' && now - overAt > 1300) restart({ start: false });
  syncFrame();
  renderer.draw(game, now);
  requestAnimationFrame(frame);
}

if (demo) ui.panel.hidden = true;
renderer.reset(game);
syncHud();
requestAnimationFrame(frame);
