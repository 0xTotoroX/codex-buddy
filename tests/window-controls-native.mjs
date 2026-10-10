/* [INPUT]: Current debug native window and a synthetic local page/controller.
 * [OUTPUT]: Actual window hide/reveal and maximize/restore geometry with unchanged draft/PID.
 * [POS]: Isolated temporary data and self-owned window, no screenshots or real host data.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { build } from 'esbuild';
const root = resolve(import.meta.dirname, '..'),
  dir = await mkdtemp(join(tmpdir(), 'buddy-window-controls-'));
const binary = join(root, 'target/debug/codex-buddy');
let latest,
  commands = [],
  child;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (
  await build({
    stdin: {
      resolveDir: root,
      contents: `
import {windowControlsHtml,installWindowControls} from './ui/surfaces/workspace/window-controls.js';
document.body.innerHTML='<header>'+windowControlsHtml()+'</header><input id="draft" value="未保存的合成草稿">';
let ready=false,returned=false,state=null;
const post=value=>window.ipc.postMessage(JSON.stringify(value));
window.__companionPopout={presented(){},motionFinished(){ready=true;},returned(ok){returned=ok;},resized(){},moved(){}};
const controller=installWindowControls(document.body,{post,dock:async()=>post({kind:'return',anchor:null}),error:e=>window.failure=String(e)});
const update=controller.update;controller.update=value=>{state=value;update(value);};
post({kind:'show',anchor:null});
async function poll(){
 try{const response=await fetch('/probe',{method:'POST',body:JSON.stringify({ready,returned,state,draft:document.querySelector('#draft').value,width:innerWidth,height:innerHeight,error:window.failure,zoomLabel:document.querySelector('[data-window-control="maximize"]').getAttribute('aria-label')})});
 for(const action of await response.json()){
  if(action==='hide'||action==='reveal')post({kind:action});
  else if(action==='close')post({kind:'close'});
  else document.querySelector('[data-window-control="'+action+'"]').click();
 }
 }finally{setTimeout(poll,80)}
}poll();
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
  })
).outputFiles[0].text;
const html = `<!doctype html><meta charset="utf-8"><style>body{background:white;color:black;font-family:system-ui}button{width:32px;height:32px}svg{width:18px;height:18px}input{display:block;margin:20px}</style><script type="module">${js.replaceAll('</script', '<\\/script')}</script>`;
const server = createServer(async (req, res) => {
  if (req.url === '/probe') {
    let data = '';
    for await (const chunk of req) data += chunk;
    latest = JSON.parse(data);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(commands.splice(0)));
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const probe = join(dir, 'probe');
async function wait(read, label) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (child?.exitCode !== null && child) throw Error('window exited');
    if (latest?.error) throw Error(latest.error);
    const value = read();
    if (value) return value;
    await delay(80);
  }
  throw Error(label + ': ' + JSON.stringify(latest));
}
function windows() {
  return JSON.parse(execFileSync(probe, ['windows', String(child.pid)], { encoding: 'utf8' }));
}
function bounds() {
  return windows()
    .map((w) => w.kCGWindowBounds)
    .find((r) => r.Width >= 300 && r.Height >= 300);
}
function near(a, b) {
  for (const k of ['X', 'Y', 'Width', 'Height'])
    assert.ok(Math.abs(a[k] - b[k]) <= 2, `${k} differs`);
}
try {
  execFileSync('swiftc', [join(root, 'tests/native-probe.swift'), '-o', probe]);
  await writeFile(
    join(dir, 'runtime.json'),
    JSON.stringify({
      pid: process.pid,
      port: server.address().port,
      token: 'fixture',
      version: '0.9.0',
      executable: binary,
    }),
  );
  await writeFile(
    join(dir, 'panel.json'),
    JSON.stringify({
      alwaysOnTop: false,
      ui: { width: 500, height: 420 },
      position: { x: 240, y: 260 },
    }),
  );
  child = spawn(binary, ['--data-dir', dir, 'panel-window', '--lease', 'fixture'], {
    stdio: 'pipe',
    env: { ...process.env, CODEX_BUDDY_DEV_GENIE: '0' },
  });
  await wait(
    () => latest?.ready && latest?.state && !latest.state.hidden && bounds(),
    'initial visible',
  );
  const original = bounds(),
    pid = child.pid;
  commands.push('hide');
  await wait(() => latest?.state?.hidden && !bounds(), 'hidden');
  assert.equal(latest.draft, '未保存的合成草稿');
  commands.push('reveal');
  await wait(() => latest?.state && !latest.state.hidden && bounds(), 'revealed');
  near(bounds(), original);
  commands.push('maximize');
  await wait(
    () =>
      latest?.state?.maximized && latest.zoomLabel === '还原' && bounds()?.Width > original.Width,
    'maximized',
  );
  const large = bounds();
  commands.push('hide');
  await wait(() => latest?.state?.hidden && !bounds(), 'maximized hidden');
  commands.push('reveal');
  await wait(() => latest?.state && !latest.state.hidden && bounds(), 'maximized revealed');
  near(bounds(), large);
  commands.push('maximize');
  await wait(
    () =>
      latest?.state &&
      !latest.state.maximized &&
      latest.zoomLabel === '放大' &&
      Math.abs(bounds()?.Width - original.Width) <= 2,
    'restored',
  );
  near(bounds(), original);
  assert.equal(latest.draft, '未保存的合成草稿');
  assert.equal(child.pid, pid);
  commands.push('dock');
  await wait(() => latest?.returned, 'return action');
  const result = {
    hideReveal: true,
    maximizeRestore: true,
    maximizedHideReveal: true,
    samePid: true,
    draftPreserved: true,
    positionRestored: true,
    returnAction: true,
    screenshots: false,
  };
  await mkdir(join(root, 'target/reports'), { recursive: true });
  await writeFile(
    join(root, 'target/reports/window-controls-native.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((r) => {
      child.once('exit', r);
      setTimeout(r, 3000);
    });
  }
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
}
