/*
 * [INPUT]: 共用设置草稿、版本化保存队列和判断服务凭据状态。
 * [OUTPUT]: 三种方向来源、方向位置、方向库编辑和可关闭的 Jev 配置。
 * [POS]: Web 设置中的 Stepwise 方向配置，不在日常面板增加控制项。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { useState } from 'react';
import { ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { Card } from './components/ui/card';
import { Input } from './components/ui/input';
import { Button } from './components/ui/button';
import { NativeSelect } from './components/ui/native-select';
import type { EditableSettings, Settings } from '../contracts';

type Props = {
  form: EditableSettings;
  saved: Settings;
  change: <K extends keyof EditableSettings>(key: K, value: EditableSettings[K]) => void;
  schedule: () => void;
  apiKey: string;
  clearKey: boolean;
  setApiKey: (value: string) => void;
  setClearKey: (value: boolean) => void;
};
const labelClass = 'mb-2 block text-xs font-medium';
export function DirectionSettings({
  form,
  saved,
  change,
  schedule,
  apiKey,
  clearKey,
  setApiKey,
  setClearKey,
}: Props) {
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
  function remove(id: string) {
    change(
      'directionLibrary',
      library.filter((d) => d.id !== id),
    );
    change(
      'selectedDirections',
      form.selectedDirections.filter((selected) => selected !== id),
    );
    schedule();
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
      <p className="my-3 text-xs text-muted-foreground">
        {form.directionSource === 'auto'
          ? '根据最近一问一答自由探索，不受方向库限制。'
          : form.directionSource === 'manual'
            ? '按所选方向生成具体提问；不适用的方向会跳过。'
            : 'Jev 仅判断候选方向是否适用；具体提问由你配置的生成模型撰写。'}
      </p>
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
              <label htmlFor={`direction-slot-${index}`} className="shrink-0 text-xs">
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
                <ArrowUp size={16} />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`下移方向 ${index + 1}`}
                disabled={index === form.selectedDirections.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={16} />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`移除方向位置 ${index + 1}`}
                onClick={() => slots(form.selectedDirections.filter((_, i) => i !== index))}
              >
                <Trash2 size={16} />
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
              disabled={!adding || form.selectedDirections.length >= 6}
              onClick={() => {
                slots([...form.selectedDirections, adding]);
                setAdding('');
              }}
            >
              加入
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {form.selectedDirections.length
              ? `最多 ${form.selectedDirections.length} 条，按位置排序。`
              : '请选择至少一个方向后再生成。'}
          </p>
        </div>
      )}
      {form.directionSource !== 'auto' && (
        <details className="mt-5" open={form.directionSource === 'smart' || undefined}>
          <summary className="cursor-pointer text-xs font-medium">编辑方向库</summary>
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`删除方向 ${item.name}`}
                    onClick={() => remove(item.id)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
                <textarea
                  required
                  maxLength={4000}
                  aria-label={`倾向说明 ${index + 1}`}
                  className="w-full min-h-20 rounded-md border border-input bg-background px-3 py-2 text-xs leading-relaxed focus-visible:outline-2 focus-visible:outline-ring"
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
              disabled={library.length >= 24}
              onClick={() =>
                change('directionLibrary', [
                  ...library,
                  { id: `custom-${crypto.randomUUID()}`, name: '', instruction: '', enabled: true },
                ])
              }
            >
              添加自定义方向
            </Button>
          </div>
        </details>
      )}
      {form.directionSource === 'smart' && (
        <div className="mt-5 space-y-4 border-t border-border pt-5">
          <label className="flex gap-2 text-xs leading-relaxed">
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
          <div>
            <label className={labelClass} htmlFor="jev-key">
              Jev API 密钥
            </label>
            <Input
              id="jev-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              placeholder={saved.jevKeyConfigured ? '已配置 · 留空保留' : '输入独立 API key'}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          {saved.storedJevApiKey && (
            <label className="flex gap-2 text-xs">
              <input
                type="checkbox"
                checked={clearKey}
                onChange={(e) => setClearKey(e.target.checked)}
              />
              清除已存 Jev 密钥
            </label>
          )}
          <p className="text-xs text-muted-foreground">
            {saved.directionSource !== 'smart' || !saved.jev.consent
              ? '智能挑选未启用，不会发送判断请求。'
              : saved.jevKeyConfigured
                ? '凭据已配置，实际连接由上方「测试连接」验证。'
                : '尚未连接：可保存密钥，或在后台环境设置 TYPESAFE_API_KEY。'}
          </p>
        </div>
      )}
    </Card>
  );
}
