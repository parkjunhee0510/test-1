import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  step,
  tap,
  aim,
  autopilot,
  altitude,
  tune,
  multOf,
  TAU,
  CRAFT_R,
  MIN_ALT,
  BONUS_SWEEP,
  MAX_MULT,
  SKIP_MAX,
  X_MAX,
} from '../src/logic.js';

const TICK = 1 / 120;

/** 자동 조종으로 hops번 전진시킨다. 죽으면 그 자리에서 멈춘다. */
function fly(s, hops, { wait = 0 } = {}) {
  const goal = s.maxIdx + hops;
  for (let i = 0; i < 5_000_000 && s.mode !== 'over' && s.maxIdx < goal; i++) {
    if (autopilot(s) && (s.mode === 'ready' || s.sweep >= wait)) tap(s);
    step(s, TICK);
  }
  return s;
}

/** 조건에 맞는 순간까지 궤도를 돌린다. */
function orbitUntil(s, predicate, limit = 20) {
  for (let t = 0; t < limit; t += TICK / 4) {
    if (predicate(s)) return true;
    step(s, TICK / 4);
    if (s.mode !== 'orbit') return false;
  }
  return false;
}

test('같은 시드는 같은 코스를, 다른 시드는 다른 코스를 만든다', () => {
  const a = fly(createGame(42), 30);
  const b = fly(createGame(42), 30);
  const c = fly(createGame(43), 30);
  assert.deepEqual(a.planets, b.planets);
  assert.notDeepEqual(a.planets.slice(0, 10), c.planets.slice(0, 10));
});

test('행성은 위로만 이어지고, 좌우 한계 안에 있고, 고리끼리 겹치지 않는다', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { planets } = fly(createGame(seed), 300);
    assert.ok(planets.length > 300);
    for (let i = 1; i < planets.length; i++) {
      const p = planets[i];
      assert.ok(p.y > planets[i - 1].y, `seed ${seed} #${i}: y가 증가해야 한다`);
      assert.ok(Math.abs(p.x) <= X_MAX + 1e-9, `seed ${seed} #${i}: 좌우 한계`);
      assert.ok(p.body + MIN_ALT < p.ring, `seed ${seed} #${i}: 고리가 최저 궤도보다 커야 한다`);
      for (let j = Math.max(0, i - 4); j < i; j++) {
        const q = planets[j];
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        assert.ok(d > p.ring + q.ring + 8, `seed ${seed} #${j}-#${i}: 고리가 겹친다`);
      }
    }
  }
});

test('포획 직후에도 한 바퀴는 돌 수 있다(난이도 수치 점검)', () => {
  // 가장 낮은 포획 궤도에서 한 바퀴를 도는 동안 추락하지 않아야 탈출 기회가 반드시 한 번 온다.
  for (let i = 0; i <= 120; i++) {
    const k = tune(i);
    for (const body of [12, 16, 20]) {
      const low = body + MIN_ALT;
      const burn = body + CRAFT_R;
      const afterOneLap = low * Math.exp((-TAU * k.decay) / k.speed);
      assert.ok(afterOneLap > burn * 1.05, `#${i} body ${body}: ${afterOneLap} <= ${burn}`);
    }
  }
});

test('대기 상태에서는 궤도가 낮아지지 않고, 첫 탭은 판을 시작한다', () => {
  const s = createGame(7);
  const r0 = s.radius;
  step(s, 5);
  assert.equal(s.mode, 'ready');
  assert.equal(s.radius, r0);
  assert.equal(tap(s), true);
  assert.equal(s.mode, 'orbit');
  assert.deepEqual(s.events.map((e) => e.type), ['start']);
  step(s, 1);
  assert.ok(s.radius < r0, '시작하면 궤도가 낮아지기 시작한다');
});

test('궤도 진행은 시간 간격을 어떻게 쪼개도 같다', () => {
  const a = createGame(3);
  const b = createGame(3);
  tap(a);
  tap(b);
  step(a, 1.5);
  for (let i = 0; i < 900; i++) step(b, 1.5 / 900);
  assert.ok(Math.abs(a.angle - b.angle) < 1e-9);
  assert.ok(Math.abs(a.radius - b.radius) < 1e-9);
  assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6);
});

test('탭하면 접선 방향으로 떠난다', () => {
  const s = createGame(5);
  tap(s);
  step(s, 0.37);
  const p = s.planets[0];
  tap(s);
  assert.equal(s.mode, 'flight');
  const radial = [(s.ox - p.x) / s.radius, (s.oy - p.y) / s.radius];
  assert.ok(Math.abs(radial[0] * s.ux + radial[1] * s.uy) < 1e-9, '반지름 방향과 수직');
  assert.ok(Math.abs(Math.hypot(s.ux, s.uy) - 1) < 1e-12);
  const before = { x: s.x, y: s.y };
  step(s, 0.1);
  assert.ok(Math.abs(Math.hypot(s.x - before.x, s.y - before.y) - s.speed * 0.1) < 1e-9, '속력 유지');
});

test('높게 스치면 최근접점에서 매끄럽게 포획된다', () => {
  let checked = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const s = createGame(seed);
    tap(s);
    if (!orbitUntil(s, (g) => { const a = aim(g); return a !== null && a.tangent && a.idx === 1; })) continue;
    const plan = aim(s);
    tap(s);
    const heading = [s.ux, s.uy];
    while (s.mode === 'flight') step(s, TICK);
    assert.equal(s.mode, 'orbit');
    assert.equal(s.cur, 1);
    const p = s.planets[1];
    assert.ok(Math.abs(Math.hypot(s.x - p.x, s.y - p.y) - s.radius) < 1e-6);
    assert.ok(Math.abs(s.radius - plan.radius) < 0.2, '예측한 궤도 반지름 근처');
    // 포획 직후의 진행 방향이 날아오던 방향과 거의 같다(꺾이지 않는다).
    assert.ok(heading[0] * s.ux + heading[1] * s.uy > 0.99);
    checked++;
  }
  assert.ok(checked >= 20, `검사한 판이 너무 적다: ${checked}`);
});

test('행성 한가운데를 겨누면 최저 궤도에 걸린다', () => {
  let checked = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const s = createGame(seed);
    tap(s);
    if (!orbitUntil(s, (g) => { const a = aim(g); return a !== null && !a.tangent && a.idx === 1; })) continue;
    tap(s);
    while (s.mode === 'flight') step(s, TICK);
    const p = s.planets[1];
    assert.equal(s.mode, 'orbit');
    assert.ok(Math.abs(s.radius - (p.body + MIN_ALT)) < 0.2);
    assert.ok(altitude(s) > 0);
    checked++;
  }
  assert.ok(checked >= 20, `검사한 판이 너무 적다: ${checked}`);
});

test('어느 고리에도 닿지 않으면 잠시 뒤 "miss"로 끝난다', () => {
  const s = createGame(11);
  tap(s);
  assert.ok(orbitUntil(s, (g) => aim(g) === null));
  tap(s);
  assert.equal(s.plan, null);
  step(s, 0.5);
  assert.equal(s.mode, 'flight');
  step(s, 1);
  assert.equal(s.mode, 'over');
  assert.equal(s.over, 'miss');
  assert.equal(tap(s), false, '끝난 판에서는 탭이 아무 일도 하지 않는다');
});

test('떠나지 않고 버티면 "burn"으로 끝난다', () => {
  const s = createGame(11);
  tap(s);
  step(s, 60);
  assert.equal(s.mode, 'over');
  assert.equal(s.over, 'burn');
  const p = s.planets[0];
  assert.ok(Math.abs(s.radius - (p.body + CRAFT_R)) < 1e-9, '표면에 닿는 순간에 끝난다');
  assert.equal(s.events.at(-1).type, 'over');
});

test('점수: 연속으로 빨리 떠나면 배수가 오르고 최대 ×5에서 멈춘다', () => {
  const s = createGame(21);
  fly(s, 12);
  const captures = s.events.filter((e) => e.type === 'capture');
  let streak = 0;
  let total = 0;
  for (const e of captures) {
    streak += 1;
    assert.equal(e.mult, Math.min(streak, MAX_MULT));
    assert.equal(e.gain, e.jumped * e.mult);
    total += e.gain;
  }
  assert.equal(s.score, total);
  assert.equal(multOf(0), 1);
  assert.equal(multOf(2), 2);
  assert.equal(multOf(99), MAX_MULT);
});

test('점수: 늦게 떠나면 연속이 끊겨 배수가 1로 돌아간다', () => {
  const s = createGame(21);
  fly(s, 8); // 한 번에 최대 2칸이므로 포획이 적어도 4번 일어난다
  assert.ok(s.streak >= 4);
  s.events.length = 0;
  fly(s, 1, { wait: BONUS_SWEEP });
  const e = s.events.find((ev) => ev.type === 'capture');
  assert.equal(s.streak, 0);
  assert.equal(e.mult, 1);
  assert.equal(e.gain, e.jumped);
});

test('자동 조종은 어떤 코스든 끝없이 통과한다', () => {
  for (let seed = 1; seed <= 15; seed++) {
    const s = fly(createGame(seed * 7919), 400);
    assert.notEqual(s.mode, 'over', `seed ${seed * 7919}: #${s.maxIdx}에서 ${s.over}`);
    assert.ok(s.maxIdx >= 400);
  }
});

test('한 번에 행성 하나까지만 건너뛸 수 있고, 건너뛰면 그만큼 점수가 는다', () => {
  const s = fly(createGame(1234), 300);
  const jumps = s.events.filter((e) => e.type === 'capture').map((e) => e.jumped);
  assert.ok(jumps.every((j) => j === 1 || j === 2), '1칸 또는 2칸만 나온다');
  assert.ok(jumps.includes(1) && jumps.includes(2), '두 경우가 모두 실제로 나온다');
  assert.ok(Math.abs(s.cur - s.maxIdx) <= SKIP_MAX);
});

test('같은 시각에 탭하면 프레임 간격이 달라도 결과가 같다', () => {
  // 120Hz로 돌린 판의 탭 시각을 기록한 뒤, 훨씬 거친 간격으로 다시 돌려 비교한다.
  // 떠나는 각도의 미세한 차이는 뛸 때마다 몇 배씩 커지므로(당구공과 같다)
  // 부동소수점 오차가 드러나지 않는 짧은 구간만 비교한다.
  const a = createGame(99);
  const taps = [];
  for (let tick = 0; a.maxIdx < 8 && a.mode !== 'over'; tick++) {
    if (autopilot(a)) {
      tap(a);
      taps.push(tick * TICK);
    }
    step(a, TICK);
  }
  const endTime = a.time;

  const b = createGame(99);
  const coarse = 0.05;
  let now = 0;
  const advance = (until) => {
    while (until - now > 1e-12) {
      const dt = Math.min(coarse, until - now);
      step(b, dt);
      now += dt;
    }
  };
  for (const at of taps) {
    advance(at);
    tap(b);
  }
  advance(endTime);

  assert.equal(b.mode, a.mode);
  assert.equal(b.score, a.score);
  assert.equal(b.maxIdx, a.maxIdx);
  assert.equal(b.cur, a.cur);
  assert.ok(a.maxIdx >= 8 && taps.length >= 5, '여러 번 뛴 뒤의 상태를 비교한다');
  assert.ok(Math.abs(b.radius - a.radius) < 1e-6);
  assert.ok(Math.abs(b.x - a.x) < 1e-6 && Math.abs(b.y - a.y) < 1e-6);
});

test('상태는 복제할 수 있다(순수 데이터)', () => {
  const s = fly(createGame(5), 3);
  const copy = structuredClone(s);
  step(s, 0.3);
  step(copy, 0.3);
  assert.deepEqual(copy, s);
});
