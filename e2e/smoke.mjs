// 실제 브라우저에서 게임이 뜨고, 입력이 먹고, 점수가 오르는지 확인하는 스모크 테스트.
// Playwright가 설치된 환경에서만 돈다: npm i -D playwright && npx playwright install chromium
// 사용법: node e2e/smoke.mjs [스크린샷을 저장할 폴더]

import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createServer } from '../scripts/serve.mjs';

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  console.error('Playwright를 찾을 수 없습니다. `npm i -D playwright` 후 다시 실행하세요.');
  process.exit(1);
}

const shotDir = process.argv[2] ?? null;
if (shotDir) await mkdir(shotDir, { recursive: true });

const server = createServer();
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const problems = [];

async function open(path, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    ...options,
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  await page.goto(base + path);
  await page.waitForSelector('#stage[data-score]');
  return page;
}

const mode = (page) => page.getAttribute('#stage', 'data-mode');
const shot = async (page, name) => {
  if (shotDir) await page.screenshot({ path: join(shotDir, name) });
};

let passed = 0;
async function check(name, fn) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

try {
  await check('첫 화면: 안내판이 보이고 캔버스가 그려진다', async () => {
    const page = await open('/?seed=7');
    assert.equal(await mode(page), 'ready');
    assert.equal(await page.isVisible('#panel'), true);
    assert.match(await page.textContent('#panel-title'), /궤도 뛰기/);
    const painted = await page.evaluate(() => {
      const c = document.getElementById('view');
      const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      const seen = new Set();
      for (let i = 0; i < data.length; i += 4 * 97) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      return seen.size;
    });
    assert.ok(painted > 20, `캔버스에 그려진 색이 너무 적다: ${painted}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, '가로 스크롤이 생기면 안 된다');
    await shot(page, 'ready-light.png');
    await page.context().close();
  });

  await check('키보드: Space로 출발하고, 다시 누르면 궤도를 떠난다', async () => {
    const page = await open('/?seed=7');
    await page.keyboard.press('Space');
    assert.equal(await mode(page), 'orbit');
    assert.equal(await page.isVisible('#panel'), false);
    assert.equal(await page.isVisible('#hint'), true);
    await page.waitForTimeout(300);
    await page.keyboard.press('Space');
    assert.equal(await mode(page), 'flight');
    await page.waitForFunction(() => document.getElementById('stage').dataset.mode !== 'flight', null, { timeout: 8000 });
    assert.match(await mode(page), /^(orbit|over)$/);
    await page.context().close();
  });

  await check('버티면 추락하고, 결과가 뜬 뒤 탭하면 새 판이 바로 시작된다', async () => {
    const page = await open('/?seed=7');
    await page.mouse.click(195, 500);
    assert.equal(await mode(page), 'orbit');
    await page.waitForFunction(() => document.getElementById('stage').dataset.mode === 'over', null, { timeout: 20000 });
    assert.equal(await page.isVisible('#panel'), true);
    assert.match(await page.textContent('#panel-title'), /대기권 추락/);
    assert.match(await page.textContent('#panel-stats'), /0점 · 행성 0개/);
    await shot(page, 'over-light.png');
    await page.waitForTimeout(600);
    await page.mouse.click(195, 500);
    assert.equal(await mode(page), 'orbit');
    assert.equal(await page.isVisible('#panel'), false);
    await page.context().close();
  });

  await check('소리 버튼은 게임 입력으로 새지 않고 상태가 저장된다', async () => {
    const page = await open('/?seed=7');
    await page.click('#mute');
    assert.equal(await page.getAttribute('#mute', 'aria-pressed'), 'true');
    assert.equal(await mode(page), 'ready', '버튼을 눌러도 판이 시작되면 안 된다');
    await page.reload();
    await page.waitForSelector('#stage[data-score]');
    assert.equal(await page.getAttribute('#mute', 'aria-pressed'), 'true');
    await page.context().close();
  });

  await check('자동 시연: 실제 브라우저에서 행성을 여러 개 건너고 점수가 오른다', async () => {
    const page = await open('/?seed=7&auto=1', { colorScheme: 'dark' });
    await page.waitForFunction(() => Number(document.getElementById('stage').dataset.planet) >= 6, null, { timeout: 30000 });
    assert.ok(Number(await page.getAttribute('#stage', 'data-score')) >= 6);
    assert.equal(await page.isVisible('#mult'), true, '연속 배수가 표시된다');
    await shot(page, 'play-dark.png');
    await page.context().close();
  });

  await check('넓은 화면에서도 가로 스크롤 없이 뜬다', async () => {
    const page = await open('/?seed=7&auto=1', { viewport: { width: 1280, height: 720 } });
    await page.waitForFunction(() => Number(document.getElementById('stage').dataset.planet) >= 2, null, { timeout: 30000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    await shot(page, 'play-wide-light.png');
    await page.context().close();
  });

  assert.deepEqual(problems, [], '콘솔 오류가 없어야 한다');
  console.log(`\n${passed}개 통과`);
} catch (err) {
  console.error(`\n실패: ${err.message}`);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
