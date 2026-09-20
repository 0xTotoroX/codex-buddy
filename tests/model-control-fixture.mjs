/*
 * [INPUT]: Synthetic model records and fixture options, installed in an isolated browser only.
 * [OUTPUT]: Official-style composer/menu DOM, correlated capability messages and test observations.
 * [POS]: Shared fixture for host adapter unit scenarios and real-backend/CDP integration tests.
 * [PROTOCOL]: Parent task owns maps; contains no host adapter injection or real chat/model calls.
 */
export const records = [
  {
    model: 'alpha',
    displayName: 'Alpha',
    supportedReasoningEfforts: ['low', 'high'],
    serviceTiers: ['standard', 'priority'],
  },
  {
    model: 'beta',
    displayName: 'Beta',
    supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }],
    serviceTiers: ['standard'],
  },
];
export function installModelControlFixture({ records, options = {} }) {
  const state = (window.host = {
    records,
    clicks: [],
    changes: [],
    triggerEvents: 0,
    delay: 0,
    block: '',
    configs: {},
    unexpected: [],
    originalDispatch: window.dispatchEvent,
  });
  // Public capability traffic is observed; adapter must never initiate requests/sends.
  window.addEventListener('codex-message-from-view', (event) =>
    state.unexpected.push(event.detail),
  );
  window.capability = (id = 1, data = records) => {
    window.dispatchEvent(
      new CustomEvent('codex-message-from-view', {
        detail: { type: 'mcp-request', request: { id, method: 'model/list' } },
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'mcp-response', message: { id, result: { data } } },
      }),
    );
    state.unexpected.length = 0;
  };
  window.clearMenus = () =>
    document.querySelectorAll('[role="menu"]').forEach((node) => node.remove());
  window.addChat = (id, dialog = false) => {
    const pane = document.createElement('section');
    pane.dataset.threadId = id;
    if (dialog) {
      pane.setAttribute('role', 'dialog');
      pane.className = 'floatingSurface';
    }
    pane.innerHTML = `<header>${id}</header><div class="thread-scroll-container" style="height:80px">Synthetic task</div><form data-codex-composer-root><div class="ProseMirror" contenteditable="true" style="height:40px">Draft ${id}</div><button type="button" aria-haspopup="menu" data-selected-reasoning-effort="low">Alpha low</button></form>`;
    document.body.append(pane);
    state.configs[id] = { model: 'alpha', reasoning: 'low', speed: 'standard' };
    const trigger = pane.querySelector('button');
    const render = () => {
      const config = state.configs[id];
      trigger.textContent = `${records.find((entry) => entry.model === config.model).displayName} ${config.reasoning}`;
      trigger.dataset.selectedReasoningEffort = config.reasoning;
    };
    const open = () => {
      state.clicks.push({ id, action: 'open' });
      if (state.onOpen) state.onOpen(pane);
      if (state.block === 'open') return;
      if (document.getElementById(`main-${id}`)) {
        clearMenus();
        return;
      }
      const main = document.createElement('div');
      main.id = `main-${id}`;
      main.setAttribute('role', 'menu');
      main.dataset.state = 'open';
      main.tabIndex = -1;
      const config = state.configs[id];
      for (const section of ['model', 'reasoning', 'speed']) {
        if (section === 'speed' && config.model === 'beta') continue;
        const row = document.createElement('div');
        row.setAttribute('role', 'menuitem');
        row.setAttribute('aria-haspopup', 'menu');
        row.tabIndex = -1;
        row.textContent = `${section} ${section === 'model' ? records.find((entry) => entry.model === config.model).displayName : config[section]}`;
        main.append(row);
        row.addEventListener('click', () => {
          state.clicks.push({ id, action: section });
          if (state.onSubmenu) state.onSubmenu(section, pane);
          if (state.block === section) return;
          const menu = document.createElement('div');
          menu.id = `sub-${id}`;
          menu.setAttribute('role', 'menu');
          menu.dataset.state = 'open';
          row.setAttribute('aria-controls', menu.id);
          const choices =
            section === 'model'
              ? records.map((entry) => [entry.model, entry.displayName])
              : section === 'reasoning'
                ? (config.model === 'alpha' ? ['low', 'high'] : ['medium', 'high']).map((key) => [
                    key,
                    key,
                  ])
                : [
                    ['standard', 'Standard'],
                    ['fast', 'Fast'],
                  ];
          for (const [key, title] of choices) {
            const item = document.createElement('div');
            item.setAttribute('role', 'menuitem');
            item.textContent = title;
            if (state.disabled === `${section}:${key}`) item.setAttribute('aria-disabled', 'true');
            item.addEventListener('click', () => {
              state.clicks.push({ id, action: `select:${section}:${key}` });
              clearMenus();
              const commit = () => {
                if (state.reject === section) return;
                config[section] = key;
                if (section === 'model') {
                  config.reasoning = key === 'beta' ? 'medium' : 'low';
                  config.speed = 'standard';
                }
                state.changes.push({ id, ...config });
                render();
              };
              if (state.delay) setTimeout(commit, state.delay);
              else commit();
              if (state.onSelect) state.onSelect(section, pane);
            });
            menu.append(item);
          }
          document.body.append(menu);
        });
      }
      main.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          state.clicks.push({ id, action: 'close' });
          clearMenus();
        }
      });
      document.body.append(main);
      trigger.setAttribute('aria-controls', main.id);
      main.focus();
    };
    trigger.addEventListener('pointerdown', () => {
      state.triggerEvents++;
      if (state.openDelay) setTimeout(open, state.openDelay);
      else open();
    });
    return pane;
  };
  addChat('chat-a');
  if (options.two) addChat('chat-b');
  if (options.inherited)
    window.__codexPlusQuickModelPresets = {
      getModelListCache: () => records,
      destroy: () => {
        throw new Error('must not disable legacy');
      },
    };
}
