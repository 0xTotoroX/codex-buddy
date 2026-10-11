/* [INPUT]: CodexHost settings and revision-aware synthetic API.
 * [OUTPUT]: Status rendering, explicit toggles and no implicit installation/start/restart.
 * [POS]: Browser-only migration check; does not touch a live host.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
test('CodexHost settings use their own authenticated endpoint and preserve explicit activation', async () => {
  const out = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{CodexHostSettings}from'./ui/settings/codex-host-settings';createRoot(document.getElementById('root')).render(React.createElement(CodexHostSettings,{live:true,active:true}));`,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [
      {
        name: 'api-fixture',
        setup(b) {
          b.onResolve({ filter: /^\.\/api$/ }, () => ({
            path: 'fixture',
            namespace: 'api-fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'api-fixture' }, () => ({
            contents: `window.commands=[];let state={enabled:false,revision:9,state:'disabled',version:'0.10.2',executable:'/tmp/fixture',baseline:'0.10.2',canRestore:false};export async function request(path,body){if(path!=='codex-host')throw Error('wrong endpoint');window.commands.push({path,body});if(body){if(body.expectedRevision!==state.revision)throw Error('stale');if(body.op==='set-enabled'){state={...state,enabled:body.enabled,state:body.enabled?'pendingEnable':'disabled',revision:state.revision+1}}else throw Error('unexpected side effect')}return state;}`,
          }));
        },
      },
    ],
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: out.outputFiles[0].text });
    const control = page.getByRole('switch', { name: '启用 CodexHost' });
    await control.waitFor();
    await page.getByText('已关闭', { exact: true }).waitFor();
    await control.click();
    await page.getByText('待启动启用', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '启动', exact: true }).count(), 1);
    await control.click();
    await page.getByText('已关闭', { exact: true }).waitFor();
    const writes = await page.evaluate(() => window.commands.filter((x) => x.body));
    assert.deepEqual(
      writes.map((x) => [x.body.op, x.body.expectedRevision, x.body.enabled]),
      [
        ['set-enabled', 9, true],
        ['set-enabled', 10, false],
      ],
    );
  } finally {
    await browser.close();
  }
});
