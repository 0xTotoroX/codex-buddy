/*
 * [INPUT]: 开发网关注入的脚本、同源认证 API 与共享外观变量。
 * [OUTPUT]: 仅 Dev 设置页显示的来源、资源确认与 worktree 切换入口。
 * [POS]: 由开发监督进程提供，旧 worktree 无需合并此模块；不进入正式构建或聊天界面。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
const incoming = new URLSearchParams(location.hash.slice(1)).get('token');
if (incoming) sessionStorage.setItem('companion-token', incoming);
const token = incoming || sessionStorage.getItem('companion-token') || '';
const host = document.createElement('section');
host.id = 'buddy-dev-sources';
const view = host.attachShadow({ mode: 'open' });
view.innerHTML = `<style>
:host{display:block;max-width:1060px;margin:20px auto 0;padding:0 24px;font:13px/1.6 system-ui;color:var(--buddy-text,CanvasText)}
details{border:1px solid var(--buddy-border,GrayText);border-radius:12px;background:var(--buddy-surface,Canvas);padding:12px 16px}
summary{cursor:pointer}p{margin:8px 0;overflow-wrap:anywhere;color:var(--buddy-muted,GrayText)}
form{display:flex;align-items:center;gap:10px;flex-wrap:wrap}select,button{font:inherit;color:inherit;background:var(--buddy-subtle,Canvas);border:1px solid var(--buddy-border,GrayText);border-radius:7px;padding:6px 10px;max-width:100%}
button{cursor:pointer}button:disabled,select:disabled{opacity:.5;cursor:default}:focus-visible{outline:2px solid var(--buddy-focus,Highlight);outline-offset:2px}
</style><details><summary>开发来源 · 读取中</summary><p data-path></p>
<form><label for="source">调试 worktree</label><select id="source" aria-label="调试 worktree"></select><button type="submit">切换来源</button></form>
<p data-state role="status" aria-live="polite"></p><p>切换只交接 Buddy，不重启 Codex。各 worktree 保留独立配置；建议缓存等运行期状态不会跨来源迁移。</p></details>`;
document.body.prepend(host);
const summary = view.querySelector('summary');
const select = view.querySelector('select');
const button = view.querySelector('button');
const state = view.querySelector('[data-state]');
let active = '',
  pending = false,
  polling = false;
async function api(body) {
  const response = await fetch('/api/dev/sources', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || '开发来源暂时不可用');
  return result;
}
function render(result) {
  const source = result.sources.find((item) => item.path === result.active);
  summary.textContent = `开发来源 · ${source?.branch || '未知'} · ${source?.commit || ''}${source?.dirty ? '（未提交修改）' : ''}`;
  view.querySelector('[data-path]').textContent = result.active;
  const chosen = select.value;
  const changed = active !== result.active;
  select.replaceChildren(
    ...result.sources.map((item) => {
      const option = document.createElement('option');
      option.value = item.path;
      option.textContent = `${item.branch} · ${item.commit}${item.dirty ? ' *' : ''} — ${item.path}`;
      return option;
    }),
  );
  active = result.active;
  select.value = !changed && result.sources.some((s) => s.path === chosen) ? chosen : active;
  const phases = {
    preparing: '正在编译目标来源，原工作台保持运行…',
    connecting: '正在交接开发连接…',
    restoring: '切换失败，正在恢复原来源…',
    failed: '连接恢复失败，请查看开发日志。',
  };
  state.textContent =
    result.error ||
    (result.buildError && `热更新失败，保留上次资源：${result.buildError}`) ||
    phases[result.phase] ||
    (result.loaded
      ? `界面资源已确认 · ${result.resource}`
      : result.connected
        ? '已连接，等待界面资源确认'
        : '尚未连接');
  select.disabled = pending || result.busy;
  button.disabled = pending || result.busy || select.value === active;
}
async function refresh() {
  if (polling || document.hidden) return;
  polling = true;
  try {
    render(await api());
  } catch (error) {
    state.textContent = error.message;
  } finally {
    polling = false;
  }
}
select.addEventListener('change', () => {
  button.disabled = pending || select.value === active;
});
view.querySelector('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pending || select.value === active) return;
  pending = true;
  select.disabled = button.disabled = true;
  state.textContent = '正在准备目标来源…';
  try {
    await api({ path: select.value });
    location.reload();
  } catch (error) {
    state.textContent = error.message;
  } finally {
    pending = false;
    select.disabled = false;
    button.disabled = select.value === active;
  }
});
void refresh();
const timer = setInterval(refresh, 5000);
window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
