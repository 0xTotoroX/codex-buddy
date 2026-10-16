/* [INPUT]: Shared settings editor, direction credentials and appearance preferences.
 * [OUTPUT]: Separate next-step and quick-prompt pages sharing mounted drafts, stable list identity and the original save queue.
 * [POS]: Functional settings only; shared model configuration lives in model-settings.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { usePromptKeys, useSettingsListMotion } from './settings-list-motion';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Card } from './components/ui/card';
import type { View } from './api';
import type { SettingsEditor } from './use-settings-form';
import { Icon } from '../shared/icons/react';
import { ConfirmationButton } from './settings-confirmation';
import { DirectionSettings } from './direction-settings';
import { PanelSettings } from './panel-settings';
export function NextSettings({
  editor,
  appearance,
  section,
}: {
  section?: 'next' | 'prompts';
  editor: SettingsEditor;
  appearance?: View['panelPreferences'];
}) {
  const { form, saved, change } = editor;
  const listRef = useSettingsListMotion();
  const { keys: promptKeys, trackRemoval } = usePromptKeys(
    form?.quickPrompts ?? [],
    saved?.configurationRevision,
  );
  if (!form || !saved) return null;
  return (
    <>
      <div data-settings-page="next" hidden={section === 'prompts'}>
        <section className="settings-section">
          <h2>下一步交互</h2>
          <PanelSettings value={appearance} section="next" />
        </section>
        <DirectionSettings editor={editor} />
      </div>
      <div data-settings-page="prompts" hidden={section === 'next'}>
        <Card tabIndex={-1} id="settings-quick-prompts" aria-labelledby="quick-prompts-title">
          <h2
            hidden={section === 'prompts'}
            id="quick-prompts-title"
            className="mb-2 text-[15px] font-semibold"
          >
            常用提示词
          </h2>
          <div ref={listRef} data-settings-list="quick-prompts" className="space-y-3">
            {form.quickPrompts.map((item, index) => (
              <div
                key={promptKeys[index]}
                data-settings-list-item={promptKeys[index]}
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
                <ConfirmationButton
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`删除常用提示词 ${index + 1}`}
                  revision={saved.configurationRevision}
                  disabled={editor.saving || editor.remoteChanged}
                  title={`删除提示词“${item.label || '未命名'}”？`}
                  description="会删除这条常用提示词的名称与内容，其他提示词保持不变。"
                  confirmLabel="确认删除"
                  onConfirm={() =>
                    trackRemoval(index, () =>
                      editor.removeEntry('prompt', index, saved.configurationRevision),
                    )
                  }
                >
                  <Icon name="trash" />
                </ConfirmationButton>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="icon"
              data-settings-list-item="add"
              aria-label="添加提示词"
              disabled={form.quickPrompts.length >= 8}
              onClick={() =>
                change('quickPrompts', [...form.quickPrompts, { label: '', prompt: '' }])
              }
            >
              <Icon name="plus" />
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
