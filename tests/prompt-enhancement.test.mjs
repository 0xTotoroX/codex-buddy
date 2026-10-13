/* [INPUT]: Real composer adapter and controlled async model replies in an isolated browser.
 * [OUTPUT]: Explicit optimize/restore, cancellation and draft/session/IME protection with controlled polling time.
 * [POS]: Synthetic drafts only; does not send messages or use a paid model.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const bundle = (
  await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
import {installPromptEnhancer} from './ui/codex/prompt-enhancement.js';import {rawComposerText} from './ui/codex/composer.js';window.readDraft=()=>rawComposerText(document.querySelector('textarea,[contenteditable]'));
window.calls=[];window.replies=[];window.session='one';window.enabled=true;
window.setup=()=>installPromptEnhancer({isEnabled:()=>window.enabled,getTarget:()=>({id:window.session,root:document.querySelector('main'),scope:document.querySelector('main'),composer:document.querySelector('textarea,[contenteditable]')}),request:(path,payload)=>{window.calls.push({path,payload});return new Promise(resolve=>window.replies.push(resolve));}});window.setup();
`,
    },
    bundle: true,
    write: false,
    define: { CODEX_BUDDY_DEVELOPMENT: 'true' },
  })
).outputFiles[0].text;

test('optimize and restore protect drafts, sessions, IME and cancellation without sending', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.clock.install();
    await page.setContent(
      '<main data-codex-composer-root><textarea aria-label="草稿"></textarea></main>',
    );
    await page.addScriptTag({ content: bundle });
    const editor = page.getByLabel('草稿'),
      optimize = () => page.getByRole('button', { name: '优化提示词', exact: true });
    assert.equal(await optimize().isDisabled(), true);
    const control = page.locator('[data-codex-buddy-prompt] button');
    const firstButton = await control.elementHandle();
    assert.equal(await control.count(), 1);
    const original = '只讨论，不执行。\n保留 $&、$1 和 "引号"。';
    await editor.fill(original);
    await optimize().click();
    assert.equal(await page.getByRole('button', { name: '取消优化' }).count(), 1);
    assert.equal(
      await page.evaluate(() =>
        window.__codexBuddyPromptEnhancer.verify(window.calls[0].payload.requestId),
      ),
      true,
    );
    assert.equal(await page.evaluate(() => window.calls[0].payload.text), original);
    await page.evaluate(() =>
      window.replies.shift()({ prompt: '请仅讨论方案，不执行操作。\n保留 $&、$1 和 "引号"。' }),
    );
    await page.getByRole('button', { name: '恢复原提示词' }).waitFor();
    assert.equal(await control.count(), 1);
    assert.equal(await control.evaluate((node, initial) => node === initial, firstButton), true);
    assert.equal(await control.locator('svg').getAttribute('data-icon'), 'return');
    assert.equal((await control.textContent()).trim(), '');
    await page.getByRole('button', { name: '恢复原提示词' }).click();
    assert.equal(await editor.inputValue(), original);
    assert.equal(await control.locator('svg').getAttribute('data-icon'), 'prompt-improve');
    assert.equal(
      await page.evaluate(() => window.calls.length),
      1,
      'restore does not request a model',
    );
    await optimize().click();
    await page.evaluate(() => window.replies.shift()({ prompt: '第二次优化' }));
    await page.getByRole('button', { name: '恢复原提示词' }).waitFor();
    await editor.fill('优化后手动编辑');
    assert.equal(await optimize().count(), 1);
    assert.equal(await page.getByRole('button', { name: '恢复原提示词' }).count(), 0);
    assert.equal(await control.count(), 1);
    await optimize().click();
    await editor.fill('我正在继续编辑');
    assert.equal(
      await page.evaluate(() =>
        window.__codexBuddyPromptEnhancer.verify(window.calls.at(-1).payload.requestId),
      ),
      false,
    );
    await page.evaluate(() => window.replies.shift()({ prompt: '过期结果' }));
    assert.equal(await editor.inputValue(), '我正在继续编辑');
    await optimize().click();
    await page.getByRole('button', { name: '取消优化' }).click();
    await page.evaluate(() => window.replies.shift()({ prompt: '已取消结果' }));
    assert.equal(await editor.inputValue(), '我正在继续编辑');
    await optimize().click();
    await page.evaluate(() => (window.session = 'two'));
    await page.evaluate(() => window.replies.shift()({ prompt: '错误会话' }));
    assert.equal(await editor.inputValue(), '我正在继续编辑');
    await page.clock.runFor(350);
    await optimize().click();
    await page.evaluate(() => {
      const old = document.querySelector('textarea');
      const next = old.cloneNode();
      next.value = '新输入框';
      old.replaceWith(next);
      window.replies.shift()({ prompt: '旧输入框结果' });
    });
    assert.equal(await editor.inputValue(), '新输入框');
    await page.clock.runFor(350);
    await editor.dispatchEvent('compositionstart');
    assert.equal(await optimize().isDisabled(), true);
    await editor.dispatchEvent('compositionend');
    assert.equal(await optimize().isEnabled(), true);
    await optimize().click();
    await page.evaluate(() => window.replies.shift()({ error: '模拟服务失败' }));
    await page.getByRole('status').filter({ hasText: '模拟服务失败' }).waitFor();
    assert.equal(await editor.inputValue(), '新输入框');
    await page.evaluate(() => window.setup());
    assert.equal(await optimize().count(), 1);
    await page.evaluate(() => {
      window.__codexBuddyPromptEnhancer.destroy();
      document.querySelector('textarea').outerHTML =
        '<div contenteditable="true" aria-label="草稿"><p>第一行</p><p>第二行 $&</p></div>';
      window.setup();
    });
    await optimize().click();
    assert.equal(await page.evaluate(() => window.calls.at(-1).payload.text), '第一行\n第二行 $&');
    await page.evaluate(() => window.replies.shift()({ prompt: '优化第一行\n保留第二行 $&' }));
    await page.getByRole('button', { name: '恢复原提示词' }).click();
    assert.equal(await page.evaluate(() => window.readDraft()), '第一行\n第二行 $&');
    await page.evaluate(() => {
      document.querySelector('[contenteditable]').innerHTML =
        '文本 <span contenteditable="false">引用</span>';
    });
    await optimize().click();
    await page.getByRole('status').filter({ hasText: '特殊内容' }).waitFor();
    assert.equal(await page.evaluate(() => window.replies.length), 0);
    assert.equal(await page.locator('[data-codex-buddy-prompt] [title]').count(), 0);
    await page.evaluate(() => window.__codexBuddyPromptEnhancer.destroy());
    assert.equal(await page.locator('[data-codex-buddy-prompt]').count(), 0);
  } finally {
    await browser.close();
  }
});

test('multiline editor DOM keeps line boundaries and empty lines through optimize and restore', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(
      '<main><div contenteditable="true" aria-label="草稿" style="white-space:pre-wrap"></div></main>',
    );
    await page.addScriptTag({ content: bundle });
    const cases = [
      ['裸文本与 DIV', 'first<div>second</div>', 'first\nsecond'],
      ['DIV 与裸文本', '<div>first</div>second', 'first\nsecond'],
      ['多个 P', '<p>first</p><p>second</p>', 'first\nsecond'],
      ['中间空行', 'first<div><br></div><div>second</div>', 'first\n\nsecond'],
      ['首尾空行', '<p><br></p><p>first</p><p><br></p><p><br></p>', '\nfirst\n\n'],
      ['连续 BR', 'first<br><br>second', 'first\n\nsecond'],
      ['末尾 BR 占位', 'first<br><br><br>', 'first\n\n'],
      ['ProseMirror 硬换行', '<p>first<br><br class="ProseMirror-trailingBreak"></p>', 'first\n'],
      ['内联格式与 BR', '<p><strong>first<br></strong><em>second</em></p>', 'first\nsecond'],
      ['嵌套容器', '<div><p>first</p><p><br></p><p>second</p></div>', 'first\n\nsecond'],
      ['原始文本换行', '\nfirst\n\nsecond\n\n', '\nfirst\n\nsecond\n\n'],
      ['代码与特殊字符', '<pre>  $&amp;\n\n$1\n</pre>', '  $&\n\n$1\n'],
    ];
    for (const [name, html, original] of cases) {
      await page.evaluate((html) => {
        window.__codexBuddyPromptEnhancer.destroy();
        document.querySelector('[contenteditable]').innerHTML = html;
        window.setup();
      }, html);
      assert.equal(await page.evaluate(() => window.readDraft()), original, name);
      await page.getByRole('button', { name: '优化提示词', exact: true }).click();
      assert.equal(await page.evaluate(() => window.calls.at(-1).payload.text), original, name);
      await page.evaluate(() => window.replies.shift()({ prompt: '改写第一行\n\n改写第二行' }));
      await page.getByRole('button', { name: '恢复原提示词' }).waitFor();
      assert.equal(await page.evaluate(() => window.readDraft()), '改写第一行\n\n改写第二行', name);
      await page.getByRole('button', { name: '恢复原提示词' }).click();
      await page.getByRole('button', { name: '优化提示词', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.readDraft()), original, `${name}还原`);
    }
    await page.evaluate(() => {
      document.querySelector('[contenteditable]').innerHTML =
        '<ul><li>first</li><li>second</li></ul><p>third</p>';
    });
    assert.equal(await page.evaluate(() => window.readDraft()), 'first\nsecond\nthird');
    for (const html of ['', '<br>', '<p><br></p>', '<div><br></div>']) {
      await page.evaluate((html) => {
        document.querySelector('[contenteditable]').innerHTML = html;
        window.setup();
      }, html);
      assert.equal(await page.evaluate(() => window.readDraft()), '', '空编辑器占位不算正文');
      assert.equal(
        await page.getByRole('button', { name: '优化提示词', exact: true }).isDisabled(),
        true,
      );
    }
  } finally {
    await browser.close();
  }
});

test('browser-created Enter and Shift+Enter drafts round-trip without losing empty lines', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const key of ['Enter', 'Shift+Enter']) {
      const page = await browser.newPage();
      await page.setContent('<main><div contenteditable="true" aria-label="草稿"></div></main>');
      await page.addScriptTag({ content: bundle });
      const editor = page.getByLabel('草稿');
      await editor.pressSequentially('first');
      await editor.press(key);
      await editor.press(key);
      await editor.pressSequentially('second');
      await editor.press(key);
      const original = 'first\n\nsecond\n';
      assert.equal(await page.evaluate(() => window.readDraft()), original, key);
      await page.getByRole('button', { name: '优化提示词', exact: true }).click();
      assert.equal(await page.evaluate(() => window.calls.at(-1).payload.text), original, key);
      await page.evaluate(() => window.replies.shift()({ prompt: 'rewritten\n\ntext' }));
      await page.getByRole('button', { name: '恢复原提示词' }).click();
      assert.equal(await page.evaluate(() => window.readDraft()), original, `${key}还原`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('disabling prompt enhancement removes its control and invalidates pending requests', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(
      '<main data-codex-composer-root><textarea aria-label="草稿"></textarea></main>',
    );
    await page.addScriptTag({ content: bundle });
    await page.getByLabel('草稿').fill('保留的草稿');
    await page.getByRole('button', { name: '优化提示词', exact: true }).click();
    await page.evaluate(() => (window.enabled = false));
    assert.equal(
      await page.evaluate(() =>
        window.__codexBuddyPromptEnhancer.verify(window.calls[0].payload.requestId),
      ),
      false,
    );
    await page.waitForFunction(() => !document.querySelector('[data-codex-buddy-prompt]'));
    await page.evaluate(() => window.replies.shift()({ prompt: '已停用的迟到结果' }));
    assert.equal(await page.getByLabel('草稿').inputValue(), '保留的草稿');
    await page.evaluate(() => (window.enabled = true));
    await page.getByRole('button', { name: '优化提示词', exact: true }).waitFor();
  } finally {
    await browser.close();
  }
});

test('CodexHost Agent controls stay stationary with the optimizer mounted beside native voice', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(
      `<main data-codex-composer-root><textarea aria-label="草稿"></textarea><div id="actions"><div id="model" data-codexhost-model-control></div><div id="agent" data-codexhost-agent-control><button id="agent-button">Agent</button><div id="menu" popover="auto">Codex / WorkBuddy</div></div><span id="voice" style="display:contents"><button aria-label="听写" style="width:28px;height:28px">Mic</button></span><button type="submit" aria-label="发送">Send</button></div></main>`,
    );
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => {
      const model = document.querySelector('#model'),
        agent = document.querySelector('#agent'),
        anchor = document.querySelector('#voice'),
        parent = document.querySelector('#actions');
      window.agentMoves = 0;
      window.check = setInterval(() => {
        // CodexHost 0.13.1 preserves model → Agent → native trailing action adjacency.
        if (model.nextElementSibling !== agent || agent.nextElementSibling !== anchor) {
          parent.insertBefore(model, anchor);
          parent.insertBefore(agent, anchor);
          window.agentMoves++;
        }
      }, 40);
      document.querySelector('#agent-button').onclick = () =>
        document.querySelector('#menu').showPopover();
    });
    await page.getByRole('button', { name: 'Agent', exact: true }).click();
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => window.agentMoves), 0);
    assert.equal(
      await page.locator('#menu').evaluate((node) => node.matches(':popover-open')),
      true,
    );
    assert.equal(
      await page.evaluate(
        () => document.querySelector('[data-codex-buddy-prompt]').parentElement.id,
      ),
      'voice',
    );
    await page.evaluate(() => clearInterval(window.check));
  } finally {
    await browser.close();
  }
});

test('input target works without model capabilities and rejects duplicate chat identities', async () => {
  const { readFile } = await import('node:fs/promises');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(
      '<main data-conversation-id="chat-a"><div class="thread-scroll-container" style="height:300px">Synthetic chat</div><textarea style="width:400px;height:80px"></textarea></main>',
    );
    await page.addScriptTag({ content: await readFile('ui/codex/model.js', 'utf8') });
    assert.equal(
      await page.evaluate(() => window.__codexBuddyModelControl.inputTarget()?.id),
      'chat-a',
    );
    await page.evaluate(() => document.body.append(document.querySelector('main').cloneNode(true)));
    assert.equal(await page.evaluate(() => window.__codexBuddyModelControl.inputTarget()), null);
    await page.evaluate(() => {
      document.querySelector('main:last-child').remove();
      document.querySelector('main').dataset.conversationId = 'chat-b';
    });
    assert.equal(
      await page.evaluate(() => window.__codexBuddyModelControl.inputTarget()?.id),
      'chat-b',
    );
    await page.evaluate(() => {
      document.body.innerHTML =
        '<main><div data-codex-composer-root><div data-codex-composer contenteditable="true" style="width:400px;height:80px">New draft</div></div></main>';
    });
    const before = await page.evaluate(() => window.__codexBuddyModelControl.inputTarget()?.id);
    assert.match(before, /^draft:/);
    await page.evaluate(() =>
      document
        .querySelector('[data-codex-composer-root]')
        .replaceWith(document.querySelector('[data-codex-composer-root]').cloneNode(true)),
    );
    assert.notEqual(
      await page.evaluate(() => window.__codexBuddyModelControl.inputTarget()?.id),
      before,
    );
  } finally {
    await browser.close();
  }
});
