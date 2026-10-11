/* [INPUT]: Shared settings editor, direction credentials and appearance preferences.
 * [OUTPUT]: Advanced next-step directions, quick prompts and click/display options.
 * [POS]: Functional settings only; shared model configuration lives in model-settings.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Card } from './components/ui/card';
import type { View } from './api';
import type { SettingsEditor } from './use-settings-form';
import { Icon } from '../shared/icons/react';
import { DirectionSettings } from './direction-settings';
import { PanelSettings } from './panel-settings';
export function NextSettings({
  editor,
  appearance,
}: {
  editor: SettingsEditor;
  appearance?: View['panelPreferences'];
}) {
  const { form, saved, change, schedule, jevApiKey, clearJevKey, setJevApiKey, setClearJevKey } =
    editor;
  if (!form || !saved) return null;
  return (
    <>
      <section className="settings-section">
        <h2>下一步交互</h2>
        <PanelSettings value={appearance} section="next" />
      </section>
      <DirectionSettings
        form={form}
        saved={saved}
        change={change}
        schedule={schedule}
        apiKey={jevApiKey}
        clearKey={clearJevKey}
        setApiKey={setJevApiKey}
        setClearKey={setClearJevKey}
      />
      <Card tabIndex={-1} id="settings-quick-prompts" aria-labelledby="quick-prompts-title">
        <h2 id="quick-prompts-title" className="mb-2 text-[15px] font-semibold">
          常用提示词
        </h2>
        <p className="mb-4 text-[14px] text-muted-foreground">
          显示在下一步面板中，点击只填入，不自动发送。
        </p>
        <div className="space-y-3">
          {form.quickPrompts.map((item, index) => (
            <div
              key={index}
              className="grid grid-cols-[120px_minmax(0,1fr)_auto] gap-3 items-start max-[600px]:grid-cols-[minmax(0,1fr)_auto] [&>textarea]:max-[600px]:col-span-full [&>textarea]:max-[600px]:row-start-2"
            >
              <Input
                aria-label={`常用提示词 ${index + 1} 名称`}
                value={item.label}
                maxLength={20}
                required
                onChange={(e) =>
                  change(
                    'quickPrompts',
                    form.quickPrompts.map((p, i) =>
                      i === index ? { ...p, label: e.target.value } : p,
                    ),
                  )
                }
              />
              <textarea
                aria-label={`常用提示词 ${index + 1} 内容`}
                value={item.prompt}
                maxLength={4000}
                required
                rows={2}
                className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-[14px]"
                onChange={(e) =>
                  change(
                    'quickPrompts',
                    form.quickPrompts.map((p, i) =>
                      i === index ? { ...p, prompt: e.target.value } : p,
                    ),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                aria-label={`删除常用提示词 ${index + 1}`}
                onClick={() => {
                  change(
                    'quickPrompts',
                    form.quickPrompts.filter((_, i) => i !== index),
                  );
                  schedule();
                }}
              >
                删除
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={form.quickPrompts.length >= 8}
            onClick={() =>
              change('quickPrompts', [...form.quickPrompts, { label: '', prompt: '' }])
            }
          >
            添加提示词
          </Button>
        </div>
      </Card>
    </>
  );
}
