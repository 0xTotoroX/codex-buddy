/*
 * [INPUT]: 实际设置页、合成 SSE/设置 API 与独立 Chromium。
 * [OUTPUT]: 启动策略与完整/限长上下文选项、自动/手动保存、在途编辑、冲突保护、快捷词与重载恢复验收。
 * [POS]: 设置页行为测试，不接触真实宿主或重启应用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fixtureSettings } from './fixtures.mjs';

test(
  'settings autosave on selection and blur, serialize edits, preserve errors and support manual save',
  { timeout: 60000 },
  async () => {
    const bundle = await build({
      entryPoints: ['ui/settings/main.tsx'],
      bundle: true,
      write: false,
      format: 'iife',
      outfile: 'app.js',
      jsx: 'automatic',
      loader: { '.css': 'empty', '.png': 'dataurl' },
      define: { 'import.meta.env.DEV': 'false' },
    });
    let settings = { ...fixtureSettings };
    const saves = [];
    let hold = false;
    let rejectNext = false;
    const pending = [];
    let inFlight = 0;
    let maxInFlight = 0;
    async function until(check) {
      const deadline = Date.now() + 5000;
      while (!check()) {
        if (Date.now() > deadline) throw Error('settings condition timed out');
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    const server = createServer(async (req, res) => {
      if (req.url === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({
            version: 'fixture',
            configurationRevision: settings.configurationRevision,
            connection: { status: 'disconnected', targets: [], message: 'fixture' },
            desktop: { hasAnswer: false, headings: 0 },
            model: { label: 'fixture' },
          })}\n\n`,
        );
      } else if (req.url === '/api/settings') {
        if (req.method === 'POST') {
          let body = '';
          for await (const chunk of req) body += chunk;
          const patch = JSON.parse(body);
          saves.push(patch);
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          if (hold) await new Promise((resolve) => pending.push(resolve));
          inFlight--;
          if (rejectNext || patch.expectedRevision !== settings.configurationRevision) {
            rejectNext = false;
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                message:
                  patch.expectedRevision !== settings.configurationRevision
                    ? '设置已在其他窗口更新，请重新载入后再保存'
                    : '合成保存失败，请重试',
              }),
            );
            return;
          }
          settings = {
            ...settings,
            ...patch,
            jev:
              patch.jevConsent === undefined
                ? patch.jev || settings.jev
                : { ...settings.jev, consent: patch.jevConsent },
            configurationRevision: settings.configurationRevision + 1,
          };
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(settings));
      } else if (req.url === '/app.js') {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(bundle.outputFiles[0].text);
      } else {
        res.setHeader('Content-Type', 'text/html');
        res.end('<div id="root"></div><script src="/app.js"></script>');
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    let browser;
    try {
      browser = await chromium.launch({
        executablePath:
          process.env.CODEX_BUDDY_CHROME_BIN || (existsSync(chrome) ? chrome : undefined),
      });
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/#token=fixture`);
      const policy = page.getByLabel('ChatGPT 已打开，但没有调试连接时');
      await policy.waitFor();
      assert.equal(await policy.inputValue(), 'ask');
      await policy.selectOption('force');
      await page.getByText('设置已同步到本机', { exact: true }).waitFor();
      await until(() => saves.length === 1);
      assert.equal(saves[0].hostRestartPolicy, 'force');
      await page.reload();
      await policy.waitFor();
      assert.equal(await policy.inputValue(), 'force');
      const context = page.getByLabel('输入上下文', { exact: true });
      await context.selectOption('latest');
      await until(() => settings.maxInputChars === 0);
      assert.equal(await page.getByLabel('输入字符上限', { exact: true }).count(), 0);
      await page.reload();
      await context.waitFor();
      assert.equal(await context.inputValue(), 'latest');
      await context.selectOption('limited');
      await until(() => settings.maxInputChars === 12000);
      const input = page.getByLabel('输入字符上限', { exact: true });
      await input.fill('8000');
      // Typed input stays local until blur or the explicit save button.
      assert.equal(settings.maxInputChars, 12000);
      await page.getByRole('heading', { name: '生成设置', exact: true }).click();
      await until(() => settings.maxInputChars === 8000);
      await page.getByText('设置已同步到本机', { exact: true }).waitFor();
      hold = true;
      await input.fill('9000');
      await page.getByRole('heading', { name: '生成设置', exact: true }).click();
      await until(() => pending.length === 1);
      await input.fill('10000');
      pending.shift()();
      await until(() => settings.maxInputChars === 9000);
      assert.equal(await input.inputValue(), '10000', 'slow save must not erase newer typing');
      assert.equal(pending.length, 0, 'typing alone must not be saved');
      await page.getByRole('heading', { name: '生成设置', exact: true }).click();
      await until(() => pending.length === 1);
      hold = false;
      pending.shift()();
      await until(() => settings.maxInputChars === 10000);
      await page.getByText('设置已同步到本机', { exact: true }).waitFor();
      assert.equal(maxInFlight, 1);
      rejectNext = true;
      await input.fill('11000');
      await page.getByRole('heading', { name: '生成设置', exact: true }).click();
      await page.getByText('合成保存失败，请重试', { exact: true }).waitFor();
      assert.equal(await input.inputValue(), '11000');
      assert.equal(settings.maxInputChars, 10000);
      await page.getByRole('button', { name: '保存设置', exact: true }).click();
      await until(() => settings.maxInputChars === 11000);
      await page.getByText('设置已同步到本机', { exact: true }).waitFor();
      hold = true;
      await input.fill('12000');
      await page.getByRole('heading', { name: '生成设置', exact: true }).click();
      await until(() => pending.length === 1);
      await input.fill('13000');
      await page.getByRole('heading', { name: '生成设置', exact: true }).click();
      // Allow the second blur debounce to join the active save queue.
      await page.waitForTimeout(300);
      assert.equal(pending.length, 1);
      pending.shift()();
      await until(() => settings.maxInputChars === 12000 && pending.length === 1);
      hold = false;
      pending.shift()();
      await until(() => settings.maxInputChars === 13000);
      await page.getByText('设置已同步到本机', { exact: true }).waitFor();
      assert.equal(maxInFlight, 1, 'queued saves must use the new revision serially');
      settings = { ...settings, configurationRevision: settings.configurationRevision + 1 };
      await input.fill('14000');
      await page.getByRole('heading', { name: '生成设置', exact: true }).click();
      await page.getByText('设置已在其他窗口更新，请重新载入后再保存', { exact: true }).waitFor();
      assert.equal(await input.inputValue(), '14000');
      assert.equal(settings.maxInputChars, 13000);
      assert.equal(
        await page.getByRole('button', { name: '保存设置', exact: true }).isDisabled(),
        true,
      );
      await page.reload();
      await input.waitFor();
      assert.equal(await input.inputValue(), '13000');
      const quick = page.getByLabel('常用提示词 1 内容', { exact: true });
      await quick.fill('请继续推进整体目标');
      await page.getByRole('heading', { name: '常用提示词', exact: true }).click();
      await until(() => settings.quickPrompts[0].prompt === '请继续推进整体目标');
      await page.getByText('设置已同步到本机', { exact: true }).waitFor();
      await page.reload();
      await quick.waitFor();
      assert.equal(await quick.inputValue(), '请继续推进整体目标');
      const source = page.getByLabel('方向来源', { exact: true });
      await source.selectOption('manual');
      await until(() => settings.directionSource === 'manual');
      assert.equal(await page.getByLabel('最多建议数量', { exact: true }).count(), 0);
      await page.getByLabel('添加方向位置', { exact: true }).selectOption('gaps');
      await page.getByRole('button', { name: '加入', exact: true }).click();
      await until(() => settings.selectedDirections.length === 1);
      await page.getByLabel('添加方向位置', { exact: true }).selectOption('advance');
      await page.getByRole('button', { name: '加入', exact: true }).click();
      await until(() => settings.selectedDirections.length === 2);
      await page.getByRole('button', { name: '上移方向 2', exact: true }).click();
      await until(() => settings.selectedDirections[0] === 'advance');
      await page.getByText('编辑方向库', { exact: true }).click();
      await page.getByRole('button', { name: '添加自定义方向', exact: true }).click();
      await page.getByLabel('方向名称 4', { exact: true }).fill('长期维护');
      await page.getByLabel('倾向说明 4', { exact: true }).fill('关注维护成本与依赖负担');
      await page.getByRole('heading', { name: '建议方向', exact: true }).click();
      await until(() => settings.directionLibrary.length === 4);
      await page.getByText('设置已同步到本机', { exact: true }).waitFor();
      await page.reload();
      await source.waitFor();
      assert.equal(await source.inputValue(), 'manual');
      assert.equal(await page.getByLabel('方向位置 1', { exact: true }).inputValue(), 'advance');
      await source.selectOption('smart');
      await until(() => settings.directionSource === 'smart');
      await page.getByLabel('启用方向 检查遗漏', { exact: true }).uncheck();
      await until(() => !settings.directionLibrary.find((d) => d.id === 'gaps').enabled);
      await page.getByLabel('我同意将最近一问一答', { exact: false }).check();
      await until(() => settings.jev.consent);
      hold = true;
      await page.getByLabel('Jev 模型', { exact: true }).fill('jev-fixture');
      await page.getByRole('heading', { name: '建议方向', exact: true }).click();
      await until(() => pending.length === 1);
      await page.getByRole('button', { name: '添加自定义方向', exact: true }).click();
      await page.getByLabel('我同意将最近一问一答', { exact: false }).uncheck();
      rejectNext = true;
      hold = false;
      pending.shift()();
      await until(() => !settings.jev.consent);
      assert.equal(settings.directionLibrary.length, 4);
      assert.equal(await page.getByLabel('方向名称 5', { exact: true }).inputValue(), '');
      await page.getByRole('button', { name: '删除方向', exact: true }).click();
      await page.getByLabel('我同意将最近一问一答', { exact: false }).check();
      await until(() => settings.jev.consent);
      await page.getByText('设置已同步到本机', { exact: true }).waitFor();
      hold = true;
      await page.getByLabel('Jev 模型', { exact: true }).fill('jev-second');
      await page.getByRole('heading', { name: '建议方向', exact: true }).click();
      await until(() => pending.length === 1);
      await page.getByLabel('我同意将最近一问一答', { exact: false }).uncheck();
      await page.getByLabel('我同意将最近一问一答', { exact: false }).check();
      await source.selectOption('auto');
      await source.selectOption('smart');
      await page.waitForTimeout(300); // latest full snapshot joins the existing queue
      hold = false;
      pending.shift()();
      await page.getByText('设置已同步到本机', { exact: true }).waitFor();
      await until(
        () =>
          inFlight === 0 &&
          settings.jev.model === 'jev-second' &&
          settings.directionSource === 'smart' &&
          settings.jev.consent,
      );
      assert.equal(await source.inputValue(), 'smart');
      assert.equal(
        await page.getByLabel('我同意将最近一问一答', { exact: false }).isChecked(),
        true,
      );
      await page
        .getByLabel('Jev 请求地址', { exact: true })
        .fill('https://example.test/v1/systemone');
      await page.getByLabel('Jev 模型', { exact: true }).click();
      await until(() => !settings.jev.consent);
      await page.getByLabel('Jev API 密钥', { exact: true }).fill('fixture-judge-secret');
      await page.getByRole('heading', { name: '建议方向', exact: true }).click();
      await until(() => saves.at(-1).jevApiKey === 'fixture-judge-secret');
      await page.getByText('设置已同步到本机', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('Jev API 密钥', { exact: true }).inputValue(), '');
      await page.getByRole('button', { name: '添加自定义方向', exact: true }).click();
      await source.selectOption('auto');
      await until(() => settings.directionSource === 'auto');
      assert.equal(await page.getByLabel('Jev 请求地址', { exact: true }).count(), 0);
      assert.equal(await page.getByLabel('最多建议数量', { exact: true }).count(), 1);
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
