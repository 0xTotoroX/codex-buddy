/* [INPUT]: Independent task API and shared settings controls.
 * [OUTPUT]: Board/sync switches, explicit authorization and single-list binding.
 * [POS]: Task settings do not modify model-control or workbench preferences.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useState } from 'react';
import { Button } from './components/ui/button';
import { Switch } from './components/ui/switch';
import { NativeSelect } from './components/ui/native-select';
import { useTasks, type Bindings, type Calendar } from '../board/api';
export function TaskSettings() {
  const { state, error, busy, command } = useTasks(true);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [bindings, setBindings] = useState<Bindings | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  async function load(op: string) {
    const result = await command<{ calendars: Calendar[] }>({ op });
    if (result?.calendars) {
      setCalendars(result.calendars);
      setBindings(state?.store.bindings ?? { calendarId: '' });
    }
  }
  const chosen = bindings ?? state?.store.bindings ?? { calendarId: '' };
  const currentId = state?.store.bindings.calendarId ?? '';
  const hasLinks = state?.store.tasks.some((t) => t.remote !== null);
  const needsRepair =
    !!currentId && calendars.length > 0 && !calendars.some((c) => c.id === currentId && c.writable);
  const locked =
    !!state?.store.syncEnabled ||
    (!!state?.store.inflight && !!currentId) ||
    (!!hasLinks && !!currentId && !needsRepair);
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
        一个列表，只同步标题、备注和完成状态。待办、进行中和归档仅在 Buddy
        内管理；归档不会删除提醒事项。
      </p>
      {!currentId && hasLinks && (
        <p className="text-xs text-muted-foreground">
          旧同步已暂停，所有任务和关联已保留。请先在 Apple
          提醒事项中将原列表的任务移入一个列表，再在这里选择它。未找到的任务保留本地，不会自动重建。
        </p>
      )}
      {state?.store.inflight?.action === 'create' && (
        <p className="text-xs text-muted-foreground">
          此前创建结果尚未确认，请先在看板中核对恢复记录。
        </p>
      )}
      {calendars.length > 0 && (
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-4 text-sm">
            同步列表
            <NativeSelect
              aria-label="同步列表"
              disabled={busy || locked}
              value={chosen.calendarId}
              onChange={(e) => {
                setBindings({ calendarId: e.target.value });
                setConfirmed(false);
              }}
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
          {!locked && (
            <>
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                我确认这是要同步的 iCloud 列表；启用后会导入其中的任务，并同步本地未归档任务。
              </label>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !confirmed || !chosen.calendarId}
                onClick={() =>
                  void command({
                    op: needsRepair ? 'repairBindings' : 'bindings',
                    bindings: chosen,
                    iCloudConfirmed: true,
                    confirmRepair: needsRepair,
                  })
                }
              >
                {needsRepair ? '保存替代列表' : '保存列表'}
              </Button>
            </>
          )}
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
