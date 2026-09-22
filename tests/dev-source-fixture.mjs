#!/usr/bin/env node
/*
 * [INPUT]: 隔离测试目录与开发编排传入的环境/命令参数。
 * [OUTPUT]: 可控构建失败及带单实例记录的合成后台。
 * [POS]: dev-sources-integration.test 的进程夹具；不连接或注入任何宿主。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { basename, join } from 'node:path';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  appendFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
const root = process.cwd();
if (['cargo', 'npm'].includes(basename(process.argv[1]))) {
  if (existsSync(join(root, 'fail-build'))) process.exit(1);
  if (basename(process.argv[1]) === 'cargo') {
    mkdirSync(join(root, 'target/debug'), { recursive: true });
    copyFileSync(process.argv[1], join(root, 'target/debug/codex-buddy'));
  } else {
    mkdirSync(join(root, 'target/web'), { recursive: true });
    writeFileSync(join(root, 'target/web/index.html'), '<p>fixture</p>');
  }
} else {
  if (existsSync(join(root, 'fail-connect'))) {
    rmSync(join(root, 'fail-connect'));
    process.exit(1);
  }
  const data = process.env.CODEX_BUDDY_HOME;
  const config = JSON.parse(readFileSync(join(data, 'config.json')));
  const injection = join(process.env.BUDDY_FIXTURE_DIRECTORY, 'injection.json');
  const events = join(process.env.BUDDY_FIXTURE_DIRECTORY, 'events.jsonl');
  writeFileSync(injection, JSON.stringify({ pid: process.pid, root }), { flag: 'wx' });
  appendFileSync(
    events,
    JSON.stringify({
      action: 'connect',
      root,
      target: config.targetId,
      endpoint: config.cdpEndpoint,
    }) + '\n',
  );
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': connected\n\n');
      return;
    }
    if (req.url === '/api/development') {
      const snapshot = JSON.parse(readFileSync(process.env.CODEX_BUDDY_DEV_ASSETS));
      res.end(JSON.stringify({ development: true, roots: 1, revision: snapshot.revision }));
    } else
      res.end(
        JSON.stringify({
          connection: {
            status: 'connected',
            endpoint: config.cdpEndpoint,
            targetId: config.targetId,
          },
        }),
      );
  });
  server.listen(0, '127.0.0.1', () =>
    writeFileSync(
      join(data, 'runtime.json'),
      JSON.stringify({ pid: process.pid, port: server.address().port, token: 'synthetic-token' }),
    ),
  );
  process.on('SIGTERM', () => {
    appendFileSync(events, JSON.stringify({ action: 'disconnect', root }) + '\n');
    rmSync(injection);
    rmSync(join(data, 'runtime.json'));
    server.closeAllConnections();
    server.close(() => process.exit(0));
  });
}
