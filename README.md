<div align="center">
  <img src="ui/icon.png" alt="CodexBuddy logo" width="140" />
  <h1>CodexBuddy</h1>
  <p><strong>Your desktop companion for Codex: navigate answers and find your next question.</strong></p>
  <p>Answer outlines and next-step suggestions, inside Codex or in a desktop panel.</p>
  <p>
    <img alt="Rust 2024 edition" src="https://img.shields.io/badge/Rust-2024-000000?logo=rust&amp;logoColor=white" />
    <img alt="TypeScript 5" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&amp;logoColor=white" />
    <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&amp;logoColor=white" />
    <img alt="macOS 14+ Apple Silicon" src="https://img.shields.io/badge/macOS-14%2B%20Apple%20Silicon-333333?logo=apple&amp;logoColor=white" />
  </p>
</div>

**English** · [简体中文](README.zh-CN.md)

CodexBuddy adds a companion panel to Codex / ChatGPT. Navigate long answers, generate follow-up questions, and keep your tools inside the conversation or in a desktop window.

Use the eyes entry in the left rail to open the workbench. Hover for Inside, Desktop, and Settings; the default single-click action is configurable. Double-click or Alt+Enter moves the main interface between the chat and desktop. Right-click opens settings in ChatGPT’s built-in browser side panel. The desktop window has return-to-chat, maximize/restore, and pin controls; it stays on top by default and remembers your choice.

Terminology annotations are available under settings → Features → Terminology. Import a local glossary to show bold, underlined terms in chat, hover for Chinese definitions, and mark concepts as mastered. Chat hovers and sidebar selections share a compact popover with theme colors, matte, frosted, liquid, black, or custom backgrounds, plus favorites, manual entries, and document export. Optional semantic detection sends the current question and answer to the configured model; online enrichment queries only short term names and does not write to the main chat. Glossaries stay in local data and are not bundled with releases.

The workbench also provides a Terminology tab with concepts encountered in the current chat, favorites, and mastered terms. Semantic spans can cross paragraphs and inline formatting; results are cached and failed analysis is retried a bounded number of times.

Enable **点击术语时跳转到上下文** in settings → Features → Terminology to scroll to the latest confirmed occurrence in the current chat when selecting a term. It is off by default and keeps the definition popover; unavailable or stale positions do not switch chats.

## Features

| Feature | What it does |
| --- | --- |
| Answer outline | Jump to a heading and highlight its location in the answer |
| Next-step suggestions | Generate follow-up questions from the current answer, then copy them or insert them into the composer |
| Docked workbench | Show the outline and suggestions together without covering the chat; use automatic, vertical, or horizontal layouts, drag panels, group tabs, or focus one panel; remember docked and desktop layouts separately |
| Desktop window | On macOS 15+, pop out and return to the embedded panel, move and resize the window, or keep it on top |
| Model quick switch | Use the shared main interface or edge panel to select the official chat model, reasoning effort, and speed, and save complete presets; this does not change the model used for next-step suggestions |
| Task board | To do, In progress and Done; editable groups, inline creation and drag-and-drop in wide columns or narrow tabs |
| Apple Reminders integration | Implementation and existing data retained; settings entry temporarily hidden |
| Terminology | Local glossary, contextual definitions, favorites and mastered terms |
| Prompt enhancement | Optimize the current draft, cancel or restore it without sending |
| Reading and appearance | Follow Codex typography or set a fixed size; choose materials and summary visibility |
| Your choice of model | Use an existing Codex login or connect your own model API |

Outlines are parsed locally and do not require a model. Next-step suggestions require model configuration. You can disable either feature independently.

In Web settings, choose **设置 → 模型 → 生成模型 → 高级设置 → 输入上下文 → 最近一次聊天（完整）** to send the complete latest question and answer without local character truncation. New configurations use this mode by default; existing character limits are preserved and remain configurable. The selected model’s context window still applies. Suggestions preserve the complete goal and authorization boundaries instead of splitting related tasks into competing buttons. Results are self-contained Chinese follow-up prompts; technical names may stay in their original language.

**Suggestion directions** are independent of when generation starts:

- **自动探索 (Explore):** one generation request discovers directions freely, up to the configured count.
- **我来选择 (Choose):** select and reorder direction slots; one request generates up to one suggestion per slot. Inapplicable directions are skipped.
- **智能挑选 (Smart, experimental):** Jev serves only as an applicability evaluator for candidate directions, assessing enabled directions against the current context in one batch. It does not discover open-ended directions, generate suggestions or prompts, or execute actions. The user-configured generation model selects complementary directions and writes the follow-up prompts. Requires separate TypeSafe credentials and explicit consent to send the latest question and answer to that service. Other modes make no Jev calls; failures do not silently switch modes.

Web settings include six editable directions and custom directions. Counts are maximums, not quotas; empty results are valid. New configurations default to three suggestions; existing counts and generation timing are preserved. With an explicit input limit, the question takes priority and truncated context is marked. Jev and the generation model receive the same context snapshot. Jev's applicability cutoff is experimental and has not been calibrated for suggestion quality.

CodexBuddy uses its own eyes entry in the left rail and does not require the plugin. Click to toggle the workbench; double-click or Alt+Enter keeps the existing window handoff. Right-click or Option-right-click opens settings in ChatGPT’s built-in browser side panel.

Hover over the independent eyes entry to choose inside, outside, or settings; configure its default click action under **界面 → 外观与字体**. Workbench headers no longer repeat the face. The desktop window has a horizontal-line return-to-chat button, maximize/restore, and pin controls at the top right. Maximize uses the available screen area; restore returns to the original position and size.

Drag a panel heading or tab to another panel's edge to split the layout, or to its center to group them as tabs. Double-click a heading or tab to temporarily enlarge that panel; double-click its heading again or press Esc to restore the layout. Keyboard users can focus a heading and press Enter or Space. Choose tabs, vertical, horizontal or automatic splits under **界面 → 布局与位置 → 主界面布局** in Web settings. Press Esc during a drag to cancel it.

The outline and next-step suggestions share the same chat source. The source label and follow/lock menu are temporarily hidden; existing associations are preserved. If the source becomes unavailable, previous results remain available for reading until it reconnects.

## CodexHost management

Open **设置 → 系统 → 宿主管理** for installed/running versions, enablement, updates, version restore, and explicit restart to disable. The switch saves the next-launch preference; restarts follow the existing host policy. Management does not require Buddy’s MCP plugin.

## Prompt enhancement

Toggle prompt enhancement under **功能 → 常用开关** in settings. The settings search finds controls across categories and opens their original location; press `⌘K` or `Ctrl+K` to open its animated search dialog.

Write a draft in the chat composer and click the pencil-and-sparkle icon. The result replaces the draft without sending it. Cancel while it runs, or restore the original afterward. Typing, switching chats, or replacing the editor invalidates old results; special reference nodes are left untouched. This uses Buddy’s existing model and credentials under **设置 → 模型 → 生成模型**, and sends only the draft, without chat history.

## Settings navigation

Settings use one grouped interface, with no Simple/Detailed switch: Features, Interface, Models and System. Common switches, next-step suggestions, quick prompts, terminology, task board and model control each have their own page; layout and appearance are separate too. Wide windows show grouped links in the left sidebar. At 760px and below, two navigation rows select a group and then its page. Switching retains unfinished edits and reading position. Advanced settings, terminology management and model groups use right-side drawers that retain inputs and scroll position when closed. Existing configuration, credentials and old settings links remain compatible. Shared generation-model settings serve both next-step suggestions and prompt enhancement.

The Tom Modern settings design includes linked workspace, feature, generation and connection previews. Saved placement, nested layout and materials update the workspace diagram; generation previews identify unsaved edits. Sample interactions stay inside the preview. The Auto option follows Codex's light/dark appearance; the compact theme control in the page header also offers a saved light or dark override, while the brand icon retains its original appearance. Reduced-motion preferences and existing shared font settings remain in effect.

## Task board

Open **看板** in Web settings, enable it; the existing feature placement is retained, or run `codex-buddy board`. The default groups are To do, In progress and Done; rename or add groups in settings. Narrow views use group tabs, while wide windows show columns.

Apple Reminders authorization, list selection and sync controls are temporarily hidden. This release primarily uses the local board; integration code, existing bindings and task data are retained. Hiding the entry neither deletes Apple reminders nor automatically resets an existing sync configuration. Legacy Waiting tasks appear under To do while retaining their original stored stage.

Settings credentials are shared by browser tabs using the same backend address. New tabs, reloads and reopened pages reuse the connection. If credentials expire or the backend address changes, reopen settings once from the eyes menu; other tabs at that address recover automatically without remounting unfinished forms or replaying save operations.

### Feature display locations

In Web settings, use **界面 → 布局与位置 → 主界面** to choose a sidebar, in-page overlay or resizable desktop window. Only one main interface exists. Each feature joins either this shared tabbed interface or the independent edge/notch panel, which can coexist with it. Each form saves its own black, matte, frosted or liquid (Regular/Clear) theme. Use the eyes entry to toggle the main interface or move it to and from the desktop. Revealing it from settings reuses its window. Moving preserves drafts, closed features and task data. The in-page overlay shrinks toward the eyes entry with a curved zoom effect and expands back along the same path; it never turns into a capsule.

Under **设置 → 界面 → 外观与字体**, Buddy follows Codex chat text by default across terminology cards, the workbench and settings. Choose chat text, sidebar conversation titles or composer text as the reference; adjust the relative size (75–150%) or use a fixed custom size (10–32px). While a conversation is switching or the reference is unavailable, Buddy keeps the last valid font. Legacy per-feature size values remain stored.
The board starts with To do, In progress and Done. Rename groups or add your own. Cards show titles; create tasks at the bottom of each group. Drag to another column, or onto a group tab in narrow views. Hover over a card to reveal its trash button and remove it from Buddy immediately. The Apple reminder stays intact and is not imported again. Click a title to open task details for notes, priority and a due date. Closing retains the draft; external changes require review before saving. Priority and due dates stay local to Buddy. Expand search when needed. Custom groups stay local, while moving to Done syncs completion.

Return an existing desktop workbench before entering independent mode. Moving preserves reading state and inline creation drafts for the current service session without leaving the form. Closing a view does not disable its service or reminder sync. Desktop views require macOS 15+.

Before first moving a legacy standalone board into independent mode, save its draft and close that window. Otherwise the move is refused and the original window is kept open.

Hover over the eyes entry to reveal a background-free menu that expands upward within the sidebar: **Inside**, **Desktop**, and **Settings**. The **界面 → 外观与字体** lets you choose the default single-click action; existing configurations default to toggling the in-chat workbench. Arrow keys open and navigate the menu, and Esc closes it. Alt+Enter retains window handoff. Motion follows the reduced-motion preference.

The eyes entry reflects the original capsule states, including blinking at idle, generation, completion and errors. With multiple visible chats, a small edge dot indicates the linked chat’s direction; it is hidden for a single chat or an unavailable source. This does not add another capsule or change the entry’s click/menu actions.

The sidebar workbench and desktop window no longer duplicate the capsule eyes in their headers. Use the independent eyes entry for actions; the desktop retains its drag strip, pin control and Alt+Enter return shortcut.

## Operations and state transitions

The eyes entry stays in the host’s left rail. The workbench and desktop headers do not repeat it.

| Action | Result |
| --- | --- |
| Click the eyes | Run the saved action; by default, toggle the in-chat workbench |
| Hover, then choose Inside / Desktop | Open the saved in-chat placement or the existing desktop window |
| Double-click the eyes or press Alt+Enter | Move the main interface between the chat and desktop |
| Click the desktop’s horizontal-line button | Return the main interface to the chat |
| Right-click the eyes or choose Settings | Open settings in the built-in browser side panel |
| Drag headings/tabs; double-click a heading or tab | Split or group panels; temporarily focus a panel, then press Esc to restore |

Collapsing releases sidebar space while preserving the saved placement. If the sidebar does not fit, it stays closed until you reopen it when space is available. Floating and docked placements are selected in settings; desktop maximize/restore preserves the normal window geometry.

## Installation and use

### 1. Install

You need the ChatGPT / Codex desktop app, Node.js 22.16+, Rust 1.88+, and Xcode Command Line Tools.

Download and extract GitHub’s **Source code (zip)** or **Source code (tar.gz)** from [Releases](https://github.com/0xTotoroX/codex-buddy/releases), then run these commands in the project directory:

```sh
npm ci
npm run install:local
```

After installation, open **CodexBuddy** from Applications. Node.js and Rust are not required for everyday use.

> If ChatGPT / Codex is already running without a debugging connection, CodexBuddy asks before quitting and reopening it by default. You can select the force-restart option in the launch settings, but this may interrupt tasks or lose unsaved work. An existing debugging connection is reused directly.

### 2. Configure the suggestions model

Open settings from the eyes entry. Choose your existing Codex login or enter your model API settings, then test the connection. Text fields save when focus leaves them; selections save automatically. The Save button remains available for immediate saving. Using an existing login requires a working local Codex CLI installation and login session.

For Zhipu BigModel, select **Chat Completions** and use `https://open.bigmodel.cn/api/paas/v4` with your API key and model name. `glm-4.5-air`, `glm-4.7`, `glm-4.6v`, and `glm-4.1v-thinking-flashx` have passed the fixed-example connection test, including suggestion-format validation. Buddy adapts requests to the official endpoint while retaining direction and output validation; model access and quota still depend on your account. The connection test generates suggestions from a fixed example, not your chat.

Choose one shared main interface: a sidebar, an in-page overlay, or a desktop window. The edge/notch panel can coexist with it. Splits, tabs, and temporary focus only arrange the contents; they do not create additional main windows. Panel refresh controls appear on hover or keyboard focus and remain visible on touch devices.

### 3. Use the workbench

- **Navigate an answer:** open the outline and click a heading to jump to the source text.
- **Quick prompts:** the next-step panel starts with “继续” and “执行”. Clicking fills the composer without sending. Edit labels and text, add, or remove buttons in Web settings under “常用提示词”; they use no model requests and do not count toward generated suggestions.
- **Ask a follow-up:** refresh the next-step panel to generate suggestions, or enable automatic generation. Clicking a suggestion inserts it without sending by default. If a draft already exists, CodexBuddy asks before appending.
- **Arrange features:** choose the main placement and each feature’s main/edge location in display settings. Drag headings to split or group panels, and drag sidebar edges or internal dividers to resize them. Closing a view preserves its service and saved placement.
- **Adjust the window:** use the eyes menu or Alt+Enter for window handoff. Drag the desktop header to move and a lower corner to resize. The horizontal-line button returns to chat; maximize/restore and pin preserve their respective preferences. Buddy follows Codex appearance without changing its colors.

### Model quick switch

Enable the model feature in settings or run `codex-buddy model-control`. It initially opens in the shared edge form and subsequently uses its saved placement. Favorites, reasoning, speed and presets are available in every form; next-step generation settings remain independent. The catalog icon after the trailing plus switches the same panel to a manufacturer catalog containing every model, including favorites. Closing it restores the matrix and preset shortcuts. Click a neutral tile to add or remove it from favorites; refresh sits beside the catalog close button. The edge panel grows to fit the actual favorite model rows. Click the lightning button to toggle Fast with a brief downward electric pulse. Drag the separate thin divider below it to resize model names; dragging never toggles Fast. Reduced motion keeps only a brief brightness response. Presets are individual recessed tags without an outer box; only Fast presets show a lightning icon. The trailing plus immediately saves the current selection under the model name, without a confirmation form. Duplicate names receive a numeric suffix while presets for the same model remain independent. The pencil toggles editing: every tag gains a delete control, and clicking its name edits the text instead of applying the preset. Tags wrap automatically. In Web settings, open **功能 → 模型切换 → 模型分组** to correct manufacturers, create custom groups, move models in bulk, reorder groups/models, or restore automatic classification. Refreshing preserves manual choices and preferences for temporarily unavailable models. Different model IDs remain separate even when their names match. Only reasoning levels supported by favorite models occupy columns. The wider name-column budget and its divider support pointer and keyboard resizing and stop before reasoning labels become crowded. The outer frame stays stable during dragging, then adjusts its height to fit wrapped names on release. The full content scrolls only when it exceeds the available screen space.

The edge/notch form is shared by the enabled features. Use **界面 → 布局与位置** for its display, edge, position and keep-open preference, and **界面 → 外观与字体** for its theme. Hover to expand, leave for roughly half a second to collapse, or press `⌘⇧M` to toggle. Editing and business operations suppress automatic collapse; collapsing or switching tabs preserves drafts. Choose **跟随 Codex** to follow the display containing the connected Codex window, or select a fixed display. The panel remains available across Spaces and full-screen apps without following other apps’ focus. Stopping Buddy closes it.

Legacy model visual preferences migrate once to `surfaces.json`; model pins and presets remain in `model-control.json`.

Available models and efforts come from the host. You can switch models in a new chat before sending its first message. The first selection reads and applies the configuration in one operation, without a separate refresh, then verifies the actual result. You can adjust subsequent configuration while an answer is being generated, provided the official controls allow it. Switching stops if the controls are disabled, the target is ambiguous, or capabilities have not loaded. If the official model list has not yet been observed after connecting, the control waits; there is no need to restart a working host just to load the list.

## Updating and uninstalling

To update, get the latest source and run `npm ci` and `npm run install:local` again. Existing configuration is preserved.

To uninstall, first stop the background service:

```sh
~/.local/bin/codex-buddy stop
```

Then delete `/Applications/CodexBuddy.app` and `~/.local/bin/codex-buddy`. To also remove configuration, delete `~/Library/Application Support/codex-buddy/`.

## Development

New Dev App sessions clean up after the ChatGPT process exits, using its PID, start time, and executable identity. A temporary page disconnection keeps the session alive. After a script upgrade, run `npm run dev:stop` and reopen the Dev App; ChatGPT can stay open.

Built with **Rust, JavaScript / TypeScript, and React**.

```text
src/               Backend, CLI, and native windows
ui/features/       Board, outline, next-step, model, and terminology content
ui/terminology/    Chat annotations and definition popovers
ui/surfaces/       Shared workspace, embedded, desktop, edge, and themes
ui/codex/          Codex page reading, navigation, and input adapters
ui/shared/         Shared contracts, communication, icons, and tokens
ui/settings/       Settings web app
tests/             Automated tests
scripts/           Development, build, and installation tools
```

After installing dependencies, open the host through CodexBuddy, then run:

```sh
npm run dev
```

Alternatively, run `npm run install:dev` once to install **CodexBuddy Dev.app**. Opening it starts development in the background, updates saved source automatically, and does not open a terminal. Opening it again brings up the existing workbench. Without a debugging connection, it follows the development launch setting, initially inherited from the everyday installation. Stop background development with `npm run dev:stop`; logs are written to `target/dev/launcher.log`. After an abnormal exit, stale ownership records are recovered only when the supervisor and its associated backends have exited; otherwise startup reports the reason and preserves the records. This launcher depends on the local source tree and development tools. Stop and reopen it after changing development scripts or dependencies; regenerate it after moving the source tree or changing the Node.js path.

The official plugin-tab link remains available as a disabled experiment. Both everyday and Dev builds use the original workbench entry and do not automatically expand the official panel when switching chats.

For multiple Git worktrees, run `npm run dev:settings` (or right-click the fallback eyes entry), then select **开发** on the same settings page (older worktrees keep their top-of-page source selector). `npm run dev:settings` opens this same page with its session credentials. After upgrading the development scripts, stop and reopen Dev once. Older worktrees without the unified-entry fix still use their original gear destination; use the existing Dev settings tab to switch back. Select a worktree to switch its backend, settings UI, and hot reload together without restarting Codex. The settings address stays the same, and the last successful source is remembered. Each worktree keeps its own configuration. Compilation failure leaves the current source running; connection failure attempts to restore it. Use one Dev supervisor for the target window; stop older standalone Dev sessions before adopting this workflow. An explicit startup override is available with `npm run dev -- --source /path/to/worktree`.

Development mode connects to real Codex. UI changes reload automatically, and Rust changes trigger a rebuild. For command-line development, press Ctrl+C to stop. Development configuration is separate from the everyday installation. Embedded liquid material uses the same SVG renderer in development and release builds.

```sh
npm run verify         # Run checks
npm run verify:web     # Frontend and synthetic browser pilot (also runs on Linux)
npm run build          # Build the application
npm run package        # Create the CLI archive and release checksum notes
npm run install:local  # Install the current code locally
```

For the frontend pilot, run `npm ci` first and provide an installed Chromium through `CHROME_PATH` if needed; Linux automatically uses `/usr/bin/chromium` when available. Logs and results go to `target/reports/web-pilot/`. The Node license integration test still requires Cargo and its dependencies; missing prerequisites remain failures. This pilot excludes native checks and does not replace full verification or establish Linux application support.

Building or packaging does not update an installed application. When reporting an issue or contributing a change, include the version, OS, and reproduction steps, and remove credentials and private chat content.

The default README is English. Keep [README.zh-CN.md](README.zh-CN.md) in sync when updating user-facing documentation.

Open settings from the independent eyes menu or its right-click shortcut. The workbench header has no separate settings gear. Settings use the complete local page in ChatGPT’s built-in browser; the plugin remains optional.

## Privacy and license

Configuration is stored locally. When generating suggestions, the latest question and answer are sent to your chosen model service, subject to your input-context setting. Smart mode also sends that exchange to the configured Jev service after explicit consent. CodexBuddy does not persist chat bodies or modify the official application bundle. Host updates may affect compatibility.

Project-owned source code is licensed under the [GNU GPL version 3 only](LICENSE) (`GPL-3.0-only`). Commercial use is permitted without a separate license fee; conveying covered software requires compliance with GPLv3, including applicable Corresponding Source obligations. Earlier MIT grants remain valid. Third-party notices retain their original terms; see [LICENSING.md](LICENSING.md) for the scope and historical license.

## Agent configuration CLI

Use the running local service to inspect and patch settings. `config schema` lists domains, fields and operations. `--data-dir` selects the service data directory; it defaults to the daily installation. For Dev, select the active worktree’s `target/dev/real`. The CLI never starts or restarts the host automatically.

```sh
codex-buddy config schema
codex-buddy config get settings
codex-buddy config set appearance --json '{"settingsTheme":"codex"}' --dry-run
codex-buddy config set appearance --json '{"settingsTheme":"codex"}'
codex-buddy config set settings --file - < settings-patch.json
```

Unmentioned fields and stored keys are retained; arrays replace the full list. Reads and previews redact keys. Supply credentials through a file or stdin. `--dry-run` checks client fields and revisions only; the backend performs full validation on save. Destructive or authorization operations require `--confirm`; conflicts are never retried automatically. Task `fields` patches preserve unmentioned notes, dates and other values. `config reminders calendars` reads available lists; `config reminders authorize --confirm` requests system authorization without bypassing it. No MCP server is included.
