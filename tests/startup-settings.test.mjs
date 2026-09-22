/*
 * [INPUT]: 实际设置页、合成 SSE/设置 API 与独立 Chromium。
 * [OUTPUT]: 启动策略与完整/限长上下文选项、显式保存与重载恢复验收。
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
  'startup policy and context mode require explicit save and restore after reload',
  { timeout: 30000 },
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
          settings = {
            ...settings,
            ...patch,
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
      assert.equal(saves.length, 0, 'selection must not restart or save implicitly');
      assert.equal(await page.getByText(/可能中断任务或丢失未保存内容/).count(), 1);
      await page.getByRole('button', { name: '保存设置', exact: true }).click();
      await page.getByText('设置已同步到本机', { exact: true }).waitFor();
      assert.equal(saves.length, 1);
      assert.equal(saves[0].hostRestartPolicy, 'force');
      await page.reload();
      await policy.waitFor();
      assert.equal(await policy.inputValue(), 'force');
      await policy.selectOption('ask');
      await page.getByRole('button', { name: '保存设置', exact: true }).click();
      await page.getByText('设置已同步到本机', { exact: true }).waitFor();
      assert.equal(saves.at(-1).hostRestartPolicy, 'ask');
      const context = page.getByLabel('输入上下文', { exact: true });
      assert.equal(await context.inputValue(), 'limited');
      await context.selectOption('latest');
      assert.equal(await page.getByLabel('输入字符上限', { exact: true }).count(), 0);
      await page.getByRole('button', { name: '保存设置', exact: true }).click();
      await page.getByText('设置已同步到本机', { exact: true }).waitFor();
      assert.equal(saves.at(-1).maxInputChars, 0);
      await page.reload();
      await context.waitFor();
      assert.equal(await context.inputValue(), 'latest');
      await context.selectOption('limited');
      await page.getByLabel('输入字符上限', { exact: true }).fill('8000');
      await page.getByRole('button', { name: '保存设置', exact: true }).click();
      await page.getByText('设置已同步到本机', { exact: true }).waitFor();
      assert.equal(saves.at(-1).maxInputChars, 8000);
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
