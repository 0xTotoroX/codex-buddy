/*
 * [INPUT]: 完整 dev.mjs、临时双 worktree、模拟编译器/CDP/后台及真实 Vite/Chromium。
 * [OUTPUT]: 固定地址下切换源码、回退、资源更新、前端选择器与清理的进程级验收。
 * [POS]: 开发调试集成回归；所有端口、进程、配置均为隔离夹具。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  cpSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  realpathSync,
  symlinkSync,
  chmodSync,
  appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { wsServer } from 'playwright-core/lib/utilsBundle';
import { chromium } from 'playwright';
import { until, stopChild } from '../scripts/dev-runtime.mjs';
import { readRecord } from '../scripts/dev-sources.mjs';

test(
  'Dev switches isolated worktrees without restarting its host or losing the settings address',
  { timeout: 90000 },
  async () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'buddy-source-flow-')));
    const project = resolve(import.meta.dirname, '..');
    const main = join(base, 'main'),
      other = join(base, 'Stepwise'),
      bin = join(base, 'bin');
    mkdirSync(main);
    mkdirSync(bin);
    mkdirSync(join(base, 'home'));
    mkdirSync(join(base, 'install'));
    const git = (...args) => execFileSync('git', ['-C', main, ...args], { stdio: 'pipe' });
    let dev,
      browser,
      logs = '';
    const host = createServer((req, res) =>
      res.end(
        JSON.stringify([
          {
            type: 'page',
            id: 'fixture-window',
            url: 'app://-/index.html',
            webSocketDebuggerUrl: `ws://127.0.0.1:${host.address().port}/fixture`,
          },
        ]),
      ),
    );
    const sockets = new wsServer({ server: host });
    sockets.on('connection', (socket) =>
      socket.on('message', (message) =>
        socket.send(
          JSON.stringify({
            id: JSON.parse(message).id,
            result: { result: { value: { occupied: false, focused: true } } },
          }),
        ),
      ),
    );
    host.listen(0, '127.0.0.1');
    await once(host, 'listening');
    try {
      for (const dir of ['ui', 'scripts'])
        cpSync(join(project, dir), join(main, dir), { recursive: true });
      mkdirSync(join(main, 'src'));
      mkdirSync(join(main, '.cargo'));
      for (const file of [
        'Cargo.toml',
        'Cargo.lock',
        'build.rs',
        'src/main.rs',
        '.cargo/config.toml',
      ])
        writeFileSync(join(main, file), '// fixture');
      writeFileSync(join(main, 'package.json'), '{"type":"module"}');
      writeFileSync(join(main, '.gitignore'), 'node_modules/\ntarget/\nfail-*\n');
      git('init', '-b', 'main');
      git('config', 'user.name', 'Fixture');
      git('config', 'user.email', 'fixture@example.invalid');
      git('add', '.');
      git('commit', '-m', 'fixture');
      git('worktree', 'add', '-b', 'Stepwise', other);
      for (const root of [main, other])
        symlinkSync(join(project, 'node_modules'), join(root, 'node_modules'));
      for (const command of ['cargo', 'npm']) {
        copyFileSync(join(project, 'tests/dev-source-fixture.mjs'), join(bin, command));
        chmodSync(join(bin, command), 0o755);
      }
      const endpoint = `http://127.0.0.1:${host.address().port}`;
      const launch = () => {
        dev = spawn(
          process.execPath,
          [
            join(main, 'scripts/dev.mjs'),
            '--no-open',
            '--cdp',
            endpoint,
            '--target',
            'fixture-window',
          ],
          {
            cwd: main,
            env: {
              ...process.env,
              HOME: join(base, 'home'),
              CODEX_BUDDY_HOME: join(base, 'install'),
              BUDDY_FIXTURE_DIRECTORY: base,
              PATH: `${bin}:${process.env.PATH}`,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        dev.stdout.on('data', (s) => {
          logs += s;
        });
        dev.stderr.on('data', (s) => {
          logs += s;
        });
      };
      launch();
      const session = await until(
        () => {
          if (dev.exitCode !== null) throw new Error(logs);
          return readRecord(join(main, 'target/dev/session.json'));
        },
        'fixture startup timeout',
        30000,
      );
      const send = (path, body) =>
        fetch(session.url + '/api/' + path, {
          method: body ? 'POST' : 'GET',
          headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
      assert.equal((await (await send('dev/sources')).json()).loaded, true);
      assert.equal((await fetch(session.url + '/api/dev/sources')).status, 401);
      assert.equal(
        (
          await fetch(session.url + '/api/dev/sources', {
            headers: { Origin: 'https://example.com', Authorization: `Bearer ${session.token}` },
          })
        ).status,
        403,
      );
      assert.match(await (await fetch(session.url)).text(), /__buddy_dev.js/);
      const originalPID = JSON.parse(readFileSync(join(base, 'injection.json'))).pid;
      writeFileSync(join(other, 'fail-build'), '');
      assert.equal((await send('dev/sources', { path: other })).status, 409);
      assert.equal(
        JSON.parse(readFileSync(join(base, 'injection.json'))).pid,
        originalPID,
        'failed preparation keeps original service',
      );
      assert.equal(existsSync(join(other, 'target/dev/owner.json')), false);
      rmSync(join(other, 'fail-build'));
      writeFileSync(join(other, 'fail-connect'), '');
      assert.equal((await send('dev/sources', { path: other })).status, 409);
      assert.equal(
        JSON.parse(readFileSync(join(base, 'injection.json'))).root,
        main,
        'failed connection restores original',
      );
      const switched = await send('dev/sources', { path: other });
      assert.equal(switched.status, 200, await switched.clone().text());
      assert.equal((await switched.json()).active, other);
      const staleSave = await fetch(session.url + '/api/settings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'X-Codex-Buddy-Source': session.sourceEpoch,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      assert.equal(staleSave.status, 409, 'old settings tabs cannot write into the new source');
      assert.equal(readRecord(join(main, 'target/dev/session.json')).url, session.url);
      assert.equal(
        readRecord(join(main, 'target/dev/session.json')).runtime,
        join(other, 'target/dev/real'),
      );
      assert.match(
        await (await fetch(session.url)).text(),
        /__buddy_dev.js/,
        'selector supplied to older source too',
      );
      const revision = readRecord(join(other, 'target/dev/panel.json')).revision;
      appendFileSync(join(other, 'ui/tokens.css'), '\n:root { --fixture-change: 1; }');
      await until(
        () => readRecord(join(other, 'target/dev/panel.json')).revision !== revision,
        'selected worktree hot update',
      );
      assert.equal((await (await send('dev/sources')).json()).loaded, true);
      // Mount the actual injected selector on a minimal settings page; API remains the real supervisor.
      const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      browser = await chromium.launch({
        headless: true,
        executablePath:
          process.env.CODEX_BUDDY_CHROME_BIN || (existsSync(chrome) ? chrome : undefined),
      });
      const page = await browser.newPage();
      await page.route(session.url + '/', async (route) => {
        const response = await route.fetch();
        const body = (await response.text()).replace(
          /<script type="module" src="\/main.tsx"><\/script>/,
          '',
        );
        await route.fulfill({ response, body });
      });
      await page.goto(`${session.url}/#token=${session.token}`);
      await page.getByText(/开发来源 · Stepwise/).waitFor();
      await page.locator('summary').click();
      await page.getByLabel('调试 worktree').selectOption(main);
      await page.getByRole('button', { name: '切换来源' }).click();
      await page.getByText(/开发来源 · main/).waitFor({ timeout: 30000 });
      await page.locator('summary').click();
      await page.getByText(/界面资源已确认/).waitFor();
      assert.equal(
        await page.evaluate(
          async () =>
            (
              await fetch('/api/settings', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${sessionStorage.getItem('companion-token')}`,
                  'Content-Type': 'application/json',
                },
                body: '{}',
              })
            ).status,
        ),
        200,
        'current page automatically includes its source identity',
      );
      mkdirSync(join(project, 'target/reports'), { recursive: true });
      await page.screenshot({ path: join(project, 'target/reports/dev-source-selector.png') });
      const events = readFileSync(join(base, 'events.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map(JSON.parse);
      for (const event of events.filter((e) => e.action === 'connect')) {
        assert.equal(event.target, 'fixture-window');
        assert.equal(event.endpoint, endpoint);
      }
      assert.equal(readRecord(join(base, 'injection.json')).root, main);
      await stopChild(dev);
      assert.equal(existsSync(join(base, 'injection.json')), false);
      assert.equal(existsSync(join(main, 'target/dev/owner.json')), false);
      assert.equal(existsSync(join(other, 'target/dev/owner.json')), false);
      // Remember another source across a supervisor restart, not just a page reload.
      writeFileSync(join(main, '.git/buddy-dev-source.json'), JSON.stringify({ path: other }));
      launch();
      const restoredSession = await until(
        () => {
          if (dev.exitCode !== null) throw new Error(logs);
          return readRecord(join(main, 'target/dev/session.json'));
        },
        'restore remembered source',
        30000,
      );
      assert.equal(restoredSession.source, other);
      assert.equal(readRecord(join(base, 'injection.json')).root, other);
      await stopChild(dev);
      assert.equal(existsSync(join(main, 'target/dev/owner.json')), false);
      assert.equal(existsSync(join(other, 'target/dev/owner.json')), false);
    } catch (error) {
      error.message += `\nSupervisor log:\n${logs}`;
      throw error;
    } finally {
      await browser?.close();
      await stopChild(dev);
      for (const socket of sockets.clients) socket.terminate();
      sockets.close();
      host.closeAllConnections();
      await new Promise((r) => host.close(r));
      rmSync(base, { recursive: true, force: true });
    }
  },
);
