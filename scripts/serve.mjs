// 개발용 정적 서버. 의존성 없이 index.html과 src/ 아래 파일만 내보낸다.
// ES 모듈은 file:// 로 열면 막히므로 로컬에서도 HTTP로 띄워야 한다.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export function createServer() {
  return http.createServer(async (req, res) => {
    let path;
    try {
      path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    if (path === '/') path = '/index.html';
    const file = resolve(root, `.${path}`);
    // 공개 대상은 index.html과 src/ 뿐이다. 저장소의 다른 파일(.git 등)은 내보내지 않는다.
    const allowed = file === resolve(root, 'index.html') || file.startsWith(resolve(root, 'src') + sep);
    if (!allowed || !(extname(file) in types)) {
      res.writeHead(404).end('Not found');
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)], 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 5173;
  createServer().listen(port, () => {
    console.log(`궤도 뛰기: http://localhost:${port}`);
  });
}
