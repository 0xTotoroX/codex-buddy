/* [INPUT]: 纯匹配器、真实术语显示模块与合成聊天。
 * [OUTPUT]: 原文不变、跨节点标注、掌握过滤、异步取消和样式截图。
 * [POS]: 隔离浏览器验收，不访问真实聊天或模型。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { createMatcher } from '../ui/terminology/matcher.js';
const term = {
  id: 'TERM-1',
  name: '竞态条件',
  english: 'Race Condition',
  definition: '多个操作的完成顺序不可预测，较早发出的请求可能较晚返回，覆盖当前结果。',
  aliases: ['竞态'],
  category: ['程序基础', '并发'],
  source: '',
  example: '',
};
test('matches longest labels, word boundaries, aliases and mastered concepts', () => {
  const match = createMatcher([
    term,
    { ...term, id: 'TERM-2', name: '接口', english: 'API', aliases: [] },
  ]);
  assert.equal(match('竞态条件和竞态，race condition 和 Capital API').length, 4);
  assert.equal(createMatcher([term], ['TERM-1'])('竞态条件 Race Condition 竞态').length, 0);
  assert.equal(
    createMatcher([term, { ...term, id: 'other', name: '其他', aliases: ['竞态'] }])('竞态').length,
    0,
  );
});
const bundle = (
  await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `import {installTerminology} from './ui/terminology/host.js';
window.state={preferences:{enabled:true,semantic:false,autoExpand:false,cardStyle:'plain',mastered:[],revision:0},entries:[${JSON.stringify(term)}]};window.calls=[];window.session='one';window.answer='这是竞态条件。';window.semanticReply=null;
window.setup=()=>installTerminology({getRoot:()=>document.querySelector('main'),isBusy:()=>false,getExchange:()=>({sessionId:window.session,title:'合成聊天',question:'旧请求回来覆盖新页面，该怎么处理？',answer:window.answer}),request:async(path,payload)=>{window.calls.push({path,payload});if(path.endsWith('/analyze'))return new Promise(r=>window.semanticReply=r);if(payload.action==='master')window.state.preferences.mastered.push(payload.id);return structuredClone(window.state);}});window.setup();`,
    },
    bundle: true,
    format: 'iife',
    write: false,
  })
).outputFiles[0].text;
test('hover, style, mastery, navigation and cleanup preserve host content', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1050, height: 720 } });
  try {
    await page.setContent(
      '<main style="margin:100px;font:18px/1.7 system-ui"><p>这里出现竞态<strong>条件</strong>，请查看。</p><p>旧请求回来覆盖新页面，该怎么处理？</p><pre>竞态条件</pre><textarea>未发送草稿：竞态条件</textarea></main>',
    );
    const before = await page.locator('main').innerHTML();
    await page.addScriptTag({ content: bundle });
    await page.waitForFunction(() => CSS.highlights.get('codex-buddy-terms')?.size === 1);
    const point = await page.evaluate(() => {
      const range = [...CSS.highlights.get('codex-buddy-terms')][0];
      const r = range.getBoundingClientRect();
      return { x: r.x + 6, y: r.y + 6 };
    });
    await page.mouse.move(point.x, point.y);
    await page.getByRole('dialog', { name: '竞态条件释义' }).waitFor();
    assert.equal(await page.locator('main').innerHTML(), before);
    for (const style of ['plain', 'frost']) {
      await page.evaluate(async (style) => {
        window.state.preferences.cardStyle = style;
        await window.__codexBuddyTerminology.refresh();
      }, style);
      await page.mouse.move(5, 5);
      await page.mouse.move(point.x, point.y);
      await page.getByRole('dialog').waitFor();
      assert.equal(await page.locator('.term-card').getAttribute('data-style'), 'attached');
      assert.equal(
        await page.locator('.term-card').getAttribute('data-material'),
        style === 'frost' ? 'frosted' : 'matte',
      );
    }
    await page.getByRole('button', { name: '已掌握，不再提示' }).click();
    await page.waitForFunction(() => CSS.highlights.get('codex-buddy-terms')?.size === 0);
    assert.equal(await page.locator('textarea').inputValue(), '未发送草稿：竞态条件');
    await page.evaluate(async () => {
      window.state.preferences.mastered = [];
      window.state.preferences.semantic = true;
      await window.__codexBuddyTerminology.refresh();
    });
    await page.waitForFunction(() => window.semanticReply !== null);
    const id = await page.evaluate(
      () => window.calls.find((c) => c.path.endsWith('/analyze')).payload.requestId,
    );
    assert.equal(await page.evaluate((id) => window.__codexBuddyTerminology.verify(id), id), true);
    await page.evaluate(() => {
      window.session = 'two';
      document.querySelector('main').innerHTML = '<p>另一个聊天</p>';
      window.answer = '新回答';
    });
    assert.equal(await page.evaluate((id) => window.__codexBuddyTerminology.verify(id), id), false);
    await page.evaluate(() =>
      window.semanticReply({ matches: [{ id: 'TERM-1', quote: '旧请求回来覆盖新页面' }] }),
    );
    await page.waitForTimeout(1100);
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.evaluate(() => window.__codexBuddyTerminology.destroy());
    assert.equal(await page.locator('[data-buddy-terms]').count(), 0);
    assert.equal(await page.evaluate(() => CSS.highlights.has('codex-buddy-terms')), false);
  } finally {
    await browser.close();
  }
});

test('render current card styles without removed note variant', async () => {
  const result = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `import {cardStyles,createCard} from './ui/terminology/card.js';document.querySelector('style').textContent+=cardStyles;for(const [id,label] of [['plain','A · 简洁白卡'],['frost','B · 磨砂卡']]){const section=document.createElement('section');const title=document.createElement('h2');title.textContent=label;section.append(title,createCard(${JSON.stringify(term)},{preferences:{cardStyle:id},semantic:true}));document.querySelector('main').append(section);}`,
      },
      bundle: true,
      format: 'iife',
      write: false,
    })
  ).outputFiles[0].text;
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>术语卡片样式</title><style>body{margin:0;background:#f2f3f5;color:#282a30;font-family:system-ui}h1{font-size:24px;font-weight:600;margin:48px 42px 8px}body>p{margin:0 42px;color:#6c6e76}main{display:flex;gap:28px;padding:28px 42px 60px;flex-wrap:wrap}section{padding:12px;border-radius:24px;background:linear-gradient(155deg,#f0f2f5,#d9dce3,#f6f6f8)}h2{font-size:15px;font-weight:500;margin:0 0 24px}</style><h1>术语释义 · 卡片样式</h1><p>默认细下划线，悬停圈出原句；三种样式共用同一份释义。</p><main></main><script>${result}</script></html>`;
  await mkdir('target/reports/terminology', { recursive: true });
  await writeFile('target/reports/terminology/cards.html', html);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 600 },
      deviceScaleFactor: 2,
    });
    await page.setContent(html);
    await page.waitForTimeout(180);
    await page.screenshot({ path: 'target/reports/terminology/cards.png' });
    assert.equal(await page.locator('.term-card').count(), 2);
  } finally {
    await browser.close();
  }
});

test('semantic spans cross paragraphs, whitespace and formatting without reading editor or code', async () => {
  const { outputFiles } = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `import {textIndex,semanticSpans} from './ui/terminology/text-ranges.js';window.inspect=()=>{const index=textIndex(document.querySelector('main'));const spans=semanticSpans(index.text,'连续输入期间 暂不执行，等停止输入片刻再发出请求。');return {text:index.text,spans:spans.map(s=>index.range(s.start,s.end).toString())};};`,
    },
    bundle: true,
    write: false,
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<main><p>连续<strong>输入</strong>期间</p><p>暂不执行，等停止输入片刻再发出请求。</p><code>秘密代码</code><p>虚拟<code>隔离</code> DOM</p><textarea>秘密草稿</textarea></main>',
    );
    await page.addScriptTag({ content: outputFiles[0].text });
    const value = await page.evaluate(() => window.inspect());
    assert.equal(value.spans.length, 1);
    assert.ok(value.spans[0].includes('停止输入'));
    assert.ok(!value.text.includes('秘密'));
    assert.ok(!value.text.includes('虚拟 DOM'));
  } finally {
    await browser.close();
  }
});

test('semantic response paints a multi-paragraph phrase without a literal term and is cached', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<main style="margin:80px"><p>旧请求回来</p><p>覆盖新页面，该怎么处理？</p></main>',
    );
    await page.addScriptTag({ content: bundle });
    await page.evaluate(async () => {
      window.state.preferences.semantic = true;
      await window.__codexBuddyTerminology.refresh();
    });
    await page.waitForFunction(() => window.semanticReply !== null);
    await page.evaluate(() =>
      window.semanticReply({
        matches: [{ id: 'TERM-1', quote: '旧请求回来 覆盖新页面，该怎么处理？' }],
      }),
    );
    await page.waitForFunction(() => CSS.highlights.get('codex-buddy-terms')?.size === 1);
    const text = await page.evaluate(() =>
      [...CSS.highlights.get('codex-buddy-terms')][0].toString(),
    );
    assert.ok(text.includes('旧请求回来') && text.includes('覆盖新页面'));
    assert.ok(!text.includes('竞态条件'));
    await page.evaluate(() => window.__codexBuddyTerminology.refresh());
    await page.waitForTimeout(1300);
    assert.equal(
      await page.evaluate(
        () => window.calls.filter((c) => c.path === '/terminology/analyze').length,
      ),
      1,
    );
    await page.evaluate(() => window.__codexBuddyTerminology.destroy());
  } finally {
    await browser.close();
  }
});

test('long phrase popover follows hover point, clamps to viewport and stays still for actions', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 700 } });
    const phrase = '多个操作的执行先后不可预测，最终结果随完成顺序变化';
    await page.setContent(
      `<main style="margin:100px;font:24px/1.8 system-ui"><p>${phrase}</p></main>`,
    );
    await page.addScriptTag({ content: bundle });
    await page.evaluate(async (phrase) => {
      window.state.entries[0].aliases = [phrase];
      await window.__codexBuddyTerminology.refresh();
    }, phrase);
    await page.waitForFunction(() => CSS.highlights.get('codex-buddy-terms')?.size === 1);
    const line = await page.evaluate(() => {
      const r = [...CSS.highlights.get('codex-buddy-terms')][0].getBoundingClientRect();
      return { left: r.left, right: r.right, y: r.top + r.height / 2 };
    });
    const x = line.right - 15;
    await page.mouse.move(x, line.y);
    const card = page.getByRole('dialog');
    await card.waitFor();
    await page.waitForTimeout(270);
    assert.ok(Math.abs((await card.boundingBox()).x - x) < 2);
    const next = x - 130;
    await page.mouse.move(next, line.y);
    await page.waitForTimeout(50);
    assert.ok(Math.abs((await card.boundingBox()).x - next) < 2);
    const before = await card.boundingBox();
    await page.getByRole('button', { name: '收藏术语', exact: true }).hover();
    await page.waitForTimeout(220);
    assert.deepEqual(await card.boundingBox(), before);
    await page.setViewportSize({ width: 780, height: 700 });
    await page.mouse.move(5, 5);
    await page.keyboard.press('Escape');
    const edge = await page.evaluate(() => {
      const r = [...CSS.highlights.get('codex-buddy-terms')][0].getClientRects()[0];
      return { x: r.right - 5, y: r.top + r.height / 2 };
    });
    await page.mouse.move(edge.x, edge.y);
    await card.waitFor();
    await page.waitForTimeout(270);
    const bounded = await card.boundingBox();
    assert.ok(bounded.x >= 10 && bounded.x + bounded.width <= 771);
    await page.evaluate(() => window.__codexBuddyTerminology.destroy());
  } finally {
    await browser.close();
  }
});
