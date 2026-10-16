/* [INPUT]: Shared model editor, serialized save queue, saved-connection model API and free-text dropdown.
 * [OUTPUT]: One directly visible model form in both modes, retaining credentials/drafts across navigation; advanced limits remain collapsible.
 * [POS]: Settings presentation only; prompt optimization and next steps share the configured model.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useRef, useState } from 'react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Card } from './components/ui/card';
import { NativeSelect } from './components/ui/native-select';
import { SuggestionInput } from './components/ui/suggestion-input';
import { Field } from './settings-controls';
import { request, type EditableSettings } from './api';
import type { SettingsEditor } from './use-settings-form';
import { Icon } from '../shared/icons/react';
export function ModelSettings({
  editor,
  notify,
  simple,
}: {
  editor: SettingsEditor;
  notify: (text: string, failed?: boolean) => void;
  simple: boolean;
}) {
  const {
    form,
    saved,
    change,
    dirty,
    save,
    remoteChanged,
    apiKey,
    clearKey,
    setApiKey,
    setClearKey,
  } = editor;
  const [showKey, setShowKey] = useState(false),
    [busy, setBusy] = useState('');
  const [catalog, setCatalog] = useState<{
    revision: number;
    models: string[];
    loading: boolean;
    message?: string;
  } | null>(null);
  const modelRequest = useRef(0);
  const connectionDirty =
    !!form &&
    !!saved &&
    (!!apiKey ||
      clearKey ||
      remoteChanged ||
      editor.saving ||
      (['provider', 'protocol', 'baseUrl', 'apiKeyEnv'] as const).some(
        (key) => form[key] !== saved[key],
      ));
  const currentCatalog = catalog?.revision === saved?.configurationRevision ? catalog : null;
  async function readModels() {
    if (!saved || connectionDirty || currentCatalog?.loading) return;
    const requestId = ++modelRequest.current;
    const revision = saved.configurationRevision;
    setCatalog({ revision, models: [], loading: true });
    try {
      const result = await request<{ models: string[] }>('settings/models');
      if (modelRequest.current !== requestId) return;
      setCatalog({
        revision,
        models: result.models,
        loading: false,
        message:
          result.models.length > 0
            ? undefined
            : saved.provider === 'codex'
              ? '当前登录未返回候选，可留空沿用当前模型，或直接输入模型 ID。'
              : '服务未返回模型列表，可直接输入模型 ID。',
      });
    } catch (error) {
      if (modelRequest.current !== requestId) return;
      setCatalog({
        revision,
        models: [],
        loading: false,
        message: `${(error as Error).message}。可直接输入模型 ID，或重新展开重试。`,
      });
    }
  }
  async function run(name: string, action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(name);
    try {
      await action();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy('');
    }
  }
  async function test() {
    if (dirty) await save();
    const r = await request<{ items: unknown[]; generationAttempted: boolean }>(
      'settings/test',
      {},
    );
    notify(
      r.generationAttempted === false
        ? '示例没有合适方向，生成服务尚未验证。'
        : `连接正常，已生成 ${r.items.length} 条测试建议。`,
    );
  }
  if (!form || !saved) return null;
  return (
    <>
      <Card tabIndex={-1} id="settings-model" aria-labelledby="model-title">
        <div className="settings-model-editor">
          <div>
            <h2 id="model-title" hidden={simple}>
              生成模型
            </h2>
            {saved.environmentOverrides.length > 0 && (
              <div className="mb-4 rounded-[9px] border border-notice-border bg-notice px-[13px] py-[11px] text-[14px] leading-[1.8] text-notice-foreground [overflow-wrap:anywhere]">
                当前进程环境变量优先：{saved.environmentOverrides.join('、')}
                。修改对应字段后需去掉环境覆盖并重启。
              </div>
            )}
            <Field id="provider" label="模型来源">
              <NativeSelect
                id="provider"
                value={form.provider}
                onChange={(e) => change('provider', e.target.value as 'codex' | 'api')}
              >
                <option value="codex">现有 Codex 登录</option>
                <option value="api">指定 API</option>
              </NativeSelect>
            </Field>
            {form.provider === 'api' && (
              <>
                <div hidden={simple}>
                  <Field id="protocol" label="API 协议">
                    <NativeSelect
                      id="protocol"
                      value={form.protocol}
                      onChange={(e) =>
                        change('protocol', e.target.value as EditableSettings['protocol'])
                      }
                    >
                      <option value="responses">OpenAI Responses</option>
                      <option value="chat_completions">Chat Completions</option>
                      <option value="anthropic_messages">Anthropic Messages</option>
                      <option value="auto">自动识别</option>
                    </NativeSelect>
                  </Field>
                </div>
                <Field id="base-url" label="API 地址">
                  <Input
                    id="base-url"
                    type="url"
                    value={form.baseUrl}
                    onChange={(e) => change('baseUrl', e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    spellCheck={false}
                  />
                </Field>
                <Field id="api-key" label="API 密钥">
                  <div className="relative flex items-center [&_input]:pr-[43px]">
                    <Input
                      id="api-key"
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        setClearKey(false, false);
                      }}
                      placeholder={saved.storedApiKey ? '已保存 · 留空保留' : '输入 API key'}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-1"
                      aria-label={showKey ? '隐藏密钥' : '显示密钥'}
                      onClick={() => setShowKey(!showKey)}
                    >
                      {showKey ? <Icon name="eye-off" /> : <Icon name="eye" />}
                    </Button>
                  </div>
                </Field>
                {saved.storedApiKey && (
                  <label
                    hidden={simple}
                    className="-mt-1.5 mb-5 flex items-center gap-1.5 text-[14px] text-muted-foreground [&_input]:accent-primary"
                  >
                    <input
                      type="checkbox"
                      checked={clearKey}
                      onChange={(e) => {
                        setClearKey(e.target.checked);
                      }}
                    />
                    保存时清除已存密钥
                  </label>
                )}
                <div hidden={simple}>
                  <Field
                    id="api-key-env"
                    label="密钥环境变量名（可选）"
                    hint="填变量名，不是密钥。后台读到非空值时优先使用；直接填写 API 密钥可留空。"
                  >
                    <Input
                      id="api-key-env"
                      value={form.apiKeyEnv}
                      onChange={(e) => change('apiKeyEnv', e.target.value)}
                      placeholder="CODEX_BUDDY_API_KEY"
                      spellCheck={false}
                    />
                  </Field>
                </div>
              </>
            )}
            <Field id="model" label="模型名称">
              <SuggestionInput
                id="model"
                value={form.model}
                options={connectionDirty ? [] : currentCatalog?.models || []}
                onValueChange={(value) => change('model', value)}
                placeholder={form.provider === 'codex' ? '沿用当前模型' : '模型 ID'}
                spellCheck={false}
                dropdown={{
                  label: '选择模型',
                  onOpen: () => void readModels(),
                  loading: !connectionDirty && currentCatalog?.loading,
                  message: connectionDirty
                    ? '请先保存连接配置，再读取模型列表；也可直接输入模型 ID。'
                    : currentCatalog?.message,
                }}
              />
            </Field>
            <div className="mt-5 flex flex-wrap items-center gap-4">
              {!saved.available && <p className="settings-error">{saved.reason || '等待配置'}</p>}
              <Button
                type="button"
                variant="outline"
                disabled={!!busy || remoteChanged}
                onClick={() => void run('test', test)}
              >
                {busy === 'test' ? (
                  <Icon name="refresh" className="animate-spin [animation-duration:1.2s]" />
                ) : (
                  <Icon name="connection" />
                )}
                {busy === 'test' ? '正在测试…' : dirty ? '保存并测试' : '测试连接'}
              </Button>
            </div>
          </div>
        </div>
      </Card>
      <details id="settings-limits" className="settings-section" hidden={simple}>
        <summary>高级生成设置</summary>
        <div className="space-y-5">
          <Field id="context-scope" label="输入上下文" hint="最近一次提问与回答，不包含更早历史。">
            <NativeSelect
              id="context-scope"
              value={form.maxInputChars === 0 ? 'latest' : 'limited'}
              onChange={(e) => change('maxInputChars', e.target.value === 'latest' ? 0 : 12000)}
            >
              <option value="latest">最近一次聊天（完整）</option>
              <option value="limited">自定义字符上限</option>
            </NativeSelect>
          </Field>
          {form.maxInputChars !== 0 && (
            <Field id="max-input" label="输入字符上限">
              <Input
                id="max-input"
                type="number"
                min="500"
                max="32000"
                step="100"
                value={form.maxInputChars}
                onChange={(e) => change('maxInputChars', Number(e.target.value))}
              />
            </Field>
          )}
          {form.provider === 'api' && (
            <Field id="max-output" label="输出 token 上限">
              <Input
                id="max-output"
                type="number"
                min="128"
                max="16000"
                step="1"

                value={form.maxOutputTokens}
                onChange={(e) => change('maxOutputTokens', Number(e.target.value))}
              />
            </Field>
          )}
          <Field id="timeout" label="请求超时（秒）">
            <Input
              id="timeout"
              type="number"
              min="1"
              max="300"
              value={form.timeoutMs / 1000}
              onChange={(e) => change('timeoutMs', Number(e.target.value) * 1000)}
            />
          </Field>
        </div>
      </details>
    </>
  );
}
