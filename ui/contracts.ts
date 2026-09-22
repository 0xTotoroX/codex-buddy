/*
 * [INPUT]: 本机设置 API、宿主上下文和弹出窗口协议。
 * [OUTPUT]: 常用提示词配置与 quick-fill 命令、完整上下文哨兵 maxInputChars=0、启动策略 ask/force、独立胶囊/工作台偏好、停靠与浮窗各自的排列/顺序/双轴比例、字体、含分栏阅读位置的投影、呈现确认及操作身份、工作台聊天关联投影及模式命令的共享类型。
 * [POS]: 界面边界契约；不产生运行时依赖。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
export interface EditableSettings {
  hostRestartPolicy: 'ask' | 'force';
  enabled: boolean;
  answerOutlineEnabled: boolean;
  generationMode: 'auto' | 'manual';
  provider: 'codex' | 'api';
  protocol: 'responses' | 'chat_completions' | 'anthropic_messages' | 'auto';
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
  maxItems: number;
  quickPrompts: { label: string; prompt: string }[];
  /** 0 preserves the complete latest question and answer; positive values limit input. */
  maxInputChars: number;
  maxOutputTokens: number;
  timeoutMs: number;
}
export interface Settings extends EditableSettings {
  popoutSupported: boolean;
  apiKeyConfigured: boolean;
  storedApiKey: boolean;
  baseUrlConfigured: boolean;
  available: boolean;
  reason: string;
  configurationRevision: number;
  generationRevision: number;
  environmentOverrides: string[];
}
export interface ContextSnapshot {
  runtimeGeneration: number;
  paneKey: string;
  sessionId: string;
  assistantMessageId: string;
  generation: number;
}
export interface HostTypography {
  hostFontSize: number;
  baseItemFontSize: number;
  chromeFontSize: number;
  iconFontSize: number;
  fontFamily: string;
  source: string;
  fontWeight: number;
  labelWeight: number;
}
export interface PromptItem {
  label: string;
  summary: string;
  prompt: string;
}
export interface OutlineItem {
  id: string;
  text: string;
  displayLevel: number;
  numberPrefix: string;
  labelText: string;
}
export interface ChatAssociation {
  mode: string;
  sessionId: string;
  label: string;
  available: boolean;
  canLock: boolean;
  canRetarget: boolean;
  selectedSessionId: string;
}
export interface PanelSnapshot {
  instanceId: string;
  context: ContextSnapshot;
  answerHash: string;
  viewToken: string;
  promptToken: string;
  outlineToken: string;
  readingState: PanelReadingState;
  prompts: PromptItem[];
  outlineItems: OutlineItem[];
  outlineStatus: string;
  outlineError: string;
  bridgeStatus: string;
  bridgeError: string;
  scanBusy: boolean;
  scanStatus: string;
  theme: string;
  accentColor?: string;
  hostTypography: HostTypography;
  settings: Settings;
  sourceLabel: string;
  association?: ChatAssociation;
}
export interface PanelReadingState {
  viewToken: string;
  contentToken: string;
  activeTab: string;
  scrollTop: number;
  promptPreviewIndex: number;
  promptScrollTop: number;
  panes?: Partial<Record<'outline' | 'next', PanelPaneReadingState>>;
}
export interface PanelPaneReadingState {
  contentToken: string;
  scrollTop: number;
}
export interface PanelCommand {
  kind:
    | 'association'
    | 'fill'
    | 'quick-fill'
    | 'generate'
    | 'outline-refresh'
    | 'outline-jump'
    | 'outline-anchor';
  instanceId: string;
  viewToken: string;
  context: ContextSnapshot;
  promptToken: string;
  outlineToken: string;
  action?: string;
  sessionId?: string;
  index?: number;
  id?: string;
  anchor?: string;
  submit?: boolean;
  append?: boolean;
  draftFingerprint?: string;
}
export interface CommandResult {
  ok: boolean;
  message?: string;
  needsConfirmation?: boolean;
  draftFingerprint?: string;
}

export interface WorkbenchLayout {
  group: 'split' | 'tabs';
  active: 'outline' | 'next';
  mode: 'auto' | 'vertical' | 'horizontal';
  first: 'outline' | 'next';
  verticalRatio: number;
  horizontalRatio: number;
}

export interface PanelPreferences {
  open: boolean;
  activeTab: string;
  width: number;
  height: number;
  layoutMode: 'capsule' | 'workbench';
  dockWidth: number;
  splitRatio: number; // Legacy dock vertical ratio.
  dockLayout: WorkbenchLayout | null;
  popoutLayout: WorkbenchLayout | null;
  dockOpen: boolean;
  material: string;
  liquidVariant: 'regular' | 'clear';
  fontOffset: number;
  labelOnly: boolean;
  promptClickMode: string;
  viewOrder: string[];
}
export interface PopoutBridge {
  toggleTheme(): void;
  themeResult(error: string | null): void;
  request(path: string, input?: unknown): Promise<CommandResult>;
  size(width: number, height: number): Promise<void>;
  save(ui: PanelPreferences): void;
  dock(): Promise<void>;
  cancelDock?(): void;
  motionActive?(): boolean;
  presented(): Promise<void>;
  pin(value: boolean): Promise<void>;
  native(message: Record<string, unknown>): void;
  notice(message: string): void;
}
declare global {
  const CODEX_BUDDY_DEVELOPMENT: boolean;
  interface Window {
    __companionNativeGlass?: boolean;
    __companionPopout?: PopoutBridge;
  }
}

export interface AppearanceSettings {
  revision: number;
  webRevision: number;
  detached: boolean;
  returnOpen?: boolean | null;
  alwaysOnTop: boolean;
  position: { x: number; y: number } | null;
  ui: PanelPreferences;
}
