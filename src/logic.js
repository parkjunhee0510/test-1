// 궤도 뛰기의 규칙. DOM을 쓰지 않는 순수 모듈이라 Node에서 그대로 테스트한다.
// 좌표계: y가 위로 증가한다. 각도는 반시계 방향이 양수다.
// 상태(state)는 숫자·배열·객체로만 이루어져 structuredClone으로 복제할 수 있다.

export const TAU = Math.PI * 2;
export const CRAFT_R = 4; // 우주선 반지름
export const MIN_ALT = 14; // 포획될 수 있는 가장 낮은 고도(행성 표면 기준)
export const BONUS_SWEEP = TAU * 1.5; // 이 각도를 다 돌기 전에 떠나면 "연속"으로 친다
export const MAX_MULT = 5;
export const MISS_TIME = 1.1; // 빗나간 뒤 판이 끝날 때까지 걸리는 시간(초)
export const SKIP_MAX = 2; // 앞뒤로 이만큼 떨어진 행성까지만 포획 후보다(한 번에 하나만 건너뛸 수 있다)
export const X_MAX = 110; // 행성 중심의 좌우 한계
export const INKS = 4; // 행성 색 가짓수
export const LOOKS = 3; // 행성 무늬 가짓수

const AHEAD = 8; // 가장 멀리 간 행성보다 항상 이만큼 앞까지 만들어 둔다

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * i번째 행성 근처의 난이도. 처음 몇 개는 거의 그대로이고 60번째에서 최대가 된다.
 * gap: 행성 중심 사이 거리, ring: 포획 고리 반지름, speed: 우주선 속력,
 * decay: 궤도 반지름이 줄어드는 속도(초당), guide: 조준선 길이
 *
 * 누를 수 있는 시간 창은 대략 ring² / (gap × speed)에 비례한다.
 * 이 값들로 재면 창의 중앙값이 처음 약 350ms에서 60번째 이후 약 95ms까지 줄어든다.
 */
export function tune(i) {
  const t = clamp(i / 60, 0, 1);
  const e = t * t * (3 - 2 * t);
  return {
    gap: lerp(215, 300, e),
    ring: lerp(80, 60, e),
    speed: lerp(150, 215, e),
    decay: lerp(4.5, 8, e),
    guide: lerp(260, 90, e),
  };
}

/** 연속 횟수에 따른 점수 배수. 연속 2번째부터 ×2, 최대 ×5. */
export const multOf = (streak) => clamp(streak, 1, MAX_MULT);

// 시드 난수(mulberry32). 난수 상태를 state 안에 두어 복제·재현이 가능하다.
function rand(s) {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function addPlanet(s) {
  const i = s.planets.length;
  const k = tune(i);
  const body = 12 + 8 * rand(s);
  const ring = k.ring * (0.9 + 0.2 * rand(s));
  const ink = Math.floor(rand(s) * INKS);
  const look = Math.floor(rand(s) * LOOKS);
  if (i === 0) {
    s.planets.push({ x: 0, y: 0, body: 17, ring: 84, ink, look });
    return;
  }
  const prev = s.planets[i - 1];
  const gap = k.gap * (0.92 + 0.16 * rand(s));
  const tilt = ((18 + 34 * rand(s)) * Math.PI) / 180; // 수직에서 기운 각도
  let side = rand(s) < 0.5 ? -1 : 1;
  // 한쪽으로 치우쳐 있으면 대체로 반대편으로 보낸다(지그재그).
  if (Math.abs(prev.x) > 35 && rand(s) < 0.85) side = prev.x > 0 ? -1 : 1;
  const x = clamp(prev.x + side * gap * Math.sin(tilt), -X_MAX, X_MAX);
  const dx = x - prev.x;
  // 좌우가 잘려도 중심 사이 거리는 gap으로 유지한다.
  const y = prev.y + Math.sqrt(gap * gap - dx * dx);
  s.planets.push({ x, y, body, ring, ink, look });
}

/** 새 판을 만든다. 같은 시드는 항상 같은 코스를 만든다. */
export function createGame(seed = 1) {
  const s = {
    seed: seed >>> 0,
    rng: seed >>> 0,
    planets: [],
    mode: 'ready', // ready → orbit ⇄ flight → over
    over: null, // 'miss' | 'burn'
    cur: 0, // 지금 돌고 있는(또는 방금 떠난) 행성
    maxIdx: 0, // 가장 멀리 간 행성
    angle: -Math.PI / 2,
    radius: 0,
    dir: 1, // +1 반시계, -1 시계
    sweep: 0, // 이 행성에서 돈 각도
    speed: tune(0).speed,
    x: 0,
    y: 0,
    ux: 1, // 진행 방향(단위 벡터)
    uy: 0,
    ox: 0, // 궤도를 떠난 지점
    oy: 0,
    dist: 0, // 떠난 뒤 날아간 거리
    plan: null, // 떠나는 순간 정해지는 포획 계획. null이면 빗나감
    quick: false,
    streak: 0,
    score: 0,
    time: 0,
    events: [], // 화면·소리 쪽에서 읽고 비운다
  };
  while (s.planets.length <= AHEAD) addPlanet(s);
  s.radius = s.planets[0].ring * 0.72;
  place(s);
  return s;
}

// 궤도 또는 비행 상태에서 우주선의 위치와 진행 방향을 계산한다.
function place(s) {
  if (s.mode === 'flight') {
    s.x = s.ox + s.ux * s.dist;
    s.y = s.oy + s.uy * s.dist;
  } else if (s.mode !== 'over') {
    const p = s.planets[s.cur];
    const c = Math.cos(s.angle);
    const sn = Math.sin(s.angle);
    s.x = p.x + s.radius * c;
    s.y = p.y + s.radius * sn;
    s.ux = -sn * s.dir;
    s.uy = c * s.dir;
  }
}

// 속력은 일정하고 반지름이 일정한 속도로 줄어드는 궤도를 닫힌 식으로 적분한다.
// 그래서 결과가 프레임 간격(dt)을 어떻게 쪼개든 달라지지 않는다.
function advanceOrbit(s, dt, decay) {
  let swept;
  if (decay > 0) {
    const r1 = s.radius - decay * dt;
    swept = (s.speed / decay) * Math.log(s.radius / r1);
    s.radius = r1;
  } else {
    swept = (s.speed / s.radius) * dt;
  }
  s.angle += s.dir * swept;
  s.sweep += swept;
}

function end(s, reason) {
  s.mode = 'over';
  s.over = reason;
  s.plan = null;
  s.events.push({ type: 'over', reason, x: s.x, y: s.y });
}

/**
 * 지금 위치에서 진행 방향으로 곧게 날아가면 어느 고리에 처음 닿는지 계산한다.
 * 닿는 고리가 없으면 null.
 * 최근접점이 충분히 높으면 그 점에서 포획되어 궤도로 매끄럽게 이어지고(tangent),
 * 너무 낮게 겨눴으면 최저 고도에 닿는 순간 포획된다.
 */
export function aim(s) {
  let best = null;
  const lo = Math.max(0, s.cur - SKIP_MAX);
  const hi = Math.min(s.planets.length - 1, s.cur + SKIP_MAX);
  for (let j = lo; j <= hi; j++) {
    if (j === s.cur) continue;
    const p = s.planets[j];
    const wx = p.x - s.x;
    const wy = p.y - s.y;
    const along = wx * s.ux + wy * s.uy; // 최근접점까지 날아갈 거리
    if (along <= 0) continue; // 멀어지는 중
    const d2 = Math.max(0, wx * wx + wy * wy - along * along); // 최근접 거리의 제곱
    if (d2 >= p.ring * p.ring) continue; // 고리 밖으로 지나감
    const enter = along - Math.sqrt(p.ring * p.ring - d2);
    if (best && enter >= best.enter) continue;
    const low = p.body + MIN_ALT;
    const tangent = d2 >= low * low;
    best = {
      idx: j,
      enter,
      dist: tangent ? along : along - Math.sqrt(low * low - d2),
      radius: tangent ? Math.sqrt(d2) : low,
      tangent,
    };
  }
  return best;
}

function capture(s) {
  const plan = s.plan;
  const p = s.planets[plan.idx];
  s.x = s.ox + s.ux * s.dist;
  s.y = s.oy + s.uy * s.dist;
  const rx = s.x - p.x;
  const ry = s.y - p.y;
  // 지나가던 쪽으로 계속 돈다(각운동량의 부호).
  s.dir = rx * s.uy - ry * s.ux >= 0 ? 1 : -1;
  s.angle = Math.atan2(ry, rx);
  s.radius = plan.radius;
  s.sweep = 0;
  s.plan = null;
  s.mode = 'orbit';

  const jumped = plan.idx - s.maxIdx;
  let gain = 0;
  if (jumped > 0) {
    s.streak = s.quick ? s.streak + 1 : 0;
    gain = jumped * multOf(s.streak);
    s.score += gain;
    s.maxIdx = plan.idx;
  } else {
    s.streak = 0; // 뒤로 돌아가면 연속이 끊긴다
  }
  s.cur = plan.idx;
  s.speed = tune(s.cur).speed;
  while (s.planets.length <= s.maxIdx + AHEAD) addPlanet(s);
  s.events.push({
    type: 'capture',
    idx: plan.idx,
    x: s.x,
    y: s.y,
    gain,
    jumped,
    mult: multOf(s.streak),
    tangent: plan.tangent,
  });
}

/** 시간을 dt초 진행한다. 포획·추락·빗나감은 정확한 시각에 일어난다. */
export function step(s, dt) {
  let left = dt;
  for (let guard = 0; left > 0 && s.mode !== 'over' && guard < 32; guard++) {
    if (s.mode === 'ready') {
      advanceOrbit(s, left, 0);
      s.sweep = 0;
      s.time += left;
      left = 0;
    } else if (s.mode === 'orbit') {
      const p = s.planets[s.cur];
      const decay = tune(s.cur).decay;
      const untilBurn = Math.max(0, (s.radius - (p.body + CRAFT_R)) / decay);
      if (left < untilBurn) {
        advanceOrbit(s, left, decay);
        s.time += left;
        left = 0;
      } else {
        advanceOrbit(s, untilBurn, decay);
        s.time += untilBurn;
        left -= untilBurn;
        place(s);
        end(s, 'burn');
      }
    } else {
      const goal = s.plan ? s.plan.dist : s.speed * MISS_TIME;
      const untilGoal = Math.max(0, (goal - s.dist) / s.speed);
      if (left < untilGoal) {
        s.dist += s.speed * left;
        s.time += left;
        left = 0;
      } else {
        s.dist = goal;
        s.time += untilGoal;
        left -= untilGoal;
        if (s.plan) {
          capture(s);
        } else {
          place(s);
          end(s, 'miss');
        }
      }
    }
  }
  place(s);
}

/**
 * 입력 한 번. 대기 중이면 판을 시작하고, 궤도를 도는 중이면 접선 방향으로 떠난다.
 * 상태가 바뀌었으면 true.
 */
export function tap(s) {
  if (s.mode === 'ready') {
    s.mode = 'orbit';
    s.sweep = 0;
    s.events.push({ type: 'start' });
    return true;
  }
  if (s.mode !== 'orbit') return false;
  place(s);
  s.ox = s.x;
  s.oy = s.y;
  s.dist = 0;
  s.quick = s.sweep < BONUS_SWEEP;
  s.plan = aim(s);
  s.mode = 'flight';
  s.events.push({ type: 'release', x: s.x, y: s.y, quick: s.quick });
  return true;
}

/** 표면에서 우주선까지의 고도. 0에 가까우면 곧 추락한다. */
export function altitude(s) {
  const p = s.planets[s.cur];
  return Math.max(0, s.radius - p.body - CRAFT_R);
}

/**
 * 자동 조종: 지금 탭하면 더 먼 행성에 걸리는지 알려 준다.
 * 시연 모드와 "코스는 항상 통과 가능하다"는 테스트에 쓴다.
 */
export function autopilot(s) {
  if (s.mode === 'ready') return true;
  if (s.mode !== 'orbit') return false;
  const plan = aim(s);
  return plan !== null && plan.idx > s.maxIdx;
}
