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
      if (options.unknownMenu) {
        main.textContent = 'An unsupported future picker';
      } else if (options.modern) {
        const draw = (view = 'simple') => {
          main.replaceChildren();
          const root = document.createElement('div');
          root.dataset.modelPickerView = view;
          main.append(root);
          const inactive = document.createElement('div');
          inactive.dataset.modelPickerView = view === 'simple' ? 'advanced' : 'simple';
          inactive.setAttribute('aria-hidden', 'true');
          inactive.inert = true;
          inactive.innerHTML =
            '<div role="menuitemradio" data-model-selected="true">Hidden model</div>';
          main.append(inactive);
          if (view === 'advanced') {
            for (const model of records) {
              const choice = document.createElement('div');
              choice.setAttribute('role', 'menuitemradio');
              choice.setAttribute('aria-checked', String(config.model === model.model));
              if (config.model === model.model) choice.dataset.modelSelected = 'true';
              if (options.lockedModel === model.model)
                choice.setAttribute('aria-describedby', 'locked-help');
              choice.innerHTML = `<span>${model.displayName}</span>`;
              choice.addEventListener('click', () => {
                state.explicitModel = true;
                config.model = model.model;
                config.reasoning = model.supportedReasoningEfforts.map((effort) =>
                  typeof effort === 'string' ? effort : effort.reasoningEffort,
                )[0];
                config.speed = 'standard';
                state.changes.push({ id, ...config });
                render();
                draw();
              });
              root.append(choice);
            }
          } else {
            const toggle = document.createElement('div');
            toggle.setAttribute('role', 'menuitem');
            toggle.dataset.modelPickerViewToggle = 'true';
            toggle.textContent = '选择模型';
            toggle.addEventListener('click', () => draw('advanced'));
            root.append(toggle);
            const slider = document.createElement('div');
            slider.setAttribute('role', 'menuitem');
            slider.dataset.reasoningSlider = 'true';
            slider.textContent = 'Power';
            slider.addEventListener('keydown', (e) => {
              if (options.defaultRecommendation && !state.explicitModel) config.model = 'beta';
              const efforts = records
                .find((m) => m.model === config.model)
                .supportedReasoningEfforts.map((effort) =>
                  typeof effort === 'string' ? effort : effort.reasoningEffort,
                );
              const current = efforts.indexOf(config.reasoning);
              const next = current + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0);
              if (next >= 0 && next < efforts.length && next !== current) {
                config.reasoning = efforts[next];
                state.changes.push({ id, ...config });
                render();
                draw();
              }
            });
            root.append(slider);
            if (config.model !== 'beta') {
              const fast = document.createElement('div');
              fast.setAttribute('role', 'menuitemcheckbox');
              fast.setAttribute('aria-checked', String(config.speed === 'fast'));
              fast.dataset.fastModeEnabled = String(config.speed === 'fast');
              fast.textContent = 'Fast';
              fast.addEventListener('click', () => {
                config.speed = config.speed === 'fast' ? 'standard' : 'fast';
                state.changes.push({ id, ...config });
                render();
                draw();
              });
              root.append(fast);
            }
          }
        };
        draw();
      } else
        for (const section of ['model', 'reasoning', 'speed']) {
          if (section === 'speed' && config.model === 'beta') continue;
          const row = document.createElement('div');
          row.setAttribute('role', 'menuitem');
          row.setAttribute('aria-haspopup', 'menu');
          row.tabIndex = -1;
          row.textContent = `${section} ${section === 'model' ? records.find((entry) => entry.model === config.model).displayName : config[section]}`;
          if (section === 'model' && options.inlineModel) {
            row.textContent = records.find((entry) => entry.model === config.model).displayName;
            row.dataset.modelPickerModelRow = 'true';
          }
          main.append(row);
          row.addEventListener('click', () => {
            state.clicks.push({ id, action: section });
            if (state.onSubmenu) state.onSubmenu(section, pane);
            if (state.block === section) return;
            const menu = document.createElement('div');
            menu.id = `sub-${id}`;
            const inline =
              (options.inlineModel && section === 'model') ||
              (options.flatReasoning && section === 'reasoning');
            if (!inline) menu.setAttribute('role', 'menu');
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
              if (state.disabled === `${section}:${key}`)
                item.setAttribute('aria-disabled', 'true');
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
            (inline ? main : document.body).append(menu);
          });
          if (options.flatReasoning && section === 'reasoning') {
            row.click();
            row.remove();
          }
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
