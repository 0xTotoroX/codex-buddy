/*
 * [INPUT]: 共用设置草稿、版本化保存队列和判断服务凭据状态。
 * [OUTPUT]: 三种方向来源、直接可见的方向库、确认删除与共用 Jev 密钥管理。
 * [POS]: Web 设置中的 Stepwise 方向配置，不在日常面板增加控制项。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { useState } from 'react';
import { Icon } from '../shared/icons/react';
import { Card } from './components/ui/card';
import { Input } from './components/ui/input';
import { Button } from './components/ui/button';
import { NativeSelect } from './components/ui/native-select';
import { ModelApiKey, DeleteModelApiKey } from './model-credentials';
import { ConfirmationButton } from './settings-confirmation';
import type { SettingsEditor } from './use-settings-form';
import type { EditableSettings } from '../shared/contracts';

const labelClass = 'mb-2 block text-[14px] font-medium';
export function DirectionSettings({ editor }: { editor: SettingsEditor }) {
  const { form: draft, saved: baseline, change, schedule } = editor;
  const form = draft!,
    saved = baseline!;
  const [adding, setAdding] = useState('');
  const library = form.directionLibrary;
  function slots(ids: string[]) {
    change('selectedDirections', ids);
    schedule();
  }
  function move(index: number, delta: number) {
    const ids = [...form.selectedDirections];
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    slots(ids);
  }
  return (
    <Card tabIndex={-1} id="settings-directions" aria-labelledby="direction-title">
      <h2 id="direction-title" className="mb-5 text-[15px] font-semibold">
        建议方向
      </h2>
      <label htmlFor="direction-source" className={labelClass}>
        方向来源
      </label>
      <NativeSelect
        id="direction-source"
        value={form.directionSource}
        onChange={(e) =>
          change('directionSource', e.target.value as EditableSettings['directionSource'])
        }
      >
        <option value="auto">自动探索</option>
        <option value="manual">我来选择</option>
        <option value="smart">智能挑选（实验）</option>
      </NativeSelect>
      {form.directionSource !== 'manual' ? (
        <div className="mt-4">
          <label htmlFor="max-items" className={labelClass}>
            最多建议数量
          </label>
          <Input
            id="max-items"
            type="number"
            min="1"
            max="6"
            value={form.maxItems}
            onChange={(e) => change('maxItems', Number(e.target.value))}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {form.selectedDirections.map((id, index) => (
            <div key={id} className="flex items-center gap-2">
              <label htmlFor={`direction-slot-${index}`} className="shrink-0 text-[14px]">
                {index + 1}
              </label>
              <NativeSelect
                id={`direction-slot-${index}`}
                aria-label={`方向位置 ${index + 1}`}
                value={id}
                onChange={(e) =>
                  slots(
                    form.selectedDirections.map((current, i) =>
                      i === index ? e.target.value : current,
                    ),
                  )
                }
              >
                {library
                  .filter((d) => d.id === id || !form.selectedDirections.includes(d.id))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </NativeSelect>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`上移方向 ${index + 1}`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <Icon name="arrow-up" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`下移方向 ${index + 1}`}
                disabled={index === form.selectedDirections.length - 1}
                onClick={() => move(index, 1)}
              >
                <Icon name="arrow-down" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`移除方向位置 ${index + 1}`}
                onClick={() => slots(form.selectedDirections.filter((_, i) => i !== index))}
              >
                <Icon name="trash" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <NativeSelect
              aria-label="添加方向位置"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
            >
              <option value="">选择一个方向…</option>
              {library
                .filter((d) => !form.selectedDirections.includes(d.id))
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </NativeSelect>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="加入"
              disabled={!adding || form.selectedDirections.length >= 6}
              onClick={() => {
                slots([...form.selectedDirections, adding]);
                setAdding('');
              }}
            >
              <Icon name="plus" />
            </Button>
          </div>
          <p className="text-[14px] text-muted-foreground">
            {form.selectedDirections.length
              ? `最多 ${form.selectedDirections.length} 条，按位置排序。`
              : '请选择至少一个方向后再生成。'}
          </p>
        </div>
      )}
      {form.directionSource !== 'auto' && (
        <section className="mt-5">
          <h3 className="text-[14px] font-medium">方向库</h3>
          <div className="mt-4 space-y-5">
            {library.map((item, index) => (
              <div key={item.id} className="space-y-2 border-b border-border pb-4">
                <div className="flex items-center gap-2">
                  {form.directionSource === 'smart' && (
                    <input
                      type="checkbox"
                      aria-label={`启用方向 ${item.name}`}
                      checked={item.enabled}
                      onChange={(e) => {
                        change(
                          'directionLibrary',
                          library.map((d) =>
                            d.id === item.id ? { ...d, enabled: e.target.checked } : d,
                          ),
                        );
                        schedule();
                      }}
                    />
                  )}
                  <Input
                    required
                    maxLength={40}
                    aria-label={`方向名称 ${index + 1}`}
                    value={item.name}
                    onChange={(e) =>
                      change(
                        'directionLibrary',
                        library.map((d) => (d.id === item.id ? { ...d, name: e.target.value } : d)),
                      )
                    }
                  />
                  <ConfirmationButton
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`删除方向 ${item.name}`}
                    revision={saved.configurationRevision}
                    disabled={editor.saving || editor.remoteChanged}
                    title={`删除方向“${item.name || '未命名'}”？`}
                    description="会删除名称和说明，并从已选方向中移除；不会删除已生成的建议。"
                    confirmLabel="确认删除"
                    onConfirm={() =>
                      editor.removeEntry('direction', item.id, saved.configurationRevision)
                    }
                  >
                    <Icon name="trash" />
                  </ConfirmationButton>
                </div>
                <textarea
                  required
                  maxLength={4000}
                  aria-label={`倾向说明 ${index + 1}`}
                  className="w-full min-h-20 rounded-md border border-input bg-background px-3 py-2 text-[14px] leading-relaxed focus-visible:outline-2 focus-visible:outline-ring"
                  value={item.instruction}
                  onChange={(e) =>
                    change(
                      'directionLibrary',
                      library.map((d) =>
                        d.id === item.id ? { ...d, instruction: e.target.value } : d,
                      ),
                    )
                  }
                />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="添加自定义方向"
              disabled={library.length >= 24}
              onClick={() =>
                change('directionLibrary', [
                  ...library,
                  { id: `custom-${crypto.randomUUID()}`, name: '', instruction: '', enabled: true },
                ])
              }
            >
              <Icon name="plus" />
            </Button>
          </div>
        </section>
      )}
      {form.directionSource === 'smart' && (
        <div className="mt-5 space-y-4 border-t border-border pt-5">
          <label className="flex gap-2 text-[14px] leading-relaxed">
            <input
              className="mt-1 self-start"
              type="checkbox"
              checked={form.jev.consent}
              onChange={(e) => {
                change('jev', { ...form.jev, consent: e.target.checked });
                schedule();
              }}
            />
            我同意将最近一问一答发送到下方 Jev
            判断服务。它使用独立密钥和额度；切回其他模式后不再请求。
          </label>
          <div>
            <label className={labelClass} htmlFor="jev-endpoint">
              Jev 请求地址
            </label>
            <Input
              id="jev-endpoint"
              type="url"
              required
              value={form.jev.endpoint}
              onChange={(e) =>
                change('jev', { ...form.jev, endpoint: e.target.value, consent: false })
              }
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="jev-model">
              Jev 模型
            </label>
            <Input
              id="jev-model"
              required
              value={form.jev.model}
              onChange={(e) => change('jev', { ...form.jev, model: e.target.value })}
            />
          </div>
          <ModelApiKey editor={editor} busy={editor.saving} kind="jev" />
          {saved.storedJevApiKey && (
            <details className="settings-details">
              <summary>高级设置</summary>
              <DeleteModelApiKey editor={editor} busy={editor.saving} kind="jev" />
            </details>
          )}
          <p className="text-[14px] text-muted-foreground">
            {saved.directionSource !== 'smart' || !saved.jev.consent
              ? '智能挑选未启用，不会发送判断请求。'
              : saved.jevKeyConfigured
                ? '凭据已配置，可在「模型与生成」中测试连接。'
                : '尚未连接：可保存密钥，或在后台环境设置 TYPESAFE_API_KEY。'}
          </p>
        </div>
      )}
    </Card>
  );
}
