/*
 * [INPUT]: React、use-settings-form.ts、panel-settings.tsx、api.ts、共享 tokens.css、styles.css 与 lucide-react。
 * [OUTPUT]: 自动/手动保存的模型与完整/限长上下文表单、方向配置与常用提示词编辑、全量胶囊设置、连接状态和操作反馈。
 * [POS]: 设置页入口与视图，不接收聊天正文。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Card } from './components/ui/card';
import { NativeSelect } from './components/ui/native-select';
import { Switch } from './components/ui/switch';

import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../tokens.css';
import './styles.css';
import icon from '../icon.png';
import {
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Layers2,
  LoaderCircle,
  Monitor,
  Plug,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { request, useCompanion } from './api';
import { PanelSettings } from './panel-settings';
import { ModelControlSettings } from './model-control-settings';
import { DirectionSettings } from './direction-settings';
import { useSettingsForm } from './use-settings-form';
import type { EditableSettings, Settings } from './api';

function editable(value: Settings): EditableSettings {
  const {
    enabled,
    answerOutlineEnabled,
    generationMode,
    hostRestartPolicy,
    provider,
    protocol,
    model,
    baseUrl,
    apiKeyEnv,
    maxItems,
    directionSource,
    directionLibrary,
    selectedDirections,
    jev,
    quickPrompts,
    maxInputChars,
    maxOutputTokens,
    timeoutMs,
  } = value;
  return {
    enabled,
    answerOutlineEnabled,
    generationMode,
    hostRestartPolicy,
    provider,
    protocol,
    model,
    baseUrl,
    apiKeyEnv,
    maxItems,
    directionSource,
    directionLibrary,
    selectedDirections,
    jev,
    quickPrompts,
    maxInputChars,
    maxOutputTokens,
    timeoutMs,
  };
}

function App() {
  const { view, live, error } = useCompanion();
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [targetId, setTargetId] = useState('');
  const [connectionEdited, setConnectionEdited] = useState(false);
  const connected = live && view?.connection.status === 'connected';

  const notify = (text: string, failed = false) => {
    setMessage(text);
    setFailure(failed);
  };
  const {
    saved,
    form,
    dirty,
    remoteChanged,
    apiKey,
    clearKey,
    saving,
    load,
    change,
    save,
    schedule,
    setApiKey,
    setClearKey,
    jevApiKey,
    clearJevKey,
    setJevApiKey,
    setClearJevKey,
  } = useSettingsForm(live, view?.configurationRevision, editable, notify);
  useEffect(() => {
    if (!connectionEdited && view?.connection.endpoint) {
      setEndpoint(view.connection.endpoint);
      setTargetId(view.connection.targetId || '');
    }
  }, [view?.connection.endpoint, view?.connection.targetId, connectionEdited]);
  async function run(name: string, action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(name);
    setMessage('');
    try {
      await action();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy('');
    }
  }
  async function test() {
    if (dirty) await save();
    const result = await request<{ items: unknown[]; generationAttempted: boolean }>(
      'settings/test',
      {},
    );
    notify(
      result.generationAttempted === false
        ? 'Jev 判断成功，示例没有合适方向；生成阶段已跳过，生成服务尚未验证。'
        : `连接正常，已生成 ${result.items.length} 条测试建议。`,
    );
  }
  async function connect() {
    await request('connect', { endpoint, targetId: targetId || null });
    setConnectionEdited(false);
    notify('已连接 Codex');
  }

  return (
    <div className="mx-auto max-w-[1120px] px-10 pb-[50px] max-[850px]:px-[23px] max-[850px]:pb-10 max-[650px]:px-[18px] max-[650px]:pb-[35px]">
      <header className="flex h-[90px] items-center justify-between border-b border-border max-[650px]:h-[72px]">
        <a
          className="flex items-center gap-[11px] text-[17px] font-[650] tracking-[-0.5px]"
          href="#"
        >
          <span className="grid size-[37px] place-items-center rounded-xl border border-border bg-card shadow-[0_2px_5px_#00000003] [&>img]:size-full [&>img]:rounded-[inherit] [&>img]:object-contain">
            <img src={icon} alt="" />
          </span>
          <span>CodexBuddy{import.meta.env.DEV ? ' · 开发版' : ''}</span>
        </a>
        <span className="flex items-center gap-[7px] text-xs text-muted-foreground">
          <i
            className={`inline-block size-1.5 rounded-full ${connected ? 'bg-[#648b74]' : 'bg-[#9696a0]'}`}
          />
          {connected
            ? import.meta.env.DEV
              ? 'Codex 已连接'
              : 'Codex 已连接'
            : live
              ? '等待连接'
              : '服务未连接'}
        </span>
      </header>
      <main>
        <div className="pt-9 pb-[27px] max-[650px]:pt-[27px] max-[650px]:pb-[23px]">
          <div className="mb-3 flex items-center gap-1.5 text-[11px] tracking-[0.5px] text-muted-foreground">
            <Settings2 size={14} />
            偏好设置
          </div>
          <h1 className="text-[27px] font-semibold leading-[1.4] tracking-[-1px] max-[850px]:text-2xl max-[650px]:text-[22px] max-[650px]:tracking-[-0.7px]">
            让浮窗按你的习惯工作。
          </h1>
        </div>
        <ModelControlSettings live={live} />
        {error && (
          <div
            className="mb-4 rounded-[9px] border border-error-border bg-error px-[13px] py-[11px] text-[11px] leading-[1.8] text-error-foreground [overflow-wrap:anywhere]"
            role="alert"
          >
            {error}
          </div>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-[22px] max-[850px]:grid-cols-[minmax(0,1fr)_260px] max-[850px]:gap-[15px] max-[650px]:flex max-[650px]:flex-col max-[650px]:gap-0">
          <div className="min-w-0 max-[650px]:w-full">
            <PanelSettings
              value={view?.panelPreferences}
              theme={view?.panelTheme}
              fontBase={view?.panelFontBase}
              popoutSupported={saved?.popoutSupported === true}
              connected={!!connected}
              notify={notify}
            />
            {!form || !saved ? (
              <Card className="flex items-center gap-3 text-xs text-muted-foreground p-9">
                <LoaderCircle className="animate-spin [animation-duration:1.2s]" size={22} />
                <span>{live ? '正在读取设置…' : '等待本地服务…'}</span>
              </Card>
            ) : (
              <form
                onBlurCapture={(event) => {
                  if (!(
                    event.relatedTarget instanceof Element &&
                    event.relatedTarget.closest('button[type="submit"]')
                  ))
                    schedule(event.currentTarget);
                }}
                onChange={(event) => {
                  if (event.target instanceof HTMLSelectElement) schedule(event.currentTarget);
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  void run('save', save);
                }}
              >
                <Card aria-labelledby="features-title">
                  <div className="mb-[22px] flex items-start gap-[11px] [&_p]:mt-1 [&_p]:text-[11px] [&_p]:leading-[1.6] [&_p]:text-muted-foreground max-[650px]:[&_p]:text-[10px]">
                    <span className="grid size-[33px] shrink-0 place-items-center rounded-[10px] bg-muted text-foreground">
                      <Layers2 size={18} />
                    </span>
                    <div>
                      <h2
                        className="text-[15px] font-semibold leading-normal tracking-[-0.3px]"
                        id="features-title"
                      >
                        桌面浮窗
                      </h2>
                    </div>
                  </div>
                  <Toggle
                    label="Stepwise"
                    checked={form.enabled}
                    onChange={(value) => change('enabled', value)}
                  />
                  <Toggle
                    label="回答大纲"
                    checked={form.answerOutlineEnabled}
                    onChange={(value) => change('answerOutlineEnabled', value)}
                  />
                  <div className="pt-3">
                    <Field id="generation-mode" label="建议生成方式">
                      <NativeSelect
                        id="generation-mode"
                        value={form.generationMode}
                        onChange={(e) =>
                          change('generationMode', e.target.value as 'auto' | 'manual')
                        }
                      >
                        <option value="manual">手动刷新</option>
                        <option value="auto">自动生成</option>
                      </NativeSelect>
                    </Field>
                  </div>
                </Card>
                <Card aria-labelledby="model-title">
                  <div className="mb-[22px] flex items-start gap-[11px] [&_p]:mt-1 [&_p]:text-[11px] [&_p]:leading-[1.6] [&_p]:text-muted-foreground max-[650px]:[&_p]:text-[10px]">
                    <span className="grid size-[33px] shrink-0 place-items-center rounded-[10px] bg-muted text-foreground">
                      <Sparkles size={18} />
                    </span>
                    <div>
                      <h2
                        className="text-[15px] font-semibold leading-normal tracking-[-0.3px]"
                        id="model-title"
                      >
                        Stepwise 模型
                      </h2>
                    </div>
                  </div>
                  {saved.environmentOverrides.length > 0 && (
                    <div className="mb-4 rounded-[9px] border border-notice-border bg-notice px-[13px] py-[11px] text-[11px] leading-[1.8] text-notice-foreground [overflow-wrap:anywhere]">
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
                            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                          </Button>
                        </div>
                      </Field>
                      {saved.storedApiKey && (
                        <label className="-mt-1.5 mb-5 flex items-center gap-1.5 text-[10px] text-muted-foreground [&_input]:accent-primary">
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
                      <Input
                        id="model"
                        value={form.model}
                        list="available-models"
                        onChange={(e) => change('model', e.target.value)}
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
                        <RefreshCw
                          size={14}
                          className={
                            busy === 'models' ? 'animate-spin [animation-duration:1.2s]' : ''
                          }
                        />
                        读取模型
                      </Button>
                    </div>
                    <datalist id="available-models">
                      {models.map((model) => (
                        <option key={model} value={model} />
                      ))}
                    </datalist>
                  </Field>
                  <div className="mt-5 flex items-center justify-between gap-2.5 border-t border-border pt-4 [&>span]:flex [&>span]:items-center [&>span]:gap-1.5 [&>span]:text-[10px] [&>span]:text-muted-foreground">
                    <span>
                      <i
                        className={
                          saved.available
                            ? 'inline-block size-1.5 rounded-full bg-[#648b74]'
                            : 'inline-block size-1.5 rounded-full bg-[#b59463]'
                        }
                      />
                      {saved.available ? '模型配置完整' : saved.reason || '等待配置'}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!!busy || remoteChanged}
                      onClick={() => void run('test', test)}
                    >
                      {busy === 'test' ? (
                        <LoaderCircle
                          className="animate-spin [animation-duration:1.2s]"
                          size={15}
                        />
                      ) : (
                        <Plug size={15} />
                      )}
                      {busy === 'test' ? '正在测试…' : dirty ? '保存并测试' : '测试连接'}
                    </Button>
                  </div>
                  <p className="mt-[7px] text-[10px] leading-[1.7] text-muted-foreground">
                    连接测试使用固定示例，不读取你的聊天。
                  </p>
                </Card>
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
                <Card aria-labelledby="quick-prompts-title">
                  <h2 id="quick-prompts-title" className="mb-2 text-[15px] font-semibold">
                    常用提示词
                  </h2>
                  <p className="mb-4 text-xs text-muted-foreground">
                    显示在下一步面板中，点击只填入，不自动发送。
                  </p>
                  <div className="space-y-3">
                    {form.quickPrompts.map((item, index) => (
                      <div
                        key={index}
                        className="grid grid-cols-[90px_minmax(0,1fr)_auto] gap-2 items-start"
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
                          className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-xs"
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
                <Card aria-labelledby="limits-title">
                  <div className="mb-[22px] flex items-start gap-[11px] [&_p]:mt-1 [&_p]:text-[11px] [&_p]:leading-[1.6] [&_p]:text-muted-foreground max-[650px]:[&_p]:text-[10px]">
                    <span className="grid size-[33px] shrink-0 place-items-center rounded-[10px] bg-muted text-foreground">
                      <Settings2 size={18} />
                    </span>
                    <div>
                      <h2
                        className="text-[15px] font-semibold leading-normal tracking-[-0.3px]"
                        id="limits-title"
                      >
                        生成设置
                      </h2>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-[22px] gap-y-[18px] [&>div]:mb-0 max-[650px]:gap-x-[15px]">
                    <Field
                      id="context-scope"
                      label="输入上下文"
                      hint="最近一次提问与回答，不包含更早历史。"
                    >
                      <NativeSelect
                        id="context-scope"
                        value={form.maxInputChars === 0 ? 'latest' : 'limited'}
                        onChange={(e) =>
                          change('maxInputChars', e.target.value === 'latest' ? 0 : 12000)
                        }
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
                    <Field
                      id="max-output"
                      label="输出 token 上限"
                      hint={
                        form.provider === 'codex'
                          ? '此项用于 API 模式；Codex CLI 由模型控制输出上限。'
                          : undefined
                      }
                    >
                      <Input
                        id="max-output"
                        type="number"
                        min="128"
                        max="16000"
                        step="1"
                        disabled={form.provider === 'codex'}
                        value={form.maxOutputTokens}
                        onChange={(e) => change('maxOutputTokens', Number(e.target.value))}
                      />
                    </Field>
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
                </Card>
                <Card aria-labelledby="startup-title">
                  <h2 id="startup-title" className="mb-5 text-[15px] font-semibold">
                    启动行为
                  </h2>
                  <Field
                    id="host-restart-policy"
                    label="ChatGPT 已打开，但没有调试连接时"
                    hint={
                      form.hostRestartPolicy === 'force'
                        ? '直接强制退出并重开，可能中断任务或丢失未保存内容。已有调试连接时不会重启。'
                        : '先询问；确认后请求正常退出，再重开并注入。取消或未能正常退出时保留应用。'
                    }
                  >
                    <NativeSelect
                      id="host-restart-policy"
                      value={form.hostRestartPolicy}
                      onChange={(e) =>
                        change(
                          'hostRestartPolicy',
                          e.target.value as EditableSettings['hostRestartPolicy'],
                        )
                      }
                    >
                      <option value="ask">询问后正常重开</option>
                      <option value="force">直接强制重开</option>
                    </NativeSelect>
                  </Field>
                </Card>
                {remoteChanged && (
                  <div
                    className="mb-4 rounded-[9px] border border-notice-border bg-notice px-[13px] py-[11px] text-[11px] leading-[1.8] text-notice-foreground [overflow-wrap:anywhere]"
                    role="alert"
                  >
                    设置已在桌面或其他窗口更新。
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-0 p-2"
                      onClick={() =>
                        void run('reload', async () => load(await request<Settings>('settings')))
                      }
                    >
                      重新载入设置
                    </Button>
                  </div>
                )}
                <div className="flex items-center justify-between px-0.5 py-1.5 [&>span]:text-[11px] [&>span]:text-muted-foreground max-[650px]:sticky max-[650px]:bottom-0 max-[650px]:bg-background max-[650px]:px-px max-[650px]:py-3">
                  <span>
                    {saving
                      ? '正在保存…'
                      : dirty
                        ? '编辑中，离开输入框后自动保存'
                        : '设置已同步到本机'}
                  </span>
                  <Button type="submit" disabled={!!busy || saving || !dirty || remoteChanged}>
                    {busy === 'save' ? (
                      <LoaderCircle className="animate-spin [animation-duration:1.2s]" size={16} />
                    ) : (
                      <Save size={16} />
                    )}
                    {busy === 'save' ? '正在保存…' : '保存设置'}
                  </Button>
                </div>
              </form>
            )}
          </div>
          <aside className="sticky top-[25px] max-[650px]:static max-[650px]:mt-5 max-[650px]:w-full">
            <Card
              className="p-[22px] max-[850px]:p-[18px] max-[650px]:p-5"
              aria-labelledby="connection-title"
            >
              <div className="mb-[15px] flex items-start gap-[11px] [&_p]:mt-1 [&_p]:text-[11px] [&_p]:leading-[1.6] [&_p]:text-muted-foreground max-[650px]:[&_p]:text-[10px]">
                <span className="grid size-[33px] shrink-0 place-items-center rounded-[10px] bg-muted text-foreground">
                  <Monitor size={18} />
                </span>
                <div>
                  <h2
                    className="text-[15px] font-semibold leading-normal tracking-[-0.3px]"
                    id="connection-title"
                  >
                    桌面连接
                  </h2>
                  <p>
                    {import.meta.env.DEV
                      ? '真实 Codex 调试'
                      : connected
                        ? '已连接官方 Codex'
                        : '连接一个可调试的 Codex 窗口'}
                  </p>
                </div>
              </div>
              <p className="mb-[21px] text-[11px] leading-[1.7] text-muted-foreground">
                {import.meta.env.DEV
                  ? '连接启动时选定的真实窗口。开发配置独立保存；模型请求使用真实服务。'
                  : view?.connection.message || '正在连接本地服务…'}
              </p>
              <Field id="cdp-endpoint" label="本机调试端口">
                <Input
                  id="cdp-endpoint"
                  readOnly={import.meta.env.DEV}
                  value={endpoint}
                  onChange={(e) => {
                    setEndpoint(e.target.value);
                    setTargetId('');
                    setConnectionEdited(true);
                  }}
                  placeholder="9229 或 http://127.0.0.1:9229"
                  spellCheck={false}
                />
              </Field>
              {(view?.connection.targets.length || 0) > 1 && (
                <Field id="target" label="Codex 窗口">
                  <NativeSelect
                    id="target"
                    disabled={import.meta.env.DEV}
                    value={targetId}
                    onChange={(e) => {
                      setTargetId(e.target.value);
                      setConnectionEdited(true);
                    }}
                  >
                    <option value="">自动选择</option>
                    {view?.connection.targets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.title}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
              <div className="mt-4 flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!live || !!busy}
                  onClick={() => void run('connect', connect)}
                >
                  {busy === 'connect' ? (
                    <LoaderCircle className="animate-spin [animation-duration:1.2s]" size={15} />
                  ) : (
                    <Plug size={15} />
                  )}
                  {connected ? '重新连接' : '连接 Codex'}
                </Button>
                {connected && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-0 p-2"
                    disabled={!!busy}
                    onClick={() =>
                      void run('disconnect', async () => {
                        await request('disconnect', {});
                        notify('连接已断开，桌面浮窗已移除。');
                      })
                    }
                  >
                    断开
                  </Button>
                )}
              </div>
              {!import.meta.env.DEV && (
                <div className="mt-[23px] border-t border-border pt-[17px] text-[10px] text-muted-foreground [&>button]:mt-[9px] [&>button]:w-full [&>button]:justify-between [&_code]:font-mono [&_code]:text-[8.5px] [&_code]:leading-[1.4] [&_code]:whitespace-nowrap max-[850px]:[&_code]:text-[7.4px] max-[650px]:[&_code]:text-[11px]">
                  <span>首次接入：等待任务结束并完整退出 ChatGPT，再在终端运行</span>
                  <Button
                    type="button"
                    variant="outline"
                    aria-label="复制启动命令"
                    onClick={() =>
                      void run('copy', async () => {
                        await navigator.clipboard.writeText('codex-buddy launch --restart-running');
                        notify('已复制启动命令；将按启动行为设置处理已打开的 ChatGPT。');
                      })
                    }
                  >
                    <code>codex-buddy launch</code>
                    <ChevronRight size={14} />
                  </Button>
                </div>
              )}
            </Card>
            <div className="flex justify-between border-t border-border px-1 py-4 text-[9px] text-muted-foreground [&>span]:opacity-65">
              CodexBuddy {view?.version || '—'}
              <span>本机运行</span>
            </div>
          </aside>
        </div>
        <div
          className={`fixed bottom-6 left-1/2 z-10 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-[9px] rounded-[11px] border border-border bg-card px-[15px] py-[13px] text-xs shadow-[0_5px_35px_#0002] empty:hidden [&_svg]:shrink-0 max-[650px]:bottom-[14px] max-[650px]:min-w-[280px] max-[650px]:text-[11px] ${failure ? 'text-[#b15555]' : ''}`}
          role={failure ? 'alert' : 'status'}
          aria-live="polite"
        >
          {message && (
            <>
              <Check size={16} />
              <span>{message}</span>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                aria-label="关闭提示"
                onClick={() => setMessage('')}
              >
                ×
              </Button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Field({
  label,
  id,
  hint,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-[18px] min-w-0 last:mb-0 [&>label]:mb-2 [&>label]:block [&>label]:text-xs [&>label]:font-[550]">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="mt-[7px] text-[10px] leading-[1.7] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="relative flex cursor-pointer items-center justify-between gap-[15px] border-t border-border py-[15px]">
      <span>
        <strong className="block text-[13px] font-medium">{label}</strong>
        {hint && (
          <small className="mt-[5px] block text-[11px] leading-normal text-muted-foreground max-[650px]:text-[10px]">
            {hint}
          </small>
        )}
      </span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
