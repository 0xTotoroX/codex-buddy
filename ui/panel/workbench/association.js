/*
 * [INPUT]: 宿主关联状态或只读浮窗投影、现有受限命令通道。
 * [OUTPUT]: 隐藏的来源文字与跟随/锁定菜单及统一关联操作；保留已有状态。
 * [POS]: 来源菜单；不扫描聊天、不保存布局，也不控制窗口置顶。
 * [PROTOCOL]: 变更时检查 workbench/AGENTS.md。
 */
import { iconSvg } from '../icons/index.js';
import { IS_POPOUT } from '../runtime/constants.js';
import { changeChatBinding } from '../host/context.js';
import { remotePanelAction } from '../popout/transport.js';

export function installAssociation(header) {
  const holder = header.querySelector('.csw-workbench-source');
  holder.id = 'csw-association-source';
  holder.hidden = true;
  holder.insertAdjacentHTML(
    'afterend',
    `<details class="csw-association-menu" hidden><summary role="button" aria-label="聊天关联" aria-describedby="csw-association-source">聊天关联${iconSvg('chevron-down')}</summary><div class="csw-layout-options" role="group" aria-label="聊天关联模式"><button type="button" data-association="follow">跟随当前聊天</button><button type="button" data-association="lock">锁定到此聊天</button><button type="button" data-association="current">改为锁定当前选中的聊天</button><span class="csw-association-hint" role="status"></span></div></details>`,
  );
  const menu = header.querySelector('.csw-association-menu');
  menu.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-association]');
    if (!button || button.disabled) return;
    const action = button.dataset.association;
    const sessionId = button.dataset.sessionId;
    menu.open = false;
    if (IS_POPOUT) void remotePanelAction('association', { action, sessionId });
    else changeChatBinding(action, sessionId);
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    menu.open = false;
    menu.querySelector('summary').focus();
    event.stopPropagation();
  });
}

export function updateAssociation(header, source) {
  const status = source?.association;
  const menu = header.querySelector('.csw-association-menu');
  const label = header.querySelector('.csw-workbench-source');
  label.textContent = source?.sourceLabel || 'Codex · 等待聊天';
  label.title = label.textContent;
  const locked = status?.mode === 'locked';
  const available = status?.available !== false;
  menu.dataset.unavailable = String(!available);
  for (const button of menu.querySelectorAll('[data-association]')) {
    const action = button.dataset.association;
    button.setAttribute(
      'aria-pressed',
      String(action === 'follow' ? !locked : action === 'lock' && locked),
    );
    button.disabled =
      !source ||
      (action === 'lock' && (!status?.canLock || !available)) ||
      (action === 'current' && !status?.canRetarget);
    button.hidden = action === 'current' && !locked;
    button.dataset.sessionId =
      action === 'current' ? status?.selectedSessionId || '' : source?.context?.sessionId || '';
  }
  menu.querySelector('.csw-association-hint').textContent = !available
    ? '来源暂不可用，恢复前仅供查看。'
    : !status?.canLock
      ? '当前聊天尚无可确认的身份。'
      : '';
}
