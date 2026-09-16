/*
 * [INPUT]: e2e.mjs 提供的浏览器、宿主、本机 API 和合成建议。
 * [OUTPUT]: checkPopout 的状态投影、宿主强调色同步、呈现握手、阅读接续、交接反转、受限操作及像素检查。
 * [POS]: 端到端测试的弹出窗口子流程。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export async function checkPopout({
  browser,
  desktop,
  api,
  base,
  runtime,
  dataDir,
  output,
  errors,
  record,
  waitFor,
  delay,
  generate,
  suggestions,
}) {
  await generate();
  await desktop.evaluate(() => window.__companionFloatingPanel.setMaterial('native-glass'));
  const position = await desktop.evaluate(() => ({
    ...window.__companionFloatingPanel.state.position,
  }));
  const preferences = await desktop.evaluate(() =>
    window.__companionFloatingPanel.panelPreferences(),
  );
  const detachIcon = await desktop.locator('[data-action="detach"] svg').innerHTML();
  const originalAccent = await desktop.evaluate(() => {
    const style = document.documentElement.style;
    const old = style.getPropertyValue('--color-token-charts-blue');
    style.setProperty('--color-token-charts-blue', 'rgb(48, 164, 108)');
    return old;
  });
  await desktop.locator('.csw-head-face').dblclick({ delay: 80 });
  await waitFor(
    async () =>
      !(await desktop.evaluate(() => window.__companionFloatingPanel.state.detachPending)),
    'Double-click detach did not finish',
  );
  assert.equal(
    await desktop.evaluate(() => window.__companionFloatingPanel.state.open),
    true,
    'Double click must reverse collapse and leave the panel expanded',
  );
  const opened = await api('panel/open', {});
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  const lease = opened.body.lease;
  assert.ok(lease);
  assert.notEqual(
    await desktop
      .locator('[data-companion-stepwise-root]')
      .evaluate((node) => getComputedStyle(node).visibility),
    'hidden',
  );
  const context = await browser.newContext({
    viewport: { width: preferences.width + 24, height: preferences.height + 24 },
    colorScheme: 'light',
  });
  const pop = await context.newPage();
  pop.on('pageerror', (error) => errors.push(`popout: ${error.message}`));
  const native = [];
  let acknowledgeShow = false;
  const commandResults = [];
  pop.on('response', async (response) => {
    if (response.url().endsWith('/panel/command'))
      commandResults.push(await response.json().catch(() => null));
  });
  await pop.exposeFunction('__testNative', async (message) => {
    native.push(message);
    if (message.kind === 'system-theme') {
      await pop.emulateMedia({ colorScheme: message.dark ? 'dark' : 'light' });
      await pop.evaluate(() => window.__companionPopout.themeResult(null));
    }
    if (message.kind === 'resize') {
      await pop.setViewportSize({ width: 524, height: 504 });
      await pop.waitForFunction(() => window.__companionFloatingPanel.state.height === 480);
      await pop.evaluate(() => window.__companionFloatingPanel.nativeGestureEnded());
    }
    if (message.kind === 'size') {
      await pop.setViewportSize({ width: message.width, height: message.height });
      await pop.evaluate((id) => window.__companionPopout.resized(id), message.id);
    }
    if (message.kind === 'show' && acknowledgeShow) {
      await pop.evaluate(() => window.__companionPopout.presented());
    }
  });
  await pop.addInitScript(() => {
    window.ipc = {
      postMessage: (raw) => {
        void window.__testNative(JSON.parse(raw));
      },
    };
  });
  const state = () =>
    pop.evaluate(() => {
      const p = window.__companionFloatingPanel;
      return (
        p && {
          open: p.state.open,
          count: p.state.prompts.length,
          tab: p.state.activeTab,
          busy: !!p.state.morphAnimation || !!p.state.viewTransitioning,
          material: p.state.material,
          theme: p.state.theme,
        }
      );
    });
  const settle = () =>
    waitFor(async () => (await state()) && !(await state()).busy, 'Popout transition stuck');
  try {
    await pop.goto(`${base}/panel#token=${runtime.token}&lease=${lease}`);
    await waitFor(
      async () => native.some((item) => item.kind === 'show') && (await state())?.count === 4,
      'Popout did not become ready',
    );
    assert.equal(pop.url(), `${base}/panel`);
    const prepared = (await api('panel/state', { lease })).body;
    assert.equal(prepared.ready, true);
    assert.equal(prepared.presented, false);
    assert.notEqual(
      await desktop
        .locator('[data-companion-stepwise-root]')
        .evaluate((node) => getComputedStyle(node).visibility),
      'hidden',
      'ready must not hide the source',
    );
    acknowledgeShow = true;
    await pop.evaluate(() => window.__companionPopout.presented());
    assert.equal((await api('panel/state', { lease })).body.presented, true);
    const home = await api('panel/anchor', { lease });
    assert.equal(home.status, 200);
    assert.ok(
      home.body.anchor?.width >= 300 && home.body.anchor?.height >= 340,
      'Hidden embedded panel must retain a nonzero return anchor',
    );
    assert.ok(Number.isFinite(home.body.anchor.x) && Number.isFinite(home.body.anchor.y));
    await desktop.evaluate(() =>
      Object.defineProperty(document, 'hidden', { configurable: true, value: true }),
    );
    try {
      const occluded = (await api('panel/anchor', { lease })).body.anchor;
      assert.deepEqual(
        occluded,
        home.body.anchor,
        'An occluded host must retain the return coordinates',
      );
    } finally {
      await desktop.evaluate(() => delete document.hidden);
    }
    assert.notEqual((await api('panel/anchor', { lease: 'expired' })).status, 200);
    record('内容就绪保留内嵌，原生呈现确认后才交接');

    const accent = (page) =>
      page
        .locator('[data-companion-stepwise-root]')
        .evaluate((node) => getComputedStyle(node).getPropertyValue('--csw-accent').trim());
    await waitFor(
      async () => (await accent(pop)) === 'rgb(48, 164, 108)',
      'Popout lost the host accent on detach',
    );
    for (const color of ['rgb(172, 73, 201)', 'rgb(48, 164, 108)']) {
      await desktop.evaluate((color) => {
        document.documentElement.style.setProperty('--color-token-charts-blue', color);
      }, color);
      await waitFor(
        async () => (await accent(pop)) === color && (await accent(desktop)) === color,
        'Detached popout did not follow host accent changes',
      );
    }
    await desktop.evaluate((old) => {
      const style = document.documentElement.style;
      if (old) style.setProperty('--color-token-charts-blue', old);
      else style.removeProperty('--color-token-charts-blue');
    }, originalAccent);
    await waitFor(
      async () => (await accent(pop)) === (await accent(desktop)),
      'Removing the host accent left a stale popout color',
    );
    record('弹出继承宿主主题色，隐藏内嵌后仍同步换色和默认色恢复');
    await waitFor(
      async () =>
        (await desktop
          .locator('[data-companion-stepwise-root]')
          .evaluate((node) => getComputedStyle(node).visibility)) === 'hidden',
      'Embedded capsule stayed visible',
    );
    // The host has a global border-box reset; the standalone page deliberately does not.
    // Both must compute the same dimensions from the capsule's scoped baseline.
    await settle();
    const geometry = () => {
      const names = ['.csw-head', '.csw-head-face', '.csw-body', '.csw-icon'];
      return names.map((name) => {
        const element = document.querySelector(name),
          style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          font: style.fontSize,
          padding: style.padding,
          box: style.boxSizing,
        };
      });
    };
    const hostGeometry = await desktop.evaluate(geometry);
    const popGeometry = await pop.evaluate(geometry);
    for (let i = 0; i < hostGeometry.length; i++) {
      assert.ok(
        Math.abs(hostGeometry[i].width - popGeometry[i].width) < 1,
        'host/popout width differs',
      );
      assert.ok(
        Math.abs(hostGeometry[i].height - popGeometry[i].height) < 1,
        'host/popout height differs',
      );
      assert.equal(hostGeometry[i].font, popGeometry[i].font);
      assert.equal(hostGeometry[i].padding, popGeometry[i].padding);
      assert.equal(popGeometry[i].box, 'border-box');
    }
    assert.equal(await pop.locator('.csw-desktop-source').count(), 0);
    record('内嵌与弹出共享盒模型、标题栏、正文区域及控件字体');
    const visibleEmbedded = await desktop
      .locator('[data-companion-stepwise-root]')
      .evaluate((node) =>
        [...node.querySelectorAll('*')]
          .filter(
            (child) =>
              getComputedStyle(child).visibility === 'visible' && child.getClientRects().length,
          )
          .map((child) => child.className),
      );
    await desktop.screenshot({ path: join(output, 'embedded-detached.png') });
    assert.deepEqual(visibleEmbedded, [], 'Detached capsule descendants must not remain visible');
    assert.equal(
      await desktop.locator('[data-companion-stepwise-root]').evaluate((node) => node.inert),
      true,
    );
    // Compare actual pixels: a hidden SVG/backdrop surface can still leave a compositor artifact.
    for (const theme of ['light', 'dark']) {
      await pop.emulateMedia({ colorScheme: theme });
      await desktop.evaluate(
        (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
        theme,
      );
      await waitFor(
        async () => (await state()).theme === theme,
        'Popout system theme did not synchronize',
      );
      for (const material of ['matte', 'frosted', 'native-glass']) {
        await api('panel/preferences', { lease, ui: { ...preferences, material } });
        await waitFor(
          async () =>
            await desktop.evaluate(
              (material) => window.__companionFloatingPanel.state.material === material,
              material,
            ),
          'Detached material did not synchronize',
        );
        const name = `embedded-${theme}-${material}`;
        const detachedImage = await desktop.screenshot({
          path: join(output, `${name}-detached.png`),
        });
        await desktop.locator('[data-companion-stepwise-root]').evaluate((node) => {
          node.style.display = 'none';
        });
        const absentImage = await desktop.screenshot({ path: join(output, `${name}-absent.png`) });
        await desktop.locator('[data-companion-stepwise-root]').evaluate((node) => {
          node.style.removeProperty('display');
        });
        assert.ok(
          detachedImage.equals(absentImage),
          `${name}: detached pixels must match the host with the entire subtree removed`,
        );
      }
    }
    await desktop.evaluate(() => document.documentElement.classList.remove('dark'));
    await pop.emulateMedia({ colorScheme: 'light' });
    await waitFor(async () => (await state()).theme === 'light', 'Theme did not restore');
    await pop.locator('.csw-head').hover();
    const commandCount = commandResults.length;
    await pop.locator('[data-action=theme]').click();
    await waitFor(
      async () => (await state()).theme === 'dark',
      'System toggle did not update panel',
    );
    assert.equal(
      await desktop.evaluate(() => document.documentElement.classList.contains('dark')),
      false,
    );
    assert.equal(
      commandResults.length,
      commandCount,
      'system toggle must not reach the Codex command channel',
    );
    await pop.locator('[data-action=theme]').click();
    await waitFor(async () => (await state()).theme === 'light', 'System toggle did not restore');
    record('弹出明暗走原生 IPC，系统变化更新浮窗且不发送 Codex 主题命令');
    record('三材质 × 明暗模式：弹出后宿主像素与完整移除胶囊完全一致');
    await desktop.evaluate(() => {
      const p = window.__companionFloatingPanel;
      p.state.root.remove();
      p.renderFloat();
    });
    assert.equal(
      await desktop
        .locator('[data-companion-stepwise-root]')
        .evaluate(
          (node) =>
            node.inert &&
            [...node.querySelectorAll('*')].every(
              (child) => getComputedStyle(child).visibility === 'hidden',
            ),
        ),
      true,
    );
    assert.equal(await pop.locator('[data-companion-stepwise-root]').count(), 1);
    assert.equal(await pop.locator('[data-action="pin"]').count(), 1);
    assert.equal((await api('panel/state', { lease: 'obsolete' })).status, 400);
    assert.equal(
      (
        await api('panel/request', {
          lease,
          request: { id: 'test', path: '/stepwise/generate', payload: {} },
        })
      ).status,
      400,
    );
    const headerTop = (await pop.locator('.csw-head').boundingBox()).y;
    await pop.locator('.csw-body').evaluate((body) => {
      body.scrollTop = body.scrollHeight;
    });
    assert.equal((await pop.locator('.csw-head').boundingBox()).y, headerTop);
    const preview = await pop.locator('.csw-prompt-preview').boundingBox();
    assert.ok(preview.y + preview.height <= pop.viewportSize().height);
    await pop.locator('.csw-body').evaluate((body) => {
      body.scrollTop = 0;
    });
    record('弹出窗口就绪后隐藏宿主、独立页面无重复实例、旧窗口凭据拒绝');

    await pop.locator('.csw-row[data-index="0"]').click();
    const composer = desktop.getByRole('textbox', { name: '测试草稿' });
    await waitFor(
      async () => (await composer.textContent()) === suggestions[0].prompt,
      'Popout did not fill host',
    );
    const submissions = await desktop.evaluate(() => window.submitCount);
    await composer.fill('已有草稿');
    await pop.locator('.csw-row[data-index="1"]').click();
    await pop.locator('dialog').waitFor();
    await pop.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await composer.textContent(), '已有草稿');
    await pop.locator('.csw-row[data-index="1"]').click();
    await pop.getByRole('button', { name: '保留并追加', exact: true }).click();
    await waitFor(
      async () => (await composer.textContent()).includes(suggestions[1].prompt),
      'Popout append failed',
    );
    assert.ok((await composer.textContent()).startsWith('已有草稿'));
    assert.equal(await desktop.evaluate(() => window.submitCount), submissions);
    await composer.fill('确认前的草稿');
    await pop.locator('.csw-row[data-index="2"]').click();
    await pop.locator('dialog').waitFor();
    await composer.fill('确认期间修改了草稿');
    await pop.getByRole('button', { name: '保留并追加', exact: true }).click();
    await delay(250);
    assert.equal(await composer.textContent(), '确认期间修改了草稿');
    await composer.fill('');
    record('独立浮窗填入、取消／确认追加、追加前再次修改草稿均保持保护');

    await pop.locator('.csw-head').hover();
    await pop.locator('button[data-view="outline"]').click();
    await settle();
    const beforeWeb = (await api('appearance')).body;
    const webUi = {
      ...beforeWeb.ui,
      material: 'matte',
      liquidVariant: 'clear',
      fontOffset: 3,
      labelOnly: true,
      promptClickMode: 'hybrid',
      viewOrder: ['outline', 'next'],
    };
    const savedWeb = await api('appearance', {
      expectedRevision: beforeWeb.revision,
      ui: webUi,
      alwaysOnTop: true,
    });
    assert.equal(savedWeb.status, 200, JSON.stringify(savedWeb.body));
    await waitFor(
      async () =>
        await pop.evaluate(() => {
          const ui = window.__companionFloatingPanel.panelPreferences();
          return (
            ui.material === 'matte' &&
            ui.liquidVariant === 'clear' &&
            ui.fontOffset === 3 &&
            ui.labelOnly &&
            ui.promptClickMode === 'hybrid' &&
            ui.viewOrder[0] === 'outline'
          );
        }),
      'Web appearance did not reach detached capsule',
    );
    await waitFor(
      async () => native.some((m) => m.kind === 'pin' && m.value === true),
      'Web pin did not reach native window',
    );
    await pop.evaluate(() => {
      window.__companionFloatingPanel.setMaterial('frosted');
    });
    await waitFor(async () => {
      const ui = (await api('appearance')).body.ui;
      return ui.material === 'frosted' && ui.liquidVariant === 'clear' && !('glassStyle' in ui);
    }, 'Detached preferences did not reach Web API');
    const currentWeb = (await api('appearance')).body;
    await api('appearance', {
      expectedRevision: currentWeb.revision,
      ui: beforeWeb.ui,
      alwaysOnTop: beforeWeb.alwaysOnTop,
    });
    await waitFor(
      async () => (await state()).material === beforeWeb.ui.material,
      'Restore detached appearance failed',
    );
    record('Web 与桌面胶囊的全量偏好同步，置顶传入原生窗口');

    await pop.locator('.csw-outline-row').nth(1).click();
    await waitFor(
      async () => (await desktop.locator('.companion-stepwise-outline-target-flash').count()) > 0,
      'Popout outline did not navigate host',
    );
    await pop.locator('.csw-head').hover();
    await pop.locator('button[data-view="next"]').click();
    await settle();
    const stale = await desktop.evaluate(() => window.__companionFloatingPanel.exportPanelState());
    await desktop.evaluate(() => {
      document
        .querySelector('#answer')
        .append(
          Object.assign(document.createElement('p'), { textContent: '新回答使旧操作失效。' }),
        );
    });
    const rejected = await api('panel/command', {
      lease,
      command: {
        kind: 'fill',
        index: 0,
        instanceId: stale.instanceId,
        context: stale.context,
        viewToken: stale.viewToken,
      },
    });
    assert.equal(rejected.body.ok, false);
    assert.equal(await composer.textContent(), '');
    await waitFor(async () => (await state()).count === 0, 'Old suggestions remained in popout');
    await delay(1600);
    await pop.locator('[data-action="refresh"]').click();
    await waitFor(async () => (await state()).count === 4, 'Generation from popout failed');
    record('大纲回到关联宿主定位，回答变化拒绝旧操作并从桌面窗口重新生成');

    await pop.locator('[data-action="pin"]').click();
    await waitFor(
      () => JSON.parse(readFileSync(join(dataDir, 'panel.json'))).alwaysOnTop,
      'Pin setting not saved',
    );
    await pop.locator('.csw-head').hover();
    await pop.locator('button[data-view="settings"]').click();
    await settle();
    assert.equal(pop.viewportSize().height, preferences.height + 24);
    for (const corner of ['bl', 'br']) {
      await pop
        .locator(`.csw-resize-handle[data-corner=${corner}]`)
        .dispatchEvent('pointerdown', { button: 0 });
      await waitFor(() => pop.viewportSize().width === 524, 'Native resize command not received');
      await waitFor(
        async () =>
          (await pop.evaluate(() => window.__companionFloatingPanel.panelPreferences())).height ===
          480,
        'Settings resize ignored',
      );
      const saved = () => JSON.parse(readFileSync(join(dataDir, 'panel.json'))).ui;
      await waitFor(
        () => saved().width === 500 && saved().height === 480,
        'Resized settings dimensions not saved',
      );
      await pop.setViewportSize({ width: preferences.width + 24, height: preferences.height + 24 });
      await waitFor(() => saved().height === preferences.height, 'Resize did not restore');
    }
    record('弹出设置页左右下角可缩放，尺寸同步布局并持久保存');
    await pop.evaluate(() => {
      document.documentElement.dataset.nativeBackdrop = 'true';
      window.__companionNativeGlass = true;
      window.__companionFloatingPanel.setMaterial('matte');
    });
    // Exercise a transition longer than the former fixed 280 ms sampling delay.
    // Slow/background CI frames must settle before comparing final material styles.
    const slowSurfaceTransition = await pop.addStyleTag({
      content: '.csw-glass { transition-duration: 600ms !important; }',
    });
    const surfaces = [];
    assert.equal(
      await pop.locator('[data-action="detach"]').getAttribute('aria-label'),
      '收回 Codex',
    );
    assert.notEqual(await pop.locator('[data-action="detach"] svg').innerHTML(), detachIcon);
    for (const material of ['matte', 'frosted', 'native-glass']) {
      await waitFor(
        async () => (await state()).material === material,
        'Material button did not cycle',
      );
      await waitFor(
        () =>
          pop.locator('.csw-glass').evaluate((node) => {
            // Flush style so pending CSS transitions are included in getAnimations().
            getComputedStyle(node).backgroundColor;
            return node
              .getAnimations()
              .every((animation) => ['finished', 'idle'].includes(animation.playState));
          }),
        `Surface transition did not settle for ${material}`,
      );
      surfaces.push(
        await pop.locator('.csw-glass').evaluate((node) => {
          const s = getComputedStyle(node);
          return [s.backgroundColor, s.backgroundImage, s.boxShadow].join('|');
        }),
      );
      assert.equal(await pop.locator('.csw-displacement-texture, .csw-clear-texture').count(), 0);
      {
        const decoration = await pop.locator('.csw-glass').evaluate((el) => {
          const rim = el.parentElement.querySelector('.csw-rim');
          const effect = getComputedStyle(el, '::before');
          const edge = getComputedStyle(rim);
          return {
            overlay: effect.display,
            shadow: edge.boxShadow,
            radius: parseFloat(edge.borderTopLeftRadius),
            glassRadius: parseFloat(getComputedStyle(el).borderTopLeftRadius),
          };
        });
        if (material !== 'matte') assert.equal(decoration.overlay, 'none');
        if (material !== 'native-glass') {
          assert.equal(decoration.radius, decoration.glassRadius);
          assert.ok(decoration.radius > 0);
          assert.match(decoration.shadow, /0px 2px 6px/);
        } else assert.equal(decoration.shadow, 'none');
      }
      if (material === 'native-glass') {
        const contained = await pop.locator('[data-action=liquid-variant]').evaluate((el) => {
          const star = el.getBoundingClientRect(),
            row = el.parentElement.getBoundingClientRect();
          return (
            star.left >= row.left &&
            star.right < row.right &&
            star.top >= row.top &&
            star.bottom <= row.bottom &&
            getComputedStyle(el.parentElement).borderTopWidth !== '0px'
          );
        });
        assert.ok(contained, 'Clear star must sit inside the shared material control border');
      }
      await pop.screenshot({ path: join(output, `popout-${material}.png`) });
      if (material !== 'native-glass') await pop.locator('[data-action="material"]').click();
    }
    await slowSurfaceTransition.evaluate((node) => node.remove());
    assert.notEqual(surfaces[0], surfaces[1], 'Matte must retain its opaque CSS surface');
    assert.equal(
      surfaces[1],
      surfaces[2],
      'Both native materials share a transparent CSS foreground after transitions finish',
    );
    assert.equal(await pop.locator('[data-action="glass-style"]').count(), 0);
    const savedMaterial = (await api('appearance')).body.ui;
    assert.ok(!('glassStyle' in savedMaterial));
    record('三材质单入口；传统磨砂与液态共用透明前景，液态通过独立星星切换 Regular/Clear');
    for (const material of ['frosted', 'native-glass']) {
      await pop.evaluate((material) => {
        window.__companionNativeGlass = false;
        window.__companionFloatingPanel.setMaterial(material);
      }, material);
      assert.equal(
        await pop.locator('.csw-popover').getAttribute('data-effective-material'),
        material === 'frosted' ? 'native-frosted' : 'matte',
      );
      assert.equal(
        await pop.locator('[data-material-value]').textContent(),
        material === 'frosted' ? '磨砂' : '液态（当前哑光）',
      );
    }
    await pop.evaluate(() => {
      window.__companionNativeGlass = true;
      window.__companionFloatingPanel.setMaterial('native-glass');
    });

    // Isolate the CSS surface from AppKit: neutral content underneath must not gain a blue cast.
    await pop.evaluate(() => {
      document.body.style.background = '#808080';
    });
    for (const theme of ['light', 'dark']) {
      await pop.emulateMedia({ colorScheme: theme });
      await desktop.evaluate(
        (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
        theme,
      );
      await waitFor(
        async () => (await state()).theme === theme,
        'Surface theme did not synchronize',
      );
      for (const material of ['native-glass']) {
        await pop.evaluate(
          (material) => window.__companionFloatingPanel.setMaterial(material),
          material,
        );
        await delay(300);
        const shot = await pop.screenshot({
          path: join(output, `surface-${theme}-${material}-gray.png`),
        });
        const tint = await pop.evaluate(async (base64) => {
          const img = new Image();
          img.src = `data:image/png;base64,${base64}`;
          await img.decode();
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const { data } = ctx.getImageData(0, 0, img.width, img.height);
          let spread = 0,
            count = 0;
          for (let y = Math.floor(img.height * 0.65); y < img.height * 0.85; y += 2) {
            for (let x = Math.floor(img.width * 0.25); x < img.width * 0.75; x += 2) {
              const i = (y * img.width + x) * 4;
              spread +=
                Math.max(data[i], data[i + 1], data[i + 2]) -
                Math.min(data[i], data[i + 1], data[i + 2]);
              count++;
            }
          }
          return spread / count;
        }, shot.toString('base64'));
        assert.ok(
          tint <= 1,
          `${theme} ${material}: CSS adds a color cast to neutral gray (${tint.toFixed(2)} channel levels)`,
        );
      }
    }
    await pop.evaluate(() => {
      document.body.style.background = '';
      window.__companionFloatingPanel.setMaterial('matte');
    });
    await desktop.evaluate(() => document.documentElement.classList.remove('dark'));
    record('原生液态透明前景 × 明暗模式：中性灰背景没有被网页前景额外染色');
    await pop.locator('.csw-head').hover();
    await pop.locator('button[data-view="next"]').click();
    await settle();
    assert.equal(pop.viewportSize().height, preferences.height + 24);
    const expandedViewport = pop.viewportSize();
    assert.equal(await pop.locator('[data-action=collapse]').count(), 0);
    await pop.locator('.csw-head-face').click();
    await pop.keyboard.press('Escape');
    await pop.evaluate(() => window.__companionFloatingPanel.setOpen(false));
    await settle();
    assert.equal(await pop.evaluate(() => window.__companionFloatingPanel.state.open), true);
    assert.deepEqual(pop.viewportSize(), expandedViewport);
    const appearance = (await api('appearance')).body;
    const currentUi = await pop.evaluate(() => window.__companionFloatingPanel.panelPreferences());
    await api('appearance', {
      expectedRevision: appearance.revision,
      ui: { ...currentUi, open: false },
    });
    await settle();
    assert.equal(
      (await api('appearance')).body.ui.open,
      true,
      'detached preferences cannot collapse the window',
    );
    await pop.locator('.csw-row').first().waitFor();
    record('弹出固定展开：点眼睛、Esc、旧接口和偏好更新均不收起，仍可调整窗口尺寸');
    // 强制一次初始投影用于复现同内容阅读接续；后续常规投影不得覆盖用户位置。
    const source = (await api('panel/state', { lease })).body;
    source.snapshot.readingState = {
      ...source.snapshot.readingState,
      activeTab: 'next',
      promptPreviewIndex: 2,
      scrollTop: 0,
      promptScrollTop: 0,
    };
    source.snapshot.readingState.contentToken = await pop.evaluate(
      () => window.__companionFloatingPanel.panelReadingState().contentToken,
    );
    source.preferences.ui.activeTab = 'next';
    await pop.evaluate(
      (value) => window.__companionFloatingPanel.receivePanelState(value, true),
      source,
    );
    assert.equal(
      await pop.evaluate(() => window.__companionFloatingPanel.state.promptPreviewIndex),
      2,
      JSON.stringify(
        await pop.evaluate(() => window.__companionFloatingPanel.panelReadingState()),
      ) +
        ' expected ' +
        JSON.stringify(source.snapshot.readingState),
    );
    await pop.locator('.csw-row').first().hover();
    await pop.waitForFunction(() => window.__companionFloatingPanel.state.promptPreviewIndex === 0);
    await pop.locator('.csw-body').evaluate((body) => {
      body.scrollTop = Math.min(40, body.scrollHeight - body.clientHeight);
    });
    const reading = await pop.evaluate(() => window.__companionFloatingPanel.panelReadingState());
    source.snapshot.accentColor = 'rgb(48, 164, 108)';
    await pop.evaluate(
      (value) => window.__companionFloatingPanel.receivePanelState(value, false),
      source,
    );
    assert.deepEqual(
      await pop.evaluate(() => window.__companionFloatingPanel.panelReadingState()),
      reading,
    );
    const staleReading = structuredClone(source);
    staleReading.snapshot.readingState.contentToken = 'stale-content';
    await pop.evaluate(
      (value) => window.__companionFloatingPanel.receivePanelState(value, true),
      staleReading,
    );
    assert.equal(
      await pop.evaluate(() => window.__companionFloatingPanel.state.promptPreviewIndex),
      0,
    );
    record('阅读接续保留预览条目与滚动位置，常规投影和过期内容不会覆盖当前阅读');

    await pop.locator('.csw-row').nth(2).hover();
    await pop.waitForFunction(() => window.__companionFloatingPanel.state.promptPreviewIndex === 2);
    const dockReading = await pop.evaluate(() =>
      window.__companionFloatingPanel.panelReadingState(),
    );
    await pop.locator('.csw-head').hover();
    await pop.locator('.csw-head-face').dblclick({ delay: 80 });
    await waitFor(
      async () =>
        (await desktop
          .locator('[data-companion-stepwise-root]')
          .evaluate((node) => getComputedStyle(node).visibility)) !== 'hidden',
      'Dock did not restore embedded UI',
    );
    await waitFor(
      async () => native.some((item) => item.kind === 'close'),
      'Dock did not finish handoff',
    );
    assert.equal(
      await desktop.locator('[data-companion-stepwise-root]').evaluate((node) => node.inert),
      false,
    );
    assert.equal(
      await desktop.evaluate(() => window.__companionFloatingPanel.state.open),
      true,
      'Double-click dock must restore an expanded panel',
    );
    record('表情双击弹出与收回复用交接流程，100ms 内第二击取消收放，复用窗口交接');
    const restoredReading = await desktop.evaluate(() =>
      window.__companionFloatingPanel.panelReadingState(),
    );
    for (const key of ['viewToken', 'contentToken', 'activeTab', 'promptPreviewIndex'])
      assert.equal(restoredReading[key], dockReading[key], `dock restores ${key}`);
    assert.deepEqual(
      await desktop.evaluate(() => window.__companionFloatingPanel.state.position),
      position,
    );
    assert.equal(
      await desktop.evaluate(() => window.__companionFloatingPanel.state.material),
      'matte',
    );
    assert.equal(JSON.parse(readFileSync(join(dataDir, 'panel.json'))).detached, false);
    assert.equal((await api('panel/state', { lease })).status, 400);
    record('收回恢复原位置并同步偏好，关闭后的窗口不能继续操作');
    const handoff = await desktop.evaluate(async () => {
      const panel = window.__companionFloatingPanel;
      for (let i = 0; i < 3; i++) {
        const hiding = panel.setDetached(true);
        if (i === 1) await new Promise((resolve) => setTimeout(resolve, 40));
        const showing = panel.setDetached(false);
        await Promise.all([hiding, showing]);
      }
      const root = panel.state.root;
      return {
        opacity: getComputedStyle(root).opacity,
        inert: root.inert,
        detached: root.dataset.detached,
        animations: root.getAnimations().length,
      };
    });
    assert.deepEqual(handoff, { opacity: '1', inert: false, detached: 'false', animations: 0 });
    await desktop.emulateMedia({ reducedMotion: 'reduce' });
    await desktop.evaluate(async () => {
      const p = window.__companionFloatingPanel;
      await p.setDetached(true);
      await p.setDetached(false);
    });
    assert.equal(
      await desktop
        .locator('[data-companion-stepwise-root]')
        .evaluate((node) => node.getAnimations().length),
      0,
    );
    await desktop.emulateMedia({ reducedMotion: 'no-preference' });
    record('快速反转与减少动态效果均恢复可操作面板，无透明动画残留');

    // 胶囊出发时首击可能已在 100ms 后展开；双击仍须记住首击前的形态。
    await desktop.evaluate(() => window.__companionFloatingPanel.setOpen(false));
    await settle();
    await desktop.locator('.csw-fab').dblclick({ delay: 180 });
    await waitFor(
      async () =>
        !(await desktop.evaluate(() => window.__companionFloatingPanel.state.detachPending)),
      'chip detach pending',
    );
    const chipLease = (await api('panel/open', {})).body.lease;
    assert.equal((await api('appearance')).body.returnOpen, false);
    await pop.goto('about:blank');
    await pop.goto(`${base}/panel#token=${runtime.token}&lease=${chipLease}`);
    await waitFor(
      async () => (await api('panel/state', { lease: chipLease })).body.presented,
      'chip popout not presented',
    );
    assert.equal(await pop.evaluate(() => window.__companionFloatingPanel.state.open), true);
    const chipAnchor = (await api('panel/anchor', { lease: chipLease })).body.anchor;
    assert.ok(chipAnchor.width >= 40 && chipAnchor.height >= 20 && chipAnchor.height < 100);
    await pop.locator('.csw-head-face').dblclick({ delay: 80 });
    await waitFor(
      async () => !(await desktop.evaluate(() => window.__companionFloatingPanel.state.detached)),
      'chip dock not restored',
    );
    assert.equal(await desktop.evaluate(() => window.__companionFloatingPanel.state.open), false);
    assert.equal(JSON.parse(readFileSync(join(dataDir, 'panel.json'))).ui.open, false);
    record('胶囊态双击直接弹出：180ms 慢双击保存首击前状态，收回恢复胶囊且动画锚点为胶囊区域');

    const recoveryLease = (await api('panel/open', {})).body.lease;
    await pop.goto('about:blank');
    await pop.goto(`${base}/panel#token=${runtime.token}&lease=${recoveryLease}`);
    await waitFor(
      async () =>
        (await desktop
          .locator('[data-companion-stepwise-root]')
          .evaluate((node) => getComputedStyle(node).visibility)) === 'hidden',
      'Recovery window did not complete presentation',
    );
    await pop.close();
    await waitFor(
      async () =>
        (await desktop
          .locator('[data-companion-stepwise-root]')
          .evaluate((node) => getComputedStyle(node).visibility)) !== 'hidden',
      'Expired window did not restore host',
      16000,
    );
    assert.equal((await api('panel/state', { lease: recoveryLease })).status, 400);
    assert.equal(JSON.parse(readFileSync(join(dataDir, 'panel.json'))).detached, true);
    const reopened = (await api('panel/open', {})).body.lease;
    assert.notEqual(reopened, recoveryLease);
    assert.equal((await api('panel/dock', { lease: reopened })).status, 200);
    record('窗口心跳消失恢复宿主、保留启动模式、再次打开使用新凭据');
  } catch (error) {
    await pop.screenshot({ path: join(output, 'popout-failure.png') }).catch(() => {});
    console.error('POPOUT_STATE', await state().catch(() => null));
    console.error('POPOUT_COMMANDS', JSON.stringify(commandResults));
    throw error;
  } finally {
    await context.close();
  }
}
