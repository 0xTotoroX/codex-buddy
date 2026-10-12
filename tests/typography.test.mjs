/* [INPUT]: 实际宿主字体采样器、共用术语卡/工作台与设置页字体同步。
 * [OUTPUT]: 三种来源、切换保留、比例/自定义和各表面实际排版一致性验证。
 * [POS]: 合成浏览器回归，不读取真实聊天，不截图。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const bundle = (
  await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {createTypographyTracker} from './ui/codex/typography.js';
import {typographyStyle, resolveTypography, defaultTypography, layoutZoom} from './ui/shared/typography';
import {createCard,cardStyles} from './ui/terminology/card.js';
import {FeatureView} from './ui/surfaces/workspace/feature-session';
import {useTypography} from './ui/settings/use-typography';
window.tracker=createTypographyTracker(()=>document.querySelector('main'),()=>document.querySelector('[contenteditable]'));
window.apply=()=>{const raw=window.tracker.snapshot(), prefs=window.tracker.preferences();
window.testCard?.remove();const style=document.createElement('style');style.textContent=cardStyles;document.head.append(style);
window.testCard=createCard({id:'test',name:'接口',english:'API',definition:'测试释义。',category:['程序基础','通信']},{appearance:{typography:resolveTypography(raw,prefs)}});document.querySelector('#card').append(window.testCard);
window.mount ||= createRoot(document.querySelector('#feature'));const appearance={typography:raw,typographyPreferences:prefs};
window.mount.render(<FeatureView entry={{id:'terms',owner:'one',open:true,pending:null,view:{},size:[400,500],reveal:0,placement:'sidebar'}} owner="one" request={async()=>({appearance,entries:[],preferences:{favorites:[],mastered:[]},involved:[]})} onState={()=>{}}/>);
return {raw,prefs};};
function Settings({raw,prefs}){useTypography(raw,prefs);return <div id="settings-text" style={{fontSize:'1rem'}}>设置文字</div>}
window.settings=(raw,prefs)=>{window.settingsRoot ||= createRoot(document.querySelector('#settings'));window.settingsRoot.render(<Settings raw={raw} prefs={prefs}/>)};
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
  })
).outputFiles[0].text;
const html = `<aside class="app-shell-left-panel"><span data-marquee-text><span data-marquee-content style="font:14px/22px monospace">会话标题</span></span></aside><main style="zoom:1.3"><div data-content-search-turn-key="one"><p style="font:18px/27px serif">聊天正文</p></div><div contenteditable style="font:20px/30px sans-serif">输入</div></main><div id="feature" style="zoom:1.3"></div><div id="card"></div><div id="settings"></div>`;
test('stable source samples retain font across hidden/new chats and respect explicit preferences', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    await page.addScriptTag({ content: bundle });
    const read = () => page.evaluate(() => window.tracker.resolved());
    await read();
    await page.waitForTimeout(220);
    let t = await read();
    assert.equal(t.fontSize, 18);
    assert.equal(t.zoom, 1.3);
    await page.evaluate(() => (document.querySelector('main').hidden = true));
    assert.equal((await read()).fontSize, 18);
    await page.evaluate(() => {
      const m = document.querySelector('main');
      m.hidden = false;
      m.innerHTML =
        '<div data-content-search-turn-key="two"><p style="font:22px/33px serif">新聊天</p></div>';
    });
    assert.equal((await read()).fontSize, 18);
    await page.waitForTimeout(220);
    assert.equal((await read()).fontSize, 22);
    await page.evaluate(() =>
      window.tracker.configure({ mode: 'follow', source: 'session', scale: 125, customSize: 19 }),
    );
    await read();
    await page.waitForTimeout(220);
    t = await read();
    assert.equal(t.fontSize, 17.5);
    assert.equal(t.zoom, 1);
    await page.evaluate(() => {
      document.querySelector('main').innerHTML =
        '<div contenteditable style="font:20px/30px sans-serif">输入</div>';
      window.tracker.configure({ source: 'composer' });
    });
    await read();
    await page.waitForTimeout(220);
    t = await read();
    assert.equal(t.fontSize, 20);
    assert.equal(t.zoom, 1.3);
    await page.evaluate(() =>
      window.tracker.configure({ mode: 'custom', source: 'composer', customSize: 19, scale: 125 }),
    );
    t = await read();
    assert.equal(t.fontSize, 19);
    assert.equal(t.zoom, 1);
  } finally {
    await browser.close();
  }
});
test('card and embedded workbench render same visual size; settings receive same snapshot without draft loss', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => window.tracker.snapshot());
    await page.waitForTimeout(220);
    const { raw, prefs } = await page.evaluate(() => window.apply());
    await page.locator('.term-module').waitFor();
    const sizes = await page.evaluate(() => ({
      card:
        parseFloat(getComputedStyle(window.testCard).fontSize) *
        parseFloat(window.testCard.style.zoom),
      feature: parseFloat(getComputedStyle(document.querySelector('.feature-view')).fontSize) * 1.3,
      term: parseFloat(getComputedStyle(document.querySelector('.term-module')).fontSize) * 1.3,
      indent: getComputedStyle(window.testCard.querySelector('p')).textIndent,
      gap: getComputedStyle(window.testCard.querySelector('p')).marginTop,
    }));
    assert.ok(Math.abs(sizes.card - 23.4) < 0.02);
    assert.ok(Math.abs(sizes.feature - 23.4) < 0.02);
    assert.ok(Math.abs(sizes.term - 23.4) < 0.02);
    assert.equal(sizes.indent, '36px');
    assert.equal(sizes.gap, '6px');
    // 独立设置文档模拟 HTTP/SSE 接收同一快照，无宿主缩放祖先。
    const settings = await browser.newPage();
    await settings.setContent('<div id="settings"></div><input id="draft" value="保留草稿">');
    await settings.addScriptTag({ content: bundle });
    await settings.evaluate(({ raw, prefs }) => window.settings(raw, prefs), { raw, prefs });
    await settings.locator('#settings-text').waitFor();
    assert.ok(
      Math.abs(
        (await settings
          .locator('#settings-text')
          .evaluate((e) => parseFloat(getComputedStyle(e).fontSize))) - 23.4,
      ) < 0.02,
    );
    await settings.evaluate(({ prefs }) => window.settings(null, prefs), { prefs });
    await settings.waitForTimeout(30);
    assert.ok(
      Math.abs(
        (await settings
          .locator('#settings-text')
          .evaluate((e) => parseFloat(getComputedStyle(e).fontSize))) - 23.4,
      ) < 0.02,
    );
    assert.equal(await settings.locator('#draft').inputValue(), '保留草稿');
  } finally {
    await browser.close();
  }
});
