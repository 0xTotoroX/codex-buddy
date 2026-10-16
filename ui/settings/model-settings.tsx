/* [INPUT]: Shared model editor, serialized save queue and free-text suggestion control.
 * [OUTPUT]: One model form for simple and detailed settings, retaining credentials/drafts while hidden.
 * [POS]: Settings presentation only; prompt optimization and next steps share the configured model.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { SettingsDisclosure } from './settings-disclosure';
import { useState } from 'react';
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
    [models, setModels] = useState<string[]>([]),
    [busy, setBusy] = useState('');
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
        <div hidden={!simple} className="settings-model-summary">
          <span>{form.model || saved.model || '沿用 Codex 当前模型'}</span>
          <span className="settings-hint">
            {dirty ? '编辑中' : saved.available ? '已配置' : '待配置'}
          </span>
        </div>
        <p className="settings-hint settings-model-purpose">用于下一步建议与提示词优化</p>
        <SettingsDisclosure className="settings-model-editor" forceOpen={simple ? undefined : true}>
          <summary hidden={!simple}>更改模型</summary>
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
                <Field id="base-url" label="API 地址" hint="填写 API 根地址或完整请求端点。">
                  <Input
                    id="base-url"
                    type="url"
                    value={form.baseUrl}
                    onChange={(e) => change('baseUrl', e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    spellCheck={false}
                  />
                </Field>
                <Field
                  id="api-key"
                  label="API 密钥"
                  hint={
                    saved.apiKeyConfigured
                      ? '已配置。留空保留现有密钥，保存后不会回显。'
                      : '密钥只保存在本机后台，桌面浮窗不会收到密钥。'
                  }
                >
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
                    label="或使用密钥环境变量"
                    hint="填写变量名，读取后台进程的环境；环境值优先于已存密钥。"
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
            <Field
              id="model"
              label="模型名称"
              hint={
                form.provider === 'codex'
                  ? '留空沿用 Codex 当前模型。'
                  : '可以手动输入，或保存连接后读取可用模型。'
              }
            >
              <div className="relative flex items-center [&_input]:pr-[110px]">
                <SuggestionInput
                  id="model"
                  value={form.model}
                  options={models}
                  onValueChange={(value) => change('model', value)}
                  placeholder={form.provider === 'codex' ? '沿用当前模型' : '模型 ID'}
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="absolute right-[5px]"
                  disabled={!!busy || dirty}
                  onClick={() =>
                    void run('models', async () => {
                      const result = await request<{ models: string[] }>('settings/models');
                      setModels(result.models);
                      notify(`已读取 ${result.models.length} 个模型，可在模型输入框中选择。`);
                    })
                  }
                >
                  <Icon
                    name="refresh"
                    className={busy === 'models' ? 'animate-spin [animation-duration:1.2s]' : ''}
                  />
                  读取模型
                </Button>
              </div>
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
            <p className="mt-[7px] text-[14px] leading-[1.7] text-muted-foreground">
              连接测试使用固定示例，不读取你的聊天。
            </p>
          </div>
        </SettingsDisclosure>
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
