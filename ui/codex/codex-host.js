/* [INPUT]: CodexHost 0.10.2 的版本化只读探针与当前输入框附近的 Agent 控件。
 * [OUTPUT]: window.__codexBuddyHostCompatibility，按输入框判断官方模型操作是否可用。
 * [POS]: 上游只读适配；缺失或未知协议拒绝模型写入，不覆盖上游实现。
 * [PROTOCOL]: 变更时同步 codex/AGENTS.md。 */
(() => {
  /** @param {Element | null | undefined} composer */
  function capability(composer) {
    const probe = window.__codexhostRendererBindingProbeV1;
    let scope = composer?.parentElement;
    while (scope && scope !== document.body) {
      const controls = scope.querySelectorAll('[data-codexhost-agent-control]');
      if (controls.length) {
        if (controls.length !== 1)
          return { officialModel: false, message: '无法确认当前 CodexHost Agent' };
        const control = controls[0];
        const id = control.getAttribute('data-codexhost-agent-control');
        if (!probe) return { officialModel: false, message: 'CodexHost 状态接口尚未就绪' };
        let agent;
        try {
          const status = probe.status();
          if (status?.version !== 2)
            return { officialModel: false, message: '当前 CodexHost 版本尚未适配模型切换' };
          const selections = status.selections?.filter((item) => item.composerId === id);
          if (!id || selections?.length !== 1)
            return { officialModel: false, message: '无法确认当前 CodexHost Agent' };
          agent = selections[0].agent;
        } catch {
          return { officialModel: false, message: '无法读取 CodexHost Agent 状态' };
        }
        return agent === 'codex'
          ? { officialModel: true, message: '' }
          : {
              officialModel: false,
              message: agent
                ? `当前使用 ${agent}，请通过 CodexHost 切换模型`
                : '无法确认当前 CodexHost Agent',
            };
      }
      // Do not borrow controls from another composer's ancestor.
      if (scope.querySelectorAll('.ProseMirror,textarea,[contenteditable="true"]').length > 1)
        break;
      scope = scope.parentElement;
    }
    return probe || document.querySelector('[data-codexhost-agent-control]')
      ? { officialModel: false, message: 'CodexHost 输入框尚未就绪' }
      : { officialModel: true, message: '' };
  }
  window.__codexBuddyHostCompatibility = { capability };
})();
