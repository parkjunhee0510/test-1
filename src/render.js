// 캔버스 그리기와 연출(꼬리, 색종이, 점수 글자).
// 겉모습은 2~3도 공판 인쇄물을 흉내 낸다: 면 색이 외곽선에서 살짝 어긋나고 음영은 망점으로 찍는다.
// 색은 전부 CSS 변수에서 읽어 밝은/어두운 테마를 그대로 따른다.

import { aim, tune, TAU, BONUS_SWEEP, CRAFT_R } from './logic.js';

const VIEW_W = 400; // 항상 화면에 들어와야 하는 월드 너비
const ANCHOR = 0.76; // 기준점(현재 행성)이 놓이는 세로 위치
const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);

// 한 칸 건너뛸 행성까지 보이도록, 난이도(행성 간격)가 커지면 시야도 넓힌다.
const viewHeight = (i) => (tune(i).gap * 2.16 + tune(i).ring + 34) / ANCHOR;
const VIEW_H_MAX = viewHeight(1000);

export function createRenderer(canvas, host) {
  const ctx = canvas.getContext('2d');
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const cam = { x: 0, y: 0, view: viewHeight(0), shake: 0 };
  const fx = { trail: [], bits: [], pulses: [], pops: [] };
  let W = 1;
  let H = 1;
  let dpr = 1;
  let scale = 1;
  let theme = null;
  let grain = null;
  let stars = [];
  let tile = 900;

  const sx = (x) => W / 2 + (x - cam.x) * scale;
  const sy = (y) => H * ANCHOR - (y - cam.y) * scale;

  function readTheme() {
    const root = getComputedStyle(document.documentElement);
    const v = (name) => root.getPropertyValue(name).trim();
    theme = {
      paper: v('--paper'),
      deep: v('--paper-deep'),
      ink: v('--ink'),
      hot: v('--hot'),
      spots: [v('--spot-1'), v('--spot-2'), v('--spot-3'), v('--spot-4')],
      display: v('--font-display'),
    };
    grain = makeGrain(theme.ink);
  }

  // 종이 결: 작은 무늬 한 장을 만들어 화면 전체에 깐다.
  function makeGrain(color) {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = color;
    let seed = 20261113;
    const next = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 1500; i++) {
      g.globalAlpha = 0.03 + next() * 0.07;
      g.fillRect(Math.floor(next() * size), Math.floor(next() * size), 1, 1);
    }
    return ctx.createPattern(c, 'repeat');
  }

  function makeStars() {
    let seed = 7;
    const next = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const count = Math.min(420, Math.round(150 * (tile / 900) ** 2));
    stars = Array.from({ length: count }, () => ({
      x: next(),
      y: next(),
      depth: 0.18 + next() * 0.4,
      size: 0.7 + next() * 1.3,
      alpha: 0.14 + next() * 0.34,
      cross: next() < 0.14,
    }));
  }

  function fit() {
    scale = Math.min(W / VIEW_W, H / cam.view);
  }

  function resize() {
    const box = host.getBoundingClientRect();
    W = Math.max(1, box.width);
    H = Math.max(1, box.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    fit();
    // 별 무늬 한 장은 시야가 가장 넓어졌을 때도 화면을 덮을 만큼 크게 잡는다.
    const widest = Math.max(W, H) / Math.min(W / VIEW_W, H / VIEW_H_MAX) + 80;
    if (Math.abs(widest - tile) > 1) {
      tile = Math.max(900, widest);
      makeStars();
    }
  }

  /** 새 판: 카메라를 출발 행성에 바로 맞추고 연출을 비운다. */
  function reset(game) {
    const p = game.planets[game.cur];
    cam.x = p.x * 0.5;
    cam.y = p.y;
    cam.view = viewHeight(game.cur);
    cam.shake = 0;
    fx.trail.length = 0;
    fx.bits.length = 0;
    fx.pulses.length = 0;
    fx.pops.length = 0;
    fit();
  }

  function confetti(x, y, count, speed, colors) {
    const n = calm.matches ? Math.ceil(count / 3) : count;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = speed * (0.35 + Math.random() * 0.65);
      fx.bits.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        age: 0,
        life: 0.45 + Math.random() * 0.5,
        size: 1.6 + Math.random() * 2.4,
        color: colors[Math.floor(Math.random() * colors.length)],
        spin: Math.random() * TAU,
      });
    }
  }

  /** 규칙 쪽에서 일어난 일을 연출로 옮긴다. */
  function onEvent(e, game) {
    if (e.type === 'release') {
      confetti(e.x, e.y, 5, 60, [theme.ink]);
    } else if (e.type === 'capture') {
      const p = game.planets[e.idx];
      fx.pulses.push({ x: p.x, y: p.y, r: p.ring, age: 0 });
      if (e.gain > 0) {
        confetti(e.x, e.y, 8 + 5 * e.mult, 150, theme.spots);
        fx.pops.push({ x: e.x, y: e.y, text: `+${e.gain}`, age: 0, big: e.mult > 1 || e.jumped > 1 });
        if (e.jumped > 1) fx.pops.push({ x: p.x, y: p.y + p.ring + 30, text: '건너뛰기', age: 0, big: false });
      }
    } else if (e.type === 'over') {
      confetti(e.x, e.y, e.reason === 'burn' ? 34 : 12, e.reason === 'burn' ? 190 : 90, [theme.ink, theme.hot]);
      if (!calm.matches) cam.shake = e.reason === 'burn' ? 1 : 0.5;
    }
  }

  function update(dt, game) {
    const p = game.planets[game.cur];
    const free = game.mode === 'flight' || game.mode === 'over';
    const tx = (free ? game.x : p.x) * 0.5;
    const ty = free ? game.y : p.y;
    const k = 1 - Math.exp(-dt * 5);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    cam.view += (viewHeight(game.cur) - cam.view) * (1 - Math.exp(-dt * 2));
    cam.shake = Math.max(0, cam.shake - dt * 2.4);
    fit();

    const tail = fx.trail;
    const last = tail[tail.length - 1];
    const burned = game.mode === 'over' && game.over === 'burn';
    if (!burned && (!last || Math.hypot(game.x - last.x, game.y - last.y) > 3)) {
      tail.push({ x: game.x, y: game.y });
      if (tail.length > 30) tail.shift();
    } else if (burned && tail.length) {
      tail.shift();
    }

    for (const b of fx.bits) {
      b.age += dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vx *= 1 - 2.2 * dt;
      b.vy *= 1 - 2.2 * dt;
    }
    fx.bits = fx.bits.filter((b) => b.age < b.life);
    for (const q of fx.pulses) q.age += dt;
    fx.pulses = fx.pulses.filter((q) => q.age < 0.5);
    for (const q of fx.pops) q.age += dt;
    fx.pops = fx.pops.filter((q) => q.age < 1);
  }

  function drawStars() {
    ctx.fillStyle = theme.ink;
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 1;
    for (const st of stars) {
      const wx = (((st.x * tile - cam.x * st.depth) % tile) + tile) % tile;
      const wy = (((st.y * tile - cam.y * st.depth) % tile) + tile) % tile;
      const X = W / 2 + (wx - tile / 2) * scale;
      const Y = H / 2 - (wy - tile / 2) * scale;
      if (X < -6 || X > W + 6 || Y < -6 || Y > H + 6) continue;
      ctx.globalAlpha = st.alpha;
      if (st.cross) {
        const a = 2.5 + st.size * 1.5;
        ctx.beginPath();
        ctx.moveTo(X - a, Y);
        ctx.lineTo(X + a, Y);
        ctx.moveTo(X, Y - a);
        ctx.lineTo(X, Y + a);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(X, Y, st.size, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawPlanet(p, i, game, aimed, now) {
    const X = sx(p.x);
    const Y = sy(p.y);
    const R = p.body * scale;
    const ringR = p.ring * scale;
    if (Y + ringR < -30 || Y - ringR > H + 30) return;
    const here = i === game.cur;
    const visited = i <= game.maxIdx && !here;
    const fade = visited ? 0.36 : 1;
    const line = Math.max(1, 1.5 * scale);

    // 포획 고리
    ctx.save();
    ctx.lineWidth = aimed ? line * 1.7 : line;
    ctx.strokeStyle = aimed ? theme.hot : theme.ink;
    ctx.globalAlpha = aimed ? 1 : visited ? 0.16 : here ? 0.26 : 0.55;
    if (!aimed) {
      ctx.setLineDash([3 * scale, 6 * scale]);
      if (!visited && !here && !calm.matches) ctx.lineDashOffset = -now * 0.008 * scale;
    }
    ctx.beginPath();
    ctx.arc(X, Y, ringR, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // 면 색: 외곽선에서 살짝 어긋나게 찍는다.
    const off = Math.max(1.2, 1.7 * scale);
    const cx = X - off;
    const cy = Y - off;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = theme.spots[p.ink];
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();
    if (p.look === 1) {
      // 띠 무늬
      ctx.fillStyle = theme.paper;
      ctx.globalAlpha = fade * 0.42;
      ctx.fillRect(cx - R, cy - R * 0.5, R * 2, R * 0.24);
      ctx.fillRect(cx - R, cy + R * 0.12, R * 2, R * 0.14);
    }
    // 망점 음영: 오른쪽 아래로 갈수록 점이 커진다.
    const gap = Math.max(3, 3.5 * scale);
    ctx.fillStyle = theme.ink;
    ctx.globalAlpha = fade * 0.34;
    ctx.beginPath();
    for (let a = -R * 1.5; a <= R * 1.5; a += gap) {
      for (let b = -R * 1.5; b <= R * 1.5; b += gap) {
        const gx = a * COS30 - b * SIN30;
        const gy = a * SIN30 + b * COS30;
        const shade = (gx + gy) / (R * 1.5) + 0.1;
        if (shade <= 0.05) continue;
        const r = Math.min(1, shade) * gap * 0.45;
        ctx.moveTo(cx + gx + r, cy + gy);
        ctx.arc(cx + gx, cy + gy, r, 0, TAU);
      }
    }
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = line;
    if (p.look === 2) {
      // 분화구
      ctx.globalAlpha = fade * 0.6;
      for (const [ox, oy, r] of [[-0.35, -0.25, 0.2], [0.3, 0.1, 0.14], [-0.05, 0.42, 0.11]]) {
        ctx.beginPath();
        ctx.arc(X + ox * R, Y + oy * R, r * R, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = fade;
    }
    ctx.beginPath();
    ctx.arc(X, Y, R, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // 추락이 가까워지면 표면 바로 위에 경고선이 진해진다.
    const alt = game.radius - p.body - CRAFT_R;
    if (here && game.mode === 'orbit' && alt < 10) {
      ctx.save();
      ctx.strokeStyle = theme.hot;
      ctx.globalAlpha = Math.min(1, 1.2 - alt / 10);
      ctx.lineWidth = Math.max(1.5, 2.2 * scale);
      ctx.beginPath();
      ctx.arc(X, Y, (p.body + CRAFT_R) * scale, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    // 연속 보너스가 남은 만큼 고리 바깥에 호를 그린다.
    if (here && game.mode === 'orbit' && game.sweep < BONUS_SWEEP) {
      const left = 1 - game.sweep / BONUS_SWEEP;
      ctx.save();
      ctx.strokeStyle = theme.hot;
      ctx.lineWidth = Math.max(2, 3 * scale);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(X, Y, ringR + 8 * scale, -Math.PI / 2, -Math.PI / 2 + left * TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 조준선: 지금 떠나면 날아갈 방향. 처음 몇 행성에서는 고리에 닿을 때 분홍으로 바뀐다.
  function drawGuide(game, onTarget, hint) {
    if (game.mode !== 'orbit' && game.mode !== 'ready') return;
    const len = tune(game.cur).guide;
    const x0 = sx(game.x);
    const y0 = sy(game.y);
    const dx = game.ux * scale;
    const dy = -game.uy * scale;
    const stroke = (color, alpha) => {
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(x0 + dx * 12, y0 + dy * 12);
      ctx.lineTo(x0 + dx * len, y0 + dy * len);
      ctx.stroke();
    };
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, 2.6 * scale);
    ctx.setLineDash([0.01, 8 * scale]);
    stroke(theme.ink, 0.5);
    if (onTarget && hint > 0) stroke(theme.hot, hint);
    ctx.restore();
  }

  function drawTrail() {
    const tail = fx.trail;
    const n = tail.length;
    if (n < 2) return;
    ctx.save();
    ctx.strokeStyle = theme.hot;
    ctx.lineCap = 'round';
    for (let i = 1; i < n; i++) {
      const t = i / n;
      ctx.globalAlpha = t * 0.85;
      ctx.lineWidth = Math.max(1, t * 5 * scale);
      ctx.beginPath();
      ctx.moveTo(sx(tail[i - 1].x), sy(tail[i - 1].y));
      ctx.lineTo(sx(tail[i].x), sy(tail[i].y));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCraft(game) {
    if (game.mode === 'over' && game.over === 'burn') return;
    const X = sx(game.x);
    const Y = sy(game.y);
    const hx = game.ux;
    const hy = -game.uy;
    const nx = -hy;
    const ny = hx;
    const k = Math.max(0.9, scale);
    const shape = (ox, oy) => {
      ctx.beginPath();
      ctx.moveTo(X + ox + hx * 9 * k, Y + oy + hy * 9 * k);
      ctx.lineTo(X + ox - hx * 6 * k + nx * 6 * k, Y + oy - hy * 6 * k + ny * 6 * k);
      ctx.lineTo(X + ox - hx * 3 * k, Y + oy - hy * 3 * k);
      ctx.lineTo(X + ox - hx * 6 * k - nx * 6 * k, Y + oy - hy * 6 * k - ny * 6 * k);
      ctx.closePath();
    };
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.fillStyle = theme.hot;
    shape(-1.8 * k, -1.8 * k);
    ctx.fill();
    ctx.fillStyle = theme.ink;
    ctx.strokeStyle = theme.paper;
    ctx.lineWidth = 1.2;
    shape(0, 0);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawEffects() {
    ctx.save();
    for (const q of fx.pulses) {
      const t = q.age / 0.5;
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.strokeStyle = theme.hot;
      ctx.lineWidth = Math.max(1.5, (1 - t) * 5 * scale);
      ctx.beginPath();
      ctx.arc(sx(q.x), sy(q.y), (q.r + t * 26) * scale, 0, TAU);
      ctx.stroke();
    }
    for (const b of fx.bits) {
      const t = b.age / b.life;
      const size = b.size * Math.max(1, scale) * (1 - t * 0.5);
      ctx.globalAlpha = 1 - t * t;
      ctx.fillStyle = b.color;
      ctx.save();
      ctx.translate(sx(b.x), sy(b.y));
      ctx.rotate(b.spin + b.age * 6);
      ctx.fillRect(-size, -size * 0.6, size * 2, size * 1.2);
      ctx.restore();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const q of fx.pops) {
      const t = q.age;
      const px = Math.round((q.big ? 26 : 17) * Math.max(1, scale));
      ctx.font = `${px}px ${theme.display}`;
      ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      const X = sx(q.x);
      const Y = sy(q.y) - 22 * scale - (1 - (1 - t) ** 3) * 30 * scale;
      ctx.fillStyle = theme.hot;
      ctx.fillText(q.text, X - 1.6, Y - 1.6);
      ctx.fillStyle = theme.ink;
      ctx.fillText(q.text, X, Y);
    }
    ctx.restore();
  }

  function draw(game, now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const wash = ctx.createLinearGradient(0, 0, 0, H);
    wash.addColorStop(0, theme.paper);
    wash.addColorStop(1, theme.deep);
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, W, H);

    if (cam.shake > 0) {
      const s = cam.shake * cam.shake * 9;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    drawStars();

    // 날아가는 동안에는 어디에 걸릴지 미리 알려 주지 않는다.
    const plan = game.mode === 'orbit' || game.mode === 'ready' ? aim(game) : null;
    const onTarget = plan !== null && plan.idx > game.maxIdx;
    // 조준 도움은 처음 몇 행성에서만 주고 서서히 거둔다.
    const hint = Math.max(0, Math.min(1, (7 - game.maxIdx) / 4));
    const lo = Math.max(0, game.cur - 4);
    const hi = Math.min(game.planets.length - 1, game.cur + 6);
    for (let i = lo; i <= hi; i++) {
      const aimed = onTarget && plan.idx === i && hint > 0.5;
      drawPlanet(game.planets[i], i, game, aimed, now);
    }
    drawGuide(game, onTarget, hint);
    drawTrail();
    drawCraft(game);
    drawEffects();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = grain;
    ctx.fillRect(0, 0, W, H);
  }

  readTheme();
  resize();
  return { resize, readTheme, reset, onEvent, update, draw };
}
