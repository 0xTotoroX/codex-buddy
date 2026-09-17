/*
 * [INPUT]: 注入环境与兼容标识。
 * [OUTPUT]: 稳定 DOM、按构建环境隔离的存储键、尺寸及收放/完成反馈时间参数。
 * [POS]: 无业务依赖的运行常量。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

/** @type {import("../../contracts").PopoutBridge|null} */
const POPOUT = window.__companionPopout || null;
const IS_POPOUT = Boolean(POPOUT);
const API_KEY = '__companionFloatingPanel';
const STYLE_ID = 'companion-stepwise-panel-style';
const ROOT_ATTR = 'data-companion-stepwise-root';
const MARK_ATTR = 'data-companion-stepwise-outline-id';
const HIGHLIGHT_CLASS = 'companion-stepwise-outline-target-flash';
const SCRIPT_VERSION = 'companion-0.4.0';
const PAGE_BRIDGE = '__companionDesktopRequest';
const CONVERSATION_TURN_SELECTOR = 'div.contents[data-content-search-turn-key]';
const POPOVER_ID = 'companion-stepwise-popover';
const DEVELOPMENT = typeof CODEX_BUDDY_DEVELOPMENT !== 'undefined' && CODEX_BUDDY_DEVELOPMENT;
const storageKey = (name) => (DEVELOPMENT ? 'codex-buddy-dev:' : '') + name;
const DETACHED_KEY = storageKey('companion-panel-detached');
const LEGACY_THEME_MODE_KEY = storageKey('companion-stepwise-theme-mode-v1');
const POSITION_KEY = storageKey('companion-stepwise-float-position-v2');
const WIDTH_KEY = storageKey('companion-stepwise-panel-width-v1');
const HEIGHT_KEY = storageKey('companion-stepwise-panel-height-v1');
const FONT_KEY = storageKey('companion-stepwise-font-v1');
const FONT_OFFSET_KEY = storageKey('companion-stepwise-font-offset-v1');
const LEGACY_MATERIAL_KEY = storageKey('companion-stepwise-material-v1');
const PREVIOUS_MATERIAL_KEY = storageKey('companion-stepwise-material-v2');
const LEGACY_GLASS_STYLE_KEY = storageKey('companion-glass-style');
const PREVIOUS_V3_MATERIAL_KEY = storageKey('companion-stepwise-material-v3');
const LIQUID_VARIANT_KEY = storageKey('codex-buddy-liquid-variant');
const MATERIAL_KEY = storageKey('companion-stepwise-material-v4');
const MATERIAL_ORIGIN_KEY = storageKey('companion-stepwise-material-v3-origin');
const MATERIAL_MIGRATION_KEY = storageKey('companion-stepwise-material-v3-migrated');
const LABEL_ONLY_KEY = storageKey('companion-stepwise-label-only-v1');
const PROMPT_CLICK_MODE_KEY = storageKey('companion-stepwise-prompt-click-mode-v1');
const VIEW_ORDER_KEY = storageKey('companion-stepwise-view-order-v1');
const PROMPT_CLICK_MODES = ['direct', 'hybrid', 'fill'];
const DEFAULT_PROMPT_CLICK_MODE = 'fill';
const GENERATION_MODES = ['auto', 'manual'];
const MATERIAL_MODES = ['matte', 'frosted', 'native-glass'];
const DEFAULT_MATERIAL = 'frosted';
const LEGACY_MATERIAL_MODES = Object.freeze({
  glass: 'frosted',
  liquid: 'frosted',
  liquid2: 'frosted',
  solid: 'matte',
  opaque: 'matte',
});
const LEGACY_OUTLINE_FONT_KEY = storageKey('companion-answer-outline-font');
const LEGACY_OUTLINE_FONT_OFFSET_KEY = storageKey('companion-answer-outline-font-offset');
const DIAGNOSTICS_KEY = storageKey('companion-stepwise-diagnostics-v1');
const SCAN_DELAY_MS = 220;
const STREAM_IDLE_MS = 1300;
const NEW_ANSWER_EXPRESSION_MS = 700;
const BRIDGE_TIMEOUT_MS = 310000;
const SETTINGS_SYNC_INTERVAL_MS = 15000;
const FLASH_MS = 1200;
const COMPLETION_BEAM_MS = 900;
const MIN_OUTLINE_TEXT_LEN = 280;
const MIN_OUTLINE_ITEMS = 2;
const MAX_OUTLINE_ITEMS = 24;
const MAX_OUTLINE_TITLE_LEN = 56;
const MIN_OUTLINE_TITLE_LEN = 2;
const OUTLINE_TARGET_TOP_OFFSET = 28;
const OUTLINE_INDENT_STEP = 12;
const OUTLINE_SCROLL_SETTLE_MS = 720;
const OUTLINE_SCROLL_RECHECK_MS = 140;
const OUTLINE_SEMANTIC_HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6,[role='heading']";
const OUTLINE_PSEUDO_HEADING_SELECTOR = 'p,div,li,strong,b';
const OUTLINE_TABLE_SELECTOR = [
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  "[role='table']",
  "[role='row']",
  "[role='cell']",
  "[role='columnheader']",
  "[role='rowheader']",
].join(',');
const OUTLINE_PSEUDO_MIN_SCORE = 24;
const CHIP_WIDTH = 84;
const CHIP_HEIGHT = 46;
const CHIP_RADIUS = 23;
const PANEL_WIDTH = 404;
const PANEL_HEIGHT = 420;
const SETTINGS_PANEL_HEIGHT = 376;
const PANEL_MIN_WIDTH = 300;
const PANEL_MAX_WIDTH = 640;
const PANEL_MIN_HEIGHT = 340;
const PANEL_MAX_HEIGHT = 720;
const PANEL_RADIUS = 25;
const PANEL_SAFE_MARGIN = 12;
const RIGHT_EDGE_SNAP_DISTANCE = 36;
const DEFAULT_FONT = 13;
const MIN_FONT = 10;
const MAX_FONT = 24;
const HOST_FONT_SIZE_FALLBACK = 15;
const HOST_FONT_SIZE_MIN = 12;
const HOST_FONT_SIZE_MAX = 22;
const ITEM_FONT_RATIO = 13 / 15;
const CHROME_FONT_RATIO = 12 / 15;
const ICON_FONT_RATIO = 16 / 15;
const HOST_FONT_FAMILY_FALLBACK = '-apple-system, "system-ui", "Segoe UI", sans-serif';
const MIN_MORPH_MS = 320;
const MAX_MORPH_MS = 420;
const MIN_PHASE_MS = 150;
const MIN_REVERSE_MS = 100;
const MORPH_FALLBACK_BUFFER_MS = 120;
const HORIZONTAL_PHASE = 0.5;
const MORPH_EDGE_SPEED = 1.8;
const UNFOLD_SAMPLES = 28;
const VIEW_SLIDE_MS = 240;
const VIEW_SLIDE_DISTANCE = 12;
const VIEW_INDICATOR_MS = 220;
const DEFAULT_VIEW_ORDER = ['next', 'outline'];
const EYE_MAX_X = 4;
const EYE_MAX_Y = 3;
const CURIOUS_EYE_MAX_X = 3;
const CURIOUS_EYE_MAX_Y = 2.5;
const MAX_TEXT_LENGTH = 12000;
const DEFAULT_STEPWISE_ITEMS = 4;
const MAX_STEPWISE_ITEMS = 6;
const MAX_PROMPT_SUMMARY_LENGTH = 72;
const MAX_DIAGNOSTICS = 80;
const EDITABLE_SUBMIT_DELAY_MS = 120;
const PROMPT_PREVIEW_SWITCH_MS = 320;
const PROMPT_CLICK_DELAY_MS = 230;
const SUBMIT_RETRY_DELAY_MS = 50;
const SUBMIT_RETRY_LIMIT = 80;
const FRIENDLY_BRIDGE_ERRORS = [
  {
    pattern: /回答生成中/i,
    title: '回答尚未完成，完成后再试',
    message: '',
  },
  {
    pattern: /未找到可用于生成的回答/i,
    title: '回答尚未完成，完成后再试',
    message: '',
  },
  {
    pattern: /\b429\b|too many pending|rate[_ -]?limit/i,
    title: '请求较多，稍后再试',
    message: '',
  },
  {
    pattern: /timeout|timed out|超时/i,
    title: '响应较慢，稍后再试',
    message: '',
  },
  {
    pattern: /\b401\b|\b403\b|unauthori[sz]ed|forbidden|api.?key|鉴权|认证/i,
    title: '连接异常，检查模型与配置',
    message: '',
  },
  {
    pattern: /econnrefused|failed to fetch|network|connection|连接失败|无法连接/i,
    title: '暂时无法连接，检查服务后重试',
    message: '',
  },
  {
    pattern: /\b5\d{2}\b|upstream/i,
    title: '服务暂时不可用，稍后重试',
    message: '',
  },
];
const INSTANCE_ID = `${SCRIPT_VERSION}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export {
  DEVELOPMENT,
  DETACHED_KEY,
  LEGACY_THEME_MODE_KEY,
  API_KEY,
  BRIDGE_TIMEOUT_MS,
  CHIP_HEIGHT,
  CHIP_RADIUS,
  CHIP_WIDTH,
  CHROME_FONT_RATIO,
  COMPLETION_BEAM_MS,
  CONVERSATION_TURN_SELECTOR,
  CURIOUS_EYE_MAX_X,
  CURIOUS_EYE_MAX_Y,
  DEFAULT_FONT,
  DEFAULT_MATERIAL,
  DEFAULT_PROMPT_CLICK_MODE,
  DEFAULT_STEPWISE_ITEMS,
  DEFAULT_VIEW_ORDER,
  DIAGNOSTICS_KEY,
  EDITABLE_SUBMIT_DELAY_MS,
  EYE_MAX_X,
  EYE_MAX_Y,
  FLASH_MS,
  FONT_KEY,
  FONT_OFFSET_KEY,
  FRIENDLY_BRIDGE_ERRORS,
  GENERATION_MODES,
  HEIGHT_KEY,
  HIGHLIGHT_CLASS,
  HORIZONTAL_PHASE,
  HOST_FONT_FAMILY_FALLBACK,
  HOST_FONT_SIZE_FALLBACK,
  HOST_FONT_SIZE_MAX,
  HOST_FONT_SIZE_MIN,
  ICON_FONT_RATIO,
  INSTANCE_ID,
  IS_POPOUT,
  ITEM_FONT_RATIO,
  LABEL_ONLY_KEY,
  LEGACY_MATERIAL_KEY,
  LEGACY_MATERIAL_MODES,
  LEGACY_OUTLINE_FONT_KEY,
  LEGACY_OUTLINE_FONT_OFFSET_KEY,
  MARK_ATTR,
  MATERIAL_KEY,
  LIQUID_VARIANT_KEY,
  PREVIOUS_V3_MATERIAL_KEY,
  LEGACY_GLASS_STYLE_KEY,
  MATERIAL_MIGRATION_KEY,
  MATERIAL_MODES,
  MATERIAL_ORIGIN_KEY,
  MAX_DIAGNOSTICS,
  MAX_FONT,
  MAX_MORPH_MS,
  MAX_OUTLINE_ITEMS,
  MAX_OUTLINE_TITLE_LEN,
  MAX_PROMPT_SUMMARY_LENGTH,
  MAX_STEPWISE_ITEMS,
  MAX_TEXT_LENGTH,
  MIN_FONT,
  MIN_MORPH_MS,
  MIN_OUTLINE_ITEMS,
  MIN_OUTLINE_TEXT_LEN,
  MIN_OUTLINE_TITLE_LEN,
  MIN_PHASE_MS,
  MIN_REVERSE_MS,
  MORPH_EDGE_SPEED,
  MORPH_FALLBACK_BUFFER_MS,
  NEW_ANSWER_EXPRESSION_MS,
  OUTLINE_INDENT_STEP,
  OUTLINE_PSEUDO_HEADING_SELECTOR,
  OUTLINE_PSEUDO_MIN_SCORE,
  OUTLINE_SCROLL_RECHECK_MS,
  OUTLINE_SCROLL_SETTLE_MS,
  OUTLINE_SEMANTIC_HEADING_SELECTOR,
  OUTLINE_TABLE_SELECTOR,
  OUTLINE_TARGET_TOP_OFFSET,
  PAGE_BRIDGE,
  PANEL_HEIGHT,
  PANEL_MAX_HEIGHT,
  PANEL_MAX_WIDTH,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  PANEL_RADIUS,
  PANEL_SAFE_MARGIN,
  PANEL_WIDTH,
  POPOUT,
  POPOVER_ID,
  POSITION_KEY,
  PREVIOUS_MATERIAL_KEY,
  PROMPT_CLICK_DELAY_MS,
  PROMPT_CLICK_MODES,
  PROMPT_CLICK_MODE_KEY,
  PROMPT_PREVIEW_SWITCH_MS,
  RIGHT_EDGE_SNAP_DISTANCE,
  ROOT_ATTR,
  SCAN_DELAY_MS,
  SCRIPT_VERSION,
  SETTINGS_PANEL_HEIGHT,
  SETTINGS_SYNC_INTERVAL_MS,
  STREAM_IDLE_MS,
  STYLE_ID,
  SUBMIT_RETRY_DELAY_MS,
  SUBMIT_RETRY_LIMIT,
  UNFOLD_SAMPLES,
  VIEW_INDICATOR_MS,
  VIEW_ORDER_KEY,
  VIEW_SLIDE_DISTANCE,
  VIEW_SLIDE_MS,
  WIDTH_KEY,
};
