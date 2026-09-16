/*
 * [INPUT]: 真实 Chromium、合成背景、正式与开发构建入口。
 * [OUTPUT]: B 版 Regular/Clear 像素与共享偏好同步、实时背景更新、几何/清理及正式构建回归。
 * [POS]: 可单独运行的浏览器测试；不读取用户聊天，不替代真实宿主验收。
 * [PROTOCOL]: 变更时核对 AGENTS.md。
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { buildPanel } from '../scripts/build-panel.mjs';
import { fixtureSettings } from './fixtures.mjs';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'target/reports/embedded-glass');
mkdirSync(output, { recursive: true });
const bundle = (
  await build({
    absWorkingDir: root,
    entryPoints: ['ui/panel/glass/lab.js'],
    bundle: true,
    format: 'iife',
    write: false,
  })
).outputFiles[0].text;
const style = readFileSync(resolve(root, 'ui/panel/glass/lab.css'), 'utf8');
const html = `<!doctype html><html><head><style>
body{margin:0;background:white;font:14px system-ui}
#background{height:1200px;display:flex;overflow:hidden}
#background>span{height:100%;width:20px;flex-shrink:0}
[data-companion-stepwise-root]{--csw-surface-opaque:#fff;--csw-text:#222;--csw-glass-edge:#ccc;--csw-muted:#555;position:fixed;inset:0;pointer-events:none}
.csw-popover{position:fixed;left:100px;top:100px;width:320px;height:240px}
.csw-glass{position:absolute;inset:0;width:100%;height:100%;overflow:hidden;border-radius:26px;backdrop-filter:blur(18px);background:#ffffff99}
.csw-control-deck{position:fixed;left:500px;top:100px;width:300px;pointer-events:auto;background:white;padding:16px}
${style}</style></head><body><div id="background">${Array.from({ length: 45 }, (_, i) => `<span style="background:${i % 2 ? '#437ce9' : '#eb4242'}"></span>`).join('')}</div>
<div data-companion-stepwise-root="true" data-presentation="embedded" data-material="native-glass" data-liquid-variant="clear" data-detached="false">
<div class="csw-popover"><div class="csw-glass"></div></div>
<div class="csw-control-deck"><button data-action="material"><span data-material-value></span></button></div></div></body></html>`;
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(req.url === '/host' ? readFileSync(resolve(root, 'tests/host-fixture.html')) : html);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const errors = [];
const results = [];
const record = (name, data = {}) => {
  results.push({ name, ...data });
  console.log('PASS', name, JSON.stringify(data));
};
try {
  const page = await browser.newPage({
    viewport: { width: 900, height: 700 },
    deviceScaleFactor: 1,
  });
  await page.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.__codexBuddyNativeReducedTransparency = nativeMatchMedia(
      '(prefers-reduced-transparency: reduce)',
    ).matches;
    window.matchMedia = (query) => {
      const result = nativeMatchMedia(query);
      if (query !== '(prefers-reduced-transparency: reduce)') return result;
      return new Proxy(result, {
        get(target, property) {
          if (property === 'matches') return false;
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(() => {
    localStorage.setItem('codex-buddy-dev:glass-engine', 'webgl');
    localStorage.setItem('codex-buddy-dev:glass-comparison', 'rim');
  });
  await page.evaluate(bundle);
  const settle = () =>
    page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
  const blurLevel = () =>
    page
      .locator('.csw-glass')
      .evaluate((el) => getComputedStyle(el).backdropFilter.match(/blur\(([^)]+)px\)/)?.[1]);
  const state = () => page.evaluate(() => window.__codexBuddyGlassLab.status());
  const screenshot = (name) =>
    page.screenshot({
      path: resolve(output, `${name}.png`),
      clip: { x: 100, y: 100, width: 320, height: 240 },
    });
  const pixels = (buffer) =>
    page.evaluate(
      async (bytes) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
        );
        const c = document.createElement('canvas');
        c.width = bitmap.width;
        c.height = bitmap.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return Array.from(ctx.getImageData(0, 0, c.width, c.height).data);
      },
      [...buffer],
    );
  await settle();
  assert.equal((await state()).phase, 'ready');
  assert.equal(
    await page.evaluate(() => localStorage.getItem('codex-buddy-dev:glass-engine')),
    null,
  );
  assert.equal(
    await page.locator('select, [data-csw-capture], canvas[data-csw-optics]').count(),
    0,
  );
  record('Legacy selection is retired; only the live SVG background is installed');
  const glass = await pixels(await screenshot('svg'));
  await page.evaluate(() => (document.querySelector('.csw-glass').style.backdropFilter = 'none'));
  const plain = await pixels(await screenshot('plain'));
  const delta = glass.reduce((sum, x, i) => sum + Math.abs(x - plain[i]), 0) / glass.length;
  // Clear keeps most of the center unchanged; the full-panel mean includes that area.
  assert.ok(delta > 2, `filter changes actual background pixels: ${delta}`);
  await page.evaluate(bundle);
  await settle();
  record('SVG backdrop renders visible optical changes', { delta });
  await page.evaluate(() => {
    document.querySelector('#background').replaceChildren();
    document.querySelector('#background').style.background = '#20aa40';
  });
  await settle();
  const green = await pixels(await screenshot('svg-updated'));
  const center = (120 * 320 + 160) * 4;
  assert.ok(green[center + 1] > green[center] + 20 && green[center + 1] > green[center + 2] + 20);
  record('Background content changes appear on the next browser frames without capture');
  await page.evaluate(() => {
    const p = document.querySelector('.csw-popover');
    p.style.width = '480px';
    p.style.height = '360px';
  });
  await page.waitForFunction(
    () => document.querySelector('feImage').getAttribute('width') === '480',
  );
  record('Resizing rebuilds the optical map for the new surface');
  const bending = await page.evaluate(async () => {
    const url = document.querySelector('feImage').getAttribute('href');
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const scale = Number(document.querySelector('feDisplacementMap').getAttribute('scale'));
    const shift = (y) => {
      const pixel = context.getImageData(canvas.width / 2, y, 1, 1).data;
      return Math.abs((pixel[1] / 255 - 0.5) * scale);
    };
    return {
      edge: shift(7),
      inner: shift(16),
      center: shift(canvas.height / 2),
    };
  });
  assert.ok(bending.edge > bending.inner && bending.edge > 0);
  assert.ok(bending.center < 1);
  record('B lens bends the edge and keeps a neutral center', bending);
  for (const open of ['false', 'true']) {
    await page
      .locator('.csw-popover')
      .evaluate((el, value) => el.setAttribute('data-open', value), open);
    await settle();
    assert.equal(await blurLevel(), '0.3');
  }
  const mapBefore = await page.locator('feImage').getAttribute('href');
  for (const [variant, blur] of [
    ['regular', '4'],
    ['clear', '0.3'],
  ]) {
    await page
      .locator('[data-companion-stepwise-root]')
      .evaluate((el, value) => el.setAttribute('data-liquid-variant', value), variant);
    await settle();
    assert.equal(await blurLevel(), blur);
    assert.equal(await page.locator('feImage').getAttribute('href'), mapBefore);
  }
  record('Regular/Clear share the B lens map; switching updates blur without rebuilding geometry');
  await page.locator('.csw-popover').evaluate((el) => {
    el.style.width = '100px';
    el.style.height = '36px';
  });
  await page.waitForFunction(
    () => document.querySelector('feImage').getAttribute('width') === '100',
  );
  const capsuleScale = await page.locator('feDisplacementMap').first().getAttribute('scale');
  assert.ok(Math.abs(Number(capsuleScale)) / 2 < 30);
  record('Capsule dimensions scale down the lens strength with the rim width');
  for (let i = 0; i < 4; i++) {
    await page.evaluate(bundle);
    await settle();
  }
  assert.equal(await page.locator('svg[data-csw-optics]').count(), 1);
  await page.evaluate(() => window.__codexBuddyGlassLab.destroy());
  assert.equal(await page.locator('[data-csw-optics]').count(), 0);
  const release = await buildPanel(root, false),
    development = await buildPanel(root, true);
  assert.ok(release.includes('buddy-bevel-') && development.includes('buddy-bevel-'));
  assert.ok(
    !development.includes('requestAdapter') && !development.includes('captureWithDeadline'),
  );
  record('Reinjection/cleanup and release inclusion pass; no GPU or capture runtime bundled');
  await page.goto(`http://127.0.0.1:${server.address().port}/host`);
  await page.evaluate((settings) => {
    window.__companionHostRequest = (raw) => {
      const request = JSON.parse(raw);
      queueMicrotask(() => window.__companionDesktop.complete(request.id, { settings }));
    };
  }, fixtureSettings);
  await page.evaluate(release);
  await page.waitForFunction(() => window.__companionFloatingPanel?.state.runtimeActive);
  await page.evaluate(() => {
    window.__companionFloatingPanel.setMaterial('native-glass');
    window.__companionFloatingPanel.setOpen(true);
  });
  await page.waitForFunction(() => !window.__companionFloatingPanel.state.transitioning);
  await page.locator('.csw-head').hover();
  await page.locator('button[data-view="settings"]').click();
  await page.waitForFunction(() => !window.__companionFloatingPanel.state.viewAnimation);
  await settle();
  assert.equal((await state()).phase, 'ready');
  assert.equal(await page.locator('[data-glass-lab]').count(), 0);
  await page.screenshot({ path: resolve(output, 'integrated-svg.png') });
  const star = page.getByRole('button', { name: '通透液态（Clear）', exact: true });
  assert.equal(await star.count(), 1);
  assert.ok(
    await star.evaluate((el) => {
      const bounds = el.getBoundingClientRect(),
        box = el.parentElement.getBoundingClientRect();
      return (
        bounds.left >= box.left &&
        bounds.right < box.right &&
        bounds.top >= box.top &&
        bounds.bottom <= box.bottom &&
        getComputedStyle(el.parentElement).borderTopWidth !== '0px'
      );
    }),
    'Star belongs inside the material control border',
  );
  assert.equal(await page.locator('[data-glass-comparison]').count(), 0);
  await star.click();
  await settle();
  assert.equal(await star.getAttribute('aria-pressed'), 'true');
  assert.equal((await state()).variant, 'clear');
  assert.equal(
    await page.evaluate(() => window.__companionFloatingPanel.panelPreferences().liquidVariant),
    'clear',
  );
  await page.evaluate(bundle);
  await settle();
  assert.equal((await state()).variant, 'clear');
  await star.click();
  await settle();
  assert.equal((await state()).variant, 'regular');
  record('Release star selects Regular/Clear and survives reinjection; A/B control is retired');
  const alignment = [];
  for (const fontSize of [13, 19]) {
    while (Number.parseInt(await page.locator('.csw-step-value').innerText()) < fontSize)
      await page.locator('[data-action=font-inc]').click();
    assert.equal(await page.locator('.csw-step-value').innerText(), `${fontSize}px`);
    for (const material of ['matte', 'frosted', 'native-glass']) {
      await page.evaluate(
        (material) => window.__companionFloatingPanel.setMaterial(material),
        material,
      );
      await settle();
      const bounds = await page.evaluate(() => {
        const material = document
          .querySelector('[data-action=material]')
          .parentElement.getBoundingClientRect();
        const font = document.querySelector('.csw-stepper').getBoundingClientRect();
        return {
          left: Math.abs(material.left - font.left),
          right: Math.abs(material.right - font.right),
        };
      });
      assert.ok(
        bounds.left <= 2 && bounds.right <= 2,
        JSON.stringify({ material, fontSize, ...bounds }),
      );
      alignment.push({ material, fontSize, ...bounds });
    }
  }
  record('Material and font controls align at 13px and 19px including the visible star', {
    alignment,
  });
  await page.evaluate(() => {
    const backdrop = document.createElement('div');
    backdrop.dataset.glassComparisonBackdrop = 'true';
    Object.assign(backdrop.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147482999',
      pointerEvents: 'none',
      background:
        'repeating-linear-gradient(90deg, #e43f4f 0 18px, #f1c94a 18px 36px, #3a78e8 36px 54px, #35a85b 54px 72px)',
    });
    document.body.append(backdrop);
  });
  const compositorReducesTransparency = await page.evaluate(
    () => window.__codexBuddyNativeReducedTransparency,
  );
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      document.querySelector('[data-companion-stepwise-root]').setAttribute('data-theme', theme);
    }, theme);
    const samples = [];
    const effects = [];
    for (const material of ['frosted', 'native-glass']) {
      await page.evaluate(
        (material) => window.__companionFloatingPanel.setMaterial(material),
        material,
      );
      await settle();
      const clip = await page.locator('.csw-glass').boundingBox();
      samples.push(await pixels(await page.screenshot({ clip })));
      await page.screenshot({ path: resolve(output, `comparison-${theme}-${material}.png`) });
      const edge = await page.locator('.csw-rim').evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          border: style.borderTopWidth,
          shadow: style.boxShadow,
          pointer: style.pointerEvents,
        };
      });
      assert.equal(edge.border, '0px');
      assert.notEqual(edge.shadow, 'none');
      assert.equal(edge.pointer, 'none');
      effects.push(
        await page.locator('.csw-glass').evaluate((el) => {
          const style = getComputedStyle(el);
          return {
            background: style.background,
            backdropFilter: style.backdropFilter,
          };
        }),
      );
    }
    assert.equal(samples[0].length, samples[1].length);
    const difference =
      samples[0].reduce((sum, value, i) => sum + Math.abs(value - samples[1][i]), 0) /
      samples[0].length;
    if (compositorReducesTransparency) {
      assert.notDeepEqual(effects[0], effects[1]);
      assert.equal((await state()).phase, 'ready');
      record('System-reduced compositor retains distinct Frosted and Liquid effect contracts', {
        theme,
        difference,
      });
    } else {
      assert.ok(
        difference > 3,
        `Frosted and Regular liquid need a visible difference in ${theme}: ${difference}`,
      );
      record('Frosted and Regular liquid differ on the same background', {
        theme,
        difference,
      });
    }
    await star.click();
    await settle();
    assert.equal((await state()).variant, 'clear');
    const clip = await page.locator('.csw-glass').boundingBox();
    const clearPixels = await pixels(await page.screenshot({ clip }));
    const variantDifference =
      clearPixels.reduce((sum, v, i) => sum + Math.abs(v - samples[1][i]), 0) / clearPixels.length;
    const clearEffect = await page.locator('.csw-glass').evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        background: style.background,
        backdropFilter: style.backdropFilter,
      };
    });
    if (compositorReducesTransparency) assert.notDeepEqual(effects[1], clearEffect);
    else
      assert.ok(
        variantDifference > 1,
        `Regular and Clear must visibly differ: ${variantDifference}`,
      );
    await page.screenshot({ path: resolve(output, `comparison-${theme}-clear.png`) });
    await star.click();
    await settle();
    assert.equal((await state()).variant, 'regular');
    assert.equal(await page.locator('[data-csw-optics]').count(), 1);
    record('Regular and Clear differ on the same background while retaining one lens', {
      theme,
      variantDifference,
    });
  }
  await page.locator('[data-glass-comparison-backdrop]').evaluate((element) => element.remove());

  await page.evaluate(() => {
    const root = document.querySelector('[data-companion-stepwise-root]');
    root.setAttribute('data-theme', 'dark');
  });
  await page.screenshot({ path: resolve(output, 'integrated-svg-dark.png') });
  await page.evaluate(() => window.__companionFloatingPanel.setDetached(true));
  assert.equal(await page.locator('[data-csw-optics]').count(), 0);
  assert.equal(await page.locator('[data-glass-comparison]').count(), 0);
  await page.evaluate(() => window.__companionFloatingPanel.setDetached(false));
  await settle();
  assert.equal((await state()).phase, 'ready');
  await page.evaluate(() => window.__companionFloatingPanel.destroy());
  assert.equal(await page.locator('[data-csw-optics]').count(), 0);
  assert.equal(await page.evaluate(() => window.__codexBuddyGlassLab), undefined);
  record('Full panel settings, detach/return and shutdown preserve the SVG lifecycle');
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(resolve(output, 'report.json'), JSON.stringify({ results, errors }, null, 2));
  await browser.close();
  await new Promise((done) => server.close(done));
}
