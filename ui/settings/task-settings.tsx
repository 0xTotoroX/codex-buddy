/* [INPUT]: Independent task API and shared settings controls.
 * [OUTPUT]: Board/sync switches, explicit authorization and three-list binding.
 * [POS]: Task settings do not modify model-control or workbench preferences.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useState } from 'react';
import { Button } from './components/ui/button';
import { Switch } from './components/ui/switch';
import { NativeSelect } from './components/ui/native-select';
import { columns, useTasks, type Bindings, type Calendar } from '../board/api';
export function TaskSettings() {
  const { state, error, busy, command } = useTasks();
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [bindings, setBindings] = useState<Bindings | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [source, setSource] = useState('');
  async function load(op: string) {
    const result = await command<{ calendars: Calendar[] }>({ op });
    if (result?.calendars) {
      setCalendars(result.calendars);
      setBindings(state?.store.bindings ?? { todo: '', doing: '', waiting: '' });
    }
  }
  const hasLinks = state?.store.tasks.some((t) => t.remote !== null) || !!state?.store.inflight;
  const isUnavailable = (id: string) => !calendars.some((c) => c.id === id && c.writable);
  const needsRepair =
    !!hasLinks &&
    calendars.length > 0 &&
    Object.values(state?.store.bindings ?? {}).some(isUnavailable);
  const pendingCreate = state?.store.inflight?.action === 'create';
  const chosen = bindings ?? state?.store.bindings ?? { todo: '', doing: '', waiting: '' };
  const sources = [
    ...new Map(
      calendars
        .filter((c) => c.writable)
        .map((c) => [c.source, { id: c.source, title: c.sourceTitle }]),
    ).values(),
  ];
  return (
    <section id="settings-tasks" className="space-y-5 rounded-2xl border border-border bg-card p-6">
      <div>
        <h2 className="text-base font-semibold">任务看板与提醒事项</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          独立看板窗口与 Apple 同步分别启停。关闭窗口不影响同步，停用保留任务。
        </p>
      </div>
      <div className="flex items-center justify-between gap-4">
        <label htmlFor="board-enabled" className="text-sm">
          任务看板
        </label>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !state?.store.boardEnabled}
            onClick={() => void command({ op: 'open' })}
          >
            打开看板
          </Button>
          <Switch
            id="board-enabled"
            checked={state?.store.boardEnabled ?? false}
            disabled={busy || !state || !!state.error}
            onCheckedChange={(boardEnabled) => void command({ op: 'modules', boardEnabled })}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <label htmlFor="reminders-enabled" className="text-sm">
          Apple 提醒事项同步
        </label>
        <Switch
          id="reminders-enabled"
          checked={state?.store.syncEnabled ?? false}
          disabled={busy || !state || !!state.error}
          onCheckedChange={(syncEnabled) => void command({ op: 'modules', syncEnabled })}
        />
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {state?.status ?? '正在读取任务设置…'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void load('authorize')}>
          {busy ? '处理中…' : '授权并选择列表'}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void load('calendars')}>
          刷新列表
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        仅同步你绑定的三个列表，不读取其他列表的任务，不发送给模型。请选择同一 iCloud
        账户下的可写列表；已完成事项汇总为看板的“已完成”。
      </p>
      {calendars.length > 0 && (
        <div className="space-y-4 rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground">
            {needsRepair
              ? '绑定列表已失效。暂停同步后可替换失效列表；原任务保留，重新同步后逐项核对。'
              : '先暂停同步，再绑定列表。已有任务关联后，正常列表绑定会锁定以保护数据。'}
          </p>
          {(!hasLinks || needsRepair) && !state?.store.syncEnabled && !pendingCreate && (
            <div className="flex flex-wrap gap-2">
              <NativeSelect
                aria-label="创建列表的账户"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="">选择 iCloud 账户</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </NativeSelect>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !source}
                onClick={async () => {
                  if (
                    !confirm(
                      '确认所选账户是 iCloud？将在该账户创建或使用 Buddy · 待办、Buddy · 进行中、Buddy · 等待三个列表。',
                    )
                  )
                    return;
                  const result = await command<{ calendars: Calendar[]; bindings: Bindings }>({
                    op: 'createLists',
                    source,
                    iCloudConfirmed: true,
                  });
                  if (result) {
                    setCalendars(result.calendars);
                    setBindings(
                      needsRepair
                        ? (Object.fromEntries(
                            Object.entries(state!.store.bindings).map(([key, id]) => [
                              key,
                              isUnavailable(id) ? result.bindings[key as keyof Bindings] : id,
                            ]),
                          ) as Bindings)
                        : result.bindings,
                    );
                    setConfirmed(true);
                  }
                }}
              >
                创建专用列表
              </Button>
            </div>
          )}
          {columns.slice(0, 3).map((c) => (
            <label key={c.id} className="flex items-center justify-between gap-4 text-sm">
              <span>{c.title}</span>
              <NativeSelect
                aria-label={`${c.title}对应列表`}
                disabled={
                  busy ||
                  !!pendingCreate ||
                  (!!hasLinks && !isUnavailable(state!.store.bindings[c.id as keyof Bindings])) ||
                  state?.store.syncEnabled
                }
                value={chosen[c.id as keyof Bindings]}
                onChange={(e) => setBindings({ ...chosen, [c.id]: e.target.value })}
              >
                <option value="">选择提醒事项列表</option>
                {calendars
                  .filter((c) => c.writable)
                  .map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.sourceTitle} / {list.title}
                    </option>
                  ))}
              </NativeSelect>
            </label>
          ))}
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            我确认这三个列表属于同一个 iCloud
            账户；启用后会导入列表内所有任务，并同步本地未归档任务。
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={
              busy ||
              (!!hasLinks && !needsRepair) ||
              !!pendingCreate ||
              state?.store.syncEnabled ||
              !confirmed
            }
            onClick={() => {
              if (
                needsRepair &&
                !confirm(
                  '修复失效列表后，请重新开启同步核对。原关联和本地任务会保留，未找到的任务将进入待处理，不会自动重建。确认继续？',
                )
              )
                return;
              void command({
                op: needsRepair ? 'repairBindings' : 'bindings',
                bindings: chosen,
                iCloudConfirmed: confirmed,
                confirmRepair: needsRepair,
              });
            }}
          >
            {needsRepair ? '修复失效列表绑定' : '保存列表绑定'}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
