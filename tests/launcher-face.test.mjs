/* [INPUT]: Original expression resolver/context geometry and the real launcher adapter.
 * [OUTPUT]: Dynamic faces/source dots without replacing the button or its interactions.
 * [POS]: Synthetic host only; never reads real conversations or calls a model.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const compiled = await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
import {syncLauncher,stopLauncher,launcherButton} from './ui/surfaces/embedded/launcher.js';
import {resolveFabExpression,fabExpressionLabel} from './ui/surfaces/embedded/shell/shell.js';
import {activePaneCue} from './ui/codex/context.js';
import {runtimeState,contextState,stepwiseState,shellState} from './ui/codex/runtime/state.js';
Object.assign(runtimeState,{settings:{enabled:true,answerOutlineEnabled:false,baseUrlConfigured:true,model:'fixture',apiKeyConfigured:true,generationMode:'auto'}});
Object.assign(shellState,{activeTab:'next',surpriseUntil:0});Object.assign(contextState,{scanBusy:false,scanStatus:''});
window.clicks=0;window.actions=[];
window.refresh=(kind,pane='left')=>{contextState.activeContext={paneRoot:document.getElementById(pane)};contextState.scanBusy=kind==='answering';stepwiseState.bridgeStatus=kind==='generating'?'pending':kind==='error'?'failed':['ready','empty'].includes(kind)?'ok':'idle';stepwiseState.prompts=kind==='ready'?[{label:'fixture'}]:[];const expression=resolveFabExpression();syncLauncher({open:false,root:null,expression,expressionLabel:fabExpressionLabel(expression),sourceCue:activePaneCue(),click:()=>window.clicks++,pointerDown:()=>{},keyDown:()=>{},settings:()=>{},action:kind=>window.actions.push(kind)});};
window.stopLauncher=stopLauncher;window.refresh('idle');window.originalEye=launcherButton();window.currentEye=launcherButton;
`,
  },
  bundle: true,
  write: false,
  define: { CODEX_BUDDY_DEVELOPMENT: 'true' },
});
test('launcher reuses original expressions and source geometry while retaining its menu', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  try {
    await page.setContent(
      '<style>body{background:#fafafa;color:#252525}nav{display:flex;flex-direction:column;width:64px;height:500px;align-items:center;gap:8px;padding-bottom:4px}#profile{display:grid;place-items:center;width:36px;height:36px;flex:none;border:0;padding:0;background:none}#avatar{width:24px;height:24px;border-radius:50%;background:#87947a}.thread-scroll-container{position:absolute;top:30px;left:110px;width:300px;height:280px}#right{left:450px}</style><nav class="group/sidebar-rail"><div style="flex:1"></div><button id="profile" aria-label="Profile"><span id="avatar"></span></button></nav><div id="left" class="thread-scroll-container"></div><div id="right" class="thread-scroll-container"></div>',
    );
    const avatarBefore = await page.locator('#avatar').boundingBox();
    await page.addScriptTag({ content: compiled.outputFiles[0].text });
    const eye = page
      .locator('[data-codex-buddy-launcher]')
      .getByRole('button', { name: 'CodexBuddy', exact: true });
    assert.equal(await eye.locator('.csw-fab-eye').count(), 2);
    assert.equal(await eye.getAttribute('data-source-direction'), 'left');
    assert.equal(await page.locator('[data-codex-buddy-launcher] .divider').count(), 0);
    assert.deepEqual(await page.locator('#avatar').boundingBox(), avatarBefore);
    const eyeBox = await eye.boundingBox();
    const profileBox = await page.locator('#profile').boundingBox();
    assert.ok(eyeBox.y + eyeBox.height <= profileBox.y + 0.5, 'click targets do not overlap');
    const eyeShape = await eye.locator('.csw-fab-eye').first().boundingBox();
    const faceGap = avatarBefore.y - eyeShape.y - eyeShape.height;
    assert.ok(faceGap >= 12 && faceGap <= 17, `compact face gap: ${faceGap}`);
    await eye.hover();
    const stageBox = await eye.locator('.csw-status-stage').boundingBox();
    assert.ok(
      Math.abs(stageBox.y + stageBox.height / 2 - eyeBox.y - eyeBox.height / 2) < 0.5,
      'eyes remain vertically centered in the actual hover and click target',
    );
    assert.ok(eyeBox.height >= 28, 'compact button keeps the minimum click height');
    for (const [kind, animation] of [
      ['idle', 'csw-face-blink'],
      ['generating', 'csw-face-generate-bob'],
      ['ready', 'csw-face-happy-lift'],
      ['empty', 'csw-face-calm-breathe'],
      ['error', 'csw-face-error-breathe'],
    ]) {
      await page.evaluate((kind) => window.refresh(kind), kind);
      assert.equal(await eye.getAttribute('data-expression'), kind);
      assert.equal(
        await eye
          .locator('.csw-fab-eye')
          .first()
          .evaluate((n) => getComputedStyle(n).animationName),
        animation,
      );
      assert.equal(await page.evaluate(() => window.originalEye === window.currentEye()), true);
    }
    await page.evaluate(() => window.refresh('ready', 'right'));
    await page.waitForTimeout(210);
    assert.equal(await eye.getAttribute('data-source-direction'), 'right');
    assert.equal(
      await eye.locator('.csw-launcher-source').evaluate((n) => getComputedStyle(n).display),
      'block',
    );
    assert.ok(parseFloat(await eye.evaluate((n) => n.style.getPropertyValue('--source-x'))) > 33);
    assert.equal(
      await eye
        .locator('.csw-fab-happy-arc')
        .first()
        .evaluate((n) => getComputedStyle(n).display),
      'block',
    );
    await mkdir('target/reports', { recursive: true });
    await page.screenshot({ path: 'target/reports/launcher-face-ready.png' });
    await eye.click();
    assert.equal(await page.evaluate(() => window.clicks), 1);
    await eye.focus();
    await page.keyboard.press('ArrowRight');
    const menu = page.locator('[data-codex-buddy-launcher-menu]');
    assert.deepEqual(await eye.boundingBox(), eyeBox, 'menu opens upward without moving eyes');
    assert.deepEqual(await page.locator('#avatar').boundingBox(), avatarBefore);
    await menu.getByRole('menuitem', { name: '打开设置' }).click();
    assert.deepEqual(await page.evaluate(() => window.actions), ['settings']);
    await page.evaluate(() => {
      document.getElementById('right').style.left = '110px';
      document.getElementById('right').style.top = '350px';
      window.refresh('answering', 'right');
    });
    await page.waitForTimeout(210);
    assert.equal(await eye.getAttribute('data-source-direction'), 'bottom');
    await page.evaluate(() => window.refresh('answering', 'left'));
    await page.waitForTimeout(210);
    assert.equal(await eye.getAttribute('data-source-direction'), 'top');
    await page.mouse.move(850, 650);
    await page.waitForTimeout(40);
    assert.notEqual(await eye.evaluate((n) => n.style.getPropertyValue('--csw-eye-x')), '0px');
    await page.evaluate(() => {
      document.getElementById('right').remove();
      window.refresh('idle');
    });
    assert.equal(await eye.locator('.csw-launcher-source').isHidden(), true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await eye
        .locator('.csw-fab-eye')
        .first()
        .evaluate((n) => getComputedStyle(n).animationName),
      'none',
    );
    await page.evaluate(() => window.stopLauncher());
    assert.equal(await page.locator('[data-codex-buddy-launcher]').count(), 0);
    assert.equal(await menu.count(), 0);
  } finally {
    await browser.close();
  }
});
