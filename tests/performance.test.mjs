/* [INPUT]: Actual monitor, settings page and host runtime with synthetic APIs.
 * [OUTPUT]: Opt-in sampling, bounded visual history, expiring leases and disabled feature cleanup regressions.
 * [POS]: Isolated browsers and fake clocks; no real chat or model requests.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { buildPanel } from '../scripts/build-panel.mjs';
import { fixtureSettings } from './fixtures.mjs';

test('monitor is inert by default, counts nested work once and releases its observer', () => {
  let now = 1,
    clockReads = 0,
    connected = 0,
    id = 0;
  const timers = new Map(),
    api = {};
  const source = readFileSync('ui/shared/performance.js', 'utf8').replaceAll(
    'export function ',
    'function ',
  );
  runInNewContext(
    source + '\nObject.assign(api,{measureWork,samplePerformance,stopPerformance});',
    {
      api,
      performance: {
        now: () => {
          clockReads++;
          return now;
        },
        memory: { usedJSHeapSize: 1000 },
      },
      document: { hidden: false },
      PerformanceObserver: class {
        static supportedEntryTypes = ['longtask'];
        observe() {
          connected++;
        }
        disconnect() {
          connected--;
        }
      },
      setTimeout: (fn) => {
        timers.set(++id, fn);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  api.measureWork('scan', () => (now += 2));
  assert.equal(clockReads, 0);
  assert.equal(timers.size, 0);
  assert.equal(api.samplePerformance().intervalMs, 0);
  api.measureWork('scan', () => {
    now += 2;
    api.measureWork('render', () => (now += 3));
  });
  assert.throws(() =>
    api.measureWork('failure', () => {
      now++;
      throw Error('test');
    }),
  );
  const value = api.samplePerformance();
  assert.equal(value.busyMs, 6);
  assert.equal(value.work.scan.totalMs, 5);
  assert.equal(value.work.render.totalMs, 3);
  assert.equal(connected, 1);
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(connected, 0);
  assert.equal(timers.size, 0);
  const previous = clockReads;
  api.measureWork('scan', () => {});
  assert.equal(clockReads, previous);
});

test('monitor history stays bounded, resets on restart and shows missing data as gaps', async () => {
  const result = await build({
    entryPoints: ['ui/settings/performance-history.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
  });
  const module = { exports: {} };
  runInNewContext(result.outputFiles[0].text, { module });
  const { appendPerformancePoint, chartGeometry } = module.exports;
  const sample = (at, cpu = 2, pid = 42) => ({
    sampledAt: at,
    backend: { pid, cpuPercent: cpu, memoryBytes: 10485760 },
    host: null,
  });
  let history = [];
  for (let i = 0; i < 1000; i++) history = appendPerformancePoint(history, sample(i * 100));
  assert.equal(history.length, 60, 'fast updates cannot grow beyond 60 points');
  assert.equal(appendPerformancePoint(history, sample(99900)), history, 'deduplicate samples');
  assert.equal(appendPerformancePoint(history, sample(0)), history, 'reject older responses');
  history = appendPerformancePoint(history, sample(500000));
  assert.equal(history.length, 1, 'discard samples older than five minutes');
  history = appendPerformancePoint(history, sample(505000, 2, 43));
  assert.equal(history.length, 1, 'restart starts a new history');
  history = [];
  for (const [at, cpu] of [
    [0, 1],
    [5000, 2],
    [10000, null],
    [15000, 3],
    [35000, 4],
  ])
    history = appendPerformancePoint(history, sample(at, cpu));
  const chart = chartGeometry(history, 'cpu', 5);
  assert.equal(JSON.stringify(chart.segments.map((part) => part.length)), '[2,1,1]');
  assert.equal(chart.minutes, 1);
  assert.equal(chart.segments.at(-1)[0].x, 300);
  const invalid = appendPerformancePoint([], sample(1000, -1));
  assert.equal(invalid[0].cpu, null, 'missing and invalid readings are never invented zeros');
  assert.equal(invalid[0].longTasks, null);
});

test('performance settings sample only while visible and preserve confirmed toggles after failure', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'jsx',
      contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{PerformanceSettings}from'./ui/settings/performance-settings';
function App(){const[active,setActive]=useState(true);window.setActive=setActive;return <PerformanceSettings live active={active}/>};createRoot(document.getElementById('root')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    outfile: 'target/reports/performance/settings-test.js',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const script = bundle.outputFiles.find((file) => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find((file) => file.path.endsWith('.css')).text;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    let state = {
        preferences: { integrationEnabled: true, monitoringEnabled: false, revision: 0 },
        connectionStatus: 'connected',
        sample: null,
      },
      samples = 0,
      requests = 0,
      reject = false;
    await page.route('http://performance.test/**', (route) => {
      const url = new URL(route.request().url()),
        patch = route.request().postDataJSON();
      if (url.pathname !== '/api/performance')
        return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      requests++;
      if (patch) {
        if (reject) return route.fulfill({ status: 409, json: { message: '合成保存失败' } });
        assert.equal(patch.expectedRevision, state.preferences.revision);
        const { expectedRevision, ...changes } = patch;
        state.preferences = { ...state.preferences, ...changes, revision: expectedRevision + 1 };
        state.connectionStatus = state.preferences.integrationEnabled
          ? 'connected'
          : 'disconnected';
      }
      if (url.searchParams.has('sample')) {
        samples++;
        assert.equal(state.preferences.monitoringEnabled, true);
        state.sample = {
          sampledAt: 1700000000000 + samples * 5000,
          backend: { pid: 42, cpuPercent: samples === 1 ? null : 2, memoryBytes: 10485760 },
          host: {
            intervalMs: samples === 1 ? 0 : 5000,
            busyMs: 12,
            work: { scan: { count: 3, totalMs: 12, maxMs: 5 } },
            hostJsHeapBytes: 104857600,
            hostLongTasks: 1,
            hostLongestTaskMs: 85,
          },
        };
      }
      return route.fulfill({ json: state });
    });
    await page.goto('http://performance.test');
    await page.clock.install();
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    const monitor = page.getByRole('switch', { name: '性能监测' }),
      integration = page.getByRole('switch', { name: '连接到 Codex' });
    await monitor.waitFor();
    await page.waitForFunction(() => !document.querySelector('[role=switch]').disabled);
    await page.clock.runFor(10000);
    assert.equal(samples, 0);
    await monitor.click();
    await page.waitForFunction(
      () => document.querySelectorAll('[role=switch]')[1].getAttribute('aria-checked') === 'true',
    );
    await page.getByText('10.0 MB', { exact: true }).waitFor();
    await page.clock.runFor(5100);
    await page.getByText('2.0%', { exact: true }).waitFor();
    await page.getByRole('img', { name: /Buddy 后台 CPU.*1个采样点/ }).waitFor();
    await page.getByRole('img', { name: /Buddy 后台物理内存.*2个采样点/ }).waitFor();
    await page.getByText('工作明细', { exact: true }).click();
    await page.getByText('聊天检查', { exact: true }).waitFor();
    const beforeResize = requests;
    for (const width of [320, 680, 1100]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await page.locator('.performance-dashboard').evaluate((element) => {
        const children = [...element.querySelectorAll('.performance-instrument')];
        return {
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
          tops: children.map((child) => child.getBoundingClientRect().top),
        };
      });
      assert.ok(
        geometry.scrollWidth <= geometry.width + 1,
        `${width}px has no horizontal overflow`,
      );
      assert.equal(geometry.tops[0] === geometry.tops[1], width > 480);
    }
    assert.equal(requests, beforeResize, 'layout changes do not add sampling requests');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await page
        .locator('.performance-dial-value')
        .evaluate((element) => getComputedStyle(element).transitionDuration),
      '0s',
    );
    await page.evaluate(() => window.setActive(false));
    await page.waitForTimeout(10);
    const count = requests;
    await page.clock.runFor(15000);
    assert.equal(requests, count);
    await page.evaluate(() => window.setActive(true));
    await page.waitForTimeout(10);
    reject = true;
    await integration.click();
    await page.getByRole('alert').waitFor();
    assert.equal(await integration.getAttribute('aria-checked'), 'true');
    reject = false;
    await integration.click();
    await page.getByText('Codex 集成已暂停', { exact: true }).waitFor();
    await monitor.click();
    await page.waitForFunction(
      () => document.querySelectorAll('[role=switch]')[1].getAttribute('aria-checked') === 'false',
    );
    const end = samples;
    await page.getByRole('img', { name: /Buddy 后台 CPU.*0个采样点/ }).waitFor();
    await page.clock.runFor(15000);
    assert.equal(samples, end);
  } finally {
    await browser.close();
  }
});

test('unchanged host sync does not redraw and disabled tools release timers and DOM listeners', async () => {
  const bundle = await buildPanel();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(7000);
    await page.route('http://host.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: readFileSync('tests/host-fixture.html', 'utf8'),
      }),
    );
    await page.goto('http://host.test');
    await page.evaluate((settings) => {
      window.settings = { ...settings, terminologyEnabled: true };
      window.calls = [];
      window.__companionHostRequest = (raw) => {
        const { id, path, payload } = JSON.parse(raw);
        window.calls.push(path);
        let reply =
          path === '/stepwise/settings'
            ? { settings: window.settings }
            : path === '/features'
              ? { features: [] }
              : path === '/terminology'
                ? { preferences: { enabled: true, semantic: false, mastered: [] }, entries: [] }
                : {};
        queueMicrotask(() => window.__companionDesktop?.complete(id, reply));
      };
    }, fixtureSettings);
    await page.evaluate(bundle);
    await page.waitForFunction(
      () =>
        window.__companionFloatingPanel?.state.settingsLoaded &&
        window.__codexBuddyPromptEnhancer &&
        window.__codexBuddyTerminology,
    );
    const measured = await page.evaluate(() => {
      const p = window.__companionFloatingPanel,
        ui = { ...p.panelPreferences(), layoutMode: 'workbench' };
      p.syncPanelPreferences(ui, 123, false);
      p.samplePerformance();
      for (let i = 0; i < 40; i++) p.syncPanelPreferences(ui, 123, false);
      return p.samplePerformance();
    });
    assert.equal(measured.work.render?.count || 0, 0, 'identical heartbeats do not redraw');
    await page.evaluate(async () => {
      Object.assign(window.settings, {
        promptEnhancementEnabled: false,
        terminologyEnabled: false,
      });
      await window.__companionFloatingPanel.syncSettings(window.settings);
    });
    assert.equal(
      await page.evaluate(
        () => !!window.__codexBuddyPromptEnhancer || !!window.__codexBuddyTerminology,
      ),
      false,
    );
    const termsBefore = await page.evaluate(
      () => window.calls.filter((p) => p === '/terminology').length,
    );
    await page.waitForTimeout(1600);
    assert.equal(
      await page.evaluate(() => window.calls.filter((p) => p === '/terminology').length),
      termsBefore,
    );
    await page.evaluate(async () => {
      Object.assign(window.settings, { promptEnhancementEnabled: true, terminologyEnabled: true });
      await window.__companionFloatingPanel.syncSettings(window.settings);
    });
    await page.waitForFunction(
      () => window.__codexBuddyPromptEnhancer && window.__codexBuddyTerminology,
    );
    await page.evaluate(() => window.__companionDesktop.destroy());
    assert.equal(
      await page.evaluate(
        () =>
          !!window.__companionFloatingPanel ||
          !!window.__codexBuddyPromptEnhancer ||
          !!window.__codexBuddyTerminology,
      ),
      false,
    );
    assert.equal(
      await page
        .locator(
          '[data-companion-stepwise-root],[data-codex-buddy-dock],[data-codex-buddy-prompt],[data-buddy-terms]',
        )
        .count(),
      0,
    );
  } finally {
    await browser.close();
  }
});
