<div align="center">
  <img src="ui/icon.png" alt="CodexBuddy logo" width="140" />
  <h1>CodexBuddy</h1>
  <p><strong>你的 Codex 桌面搭档：看回答大纲，接着问下一步。</strong></p>
  <p>Answer outlines and next-step suggestions, inside Codex or in a desktop panel.</p>
  <p>
    <img alt="Rust 2024 edition" src="https://img.shields.io/badge/Rust-2024-000000?logo=rust&amp;logoColor=white" />
    <img alt="TypeScript 5" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&amp;logoColor=white" />
    <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&amp;logoColor=white" />
    <img alt="macOS 14+ Apple Silicon" src="https://img.shields.io/badge/macOS-14%2B%20Apple%20Silicon-333333?logo=apple&amp;logoColor=white" />
  </p>
</div>

[English](README.md) · **简体中文**

CodexBuddy 为 Codex / ChatGPT 增加一个随手可用的辅助面板：快速定位长回答，生成下一步问题，留在对话内或弹到桌面使用。

## 能做什么

| 功能 | 用途 |
| --- | --- |
| 回答大纲 | 点击标题定位并高亮原文 |
| 下一步建议 | 根据当前回答生成后续问题，复制或填入输入框 |
| 停靠工作台 | 大纲与下一步同时显示，聊天让出空间；支持自动、上下或左右排列，可拖拽编排、合并标签或专注查看，分别记住停靠与浮窗布局 |
| 桌面浮窗 | macOS 15+ 可在内嵌与弹出之间切换，支持拖动、调整大小和置顶 |
| 模型快切 | 独立屏幕贴边控制条，切换官方聊天模型、推理强度与速度，保存完整预设；不改变下一步建议的模型配置 |
| 阅读与外观 | 调整材质、字号和摘要显示，记住你的偏好 |
| 自选模型 | 使用现有 Codex 登录，或连接自己的模型 API |

大纲在本机解析，无需模型；下一步建议需要配置模型。两个功能可以分别关闭。

内嵌时单击表情展开或收起工作台；双击表情弹出到桌面，在桌面再次双击收回，恢复出发时的紧凑或展开状态。分栏、标签和专注查看始终保留顶部表情与收回按钮。

工作台中，拖动面板标题或标签到另一面板边缘可分栏，拖到中央可合并标签；双击标题或标签临时放大面板，再双击标题或按 Esc 恢复；键盘可聚焦标题后按 Enter 或空格。完整编排选项保留在 Web 设置页。拖动时按 Esc 可取消。

大纲与下一步始终使用同一聊天来源，顶部来源文字及跟随／锁定菜单暂时隐藏，已有的关联状态保留。来源暂不可用时保留已有结果供查看，恢复后继续使用。

## 安装与使用

### 1. 安装

准备好 ChatGPT / Codex 桌面应用，以及 Node.js 22.16+、Rust 1.88+、Xcode Command Line Tools。

从 [Releases](https://github.com/0xTotoroX/codex-buddy/releases) 下载并解压源码包，在项目目录执行：

```sh
npm ci
npm run install:local
```

安装完成后，在「应用程序」中双击 **CodexBuddy**。日常使用无需 Node.js 或 Rust。

> ChatGPT / Codex 已打开但没有调试连接时，CodexBuddy 默认先询问，再正常退出并重开。可在设置页「启动行为」改为「直接强制重开」，但可能中断任务或丢失未保存内容。已有可用调试连接时直接接入。

### 2. 配置模型

从胶囊打开设置，选择「现有 Codex 登录」或填写自己的模型 API，保存后点击「测试连接」。使用现有登录需要本机有可用的 Codex CLI 和登录状态。

工作台共有五种外观状态：右侧栏展开／窄入口、聊天内浮动展开／紧凑胶囊、独立窗口展开。上下、左右、标签和专注仅改变内部排布；空间不足是收起原因，不是新形态。

### 3. 开始使用

- **看大纲**：切换到「大纲」，点击标题跳转到原文。
- **继续提问**：在「下一步」点击刷新生成建议，也可开启自动生成。默认点击只填入，不自动发送；已有草稿时会询问是否追加。
- **同时查看**：在 Web 设置的「聊天内位置」选择「固定在聊天右侧」或「在聊天内自由移动」。拖动左边界调宽、内部分隔线调整比例；拖动标题调整排列，Web 设置中可选自动、上下、左右、顺序或恢复默认；单独打开聊天时跟随到聊天内，关闭后回到主界面；空间不足时收起，点击右侧入口会说明原因，并可选择独立窗口或在聊天内直接展开；空间恢复后点击即可重新打开侧栏。整个工作台仍可弹出或收回。
- **调整面板**：顶部按钮明确表示「移到独立窗口」或「放回聊天」，单独的减号按钮收起聊天内工作台；拖动顶部移动，拖动下角调整大小；在设置中修改外观。弹出后保持展开，Web 设置中可选择窗口置顶和明暗。

模型快切在设置页点击「打开控制条」，或运行 `codex-buddy model-control`。默认使用纯黑贴边外壳，也可独立选择哑光、磨砂、液态及 Regular/Clear；收起和展开保持同一主题，共用字号与图标，工作台外观不变。设置页与控制条菜单均可选择显示器、边缘和位置。控制条跟随已连接 Codex 所在桌面，宿主隐藏或断连时隐藏；默认停靠右侧，可切换左侧或顶部；鼠标触达即展开、离开约半秒收起，按住 `⌥` 拖动入口调位置。模型与推理强度共用一张矩阵，搜索从菜单或 `⌘F` 打开；悬停不会抢走键盘焦点，搜索、编辑和键盘操作可主动获取焦点。`⌘⇧M` 可展开/收起，菜单可保持展开或关闭。模型与档位以宿主实际能力为准，首次点击在同一次操作中读取实际配置并应用，无需另点刷新，切换后回读确认。回答期间可调整后续配置；官方控件禁用、目标不明或能力尚未加载时不会执行。热接入后若尚未观察到官方模型列表，会保留等待状态，无需为此重启正在工作的宿主。

## 更新与卸载

更新时获取新版源码，重新执行 `npm ci` 和 `npm run install:local`，原配置会保留。

卸载时先执行：

```sh
~/.local/bin/codex-buddy stop
```

再删除 `/Applications/CodexBuddy.app` 和 `~/.local/bin/codex-buddy`。如需同时清除配置，再删除 `~/Library/Application Support/codex-buddy/`。

## 二次开发

技术栈：**Rust + JavaScript / TypeScript + React**。

```text
src/          后台、CLI 和原生窗口
ui/panel/     胶囊界面、下一步建议和大纲
ui/settings/  设置网页
ui/model-control/  独立模型控制条及官方菜单适配器
ui/bridge/    宿主通信
tests/        自动测试
scripts/      开发、构建与安装工具
```

安装依赖后，先通过 CodexBuddy 打开宿主，再运行：

```sh
npm run dev
```

也可执行一次 `npm run install:dev`，安装独立的 **CodexBuddy Dev.app**。双击后在后台启动，保存源码自动更新，不弹出终端；重复打开会唤起已有工作台。没有调试连接时按开发设置页「启动行为」处理，首次使用继承日常设置。后台开发可用 `npm run dev:stop` 退出，日志在 `target/dev/launcher.log`。它依赖本机源码和开发工具；修改开发脚本或依赖后需停止并重新打开，移动源码或更换 Node 路径后需重新生成入口。

开发模式连接真实 Codex；修改界面后自动加载，修改 Rust 后自动编译。命令行启动时按 Ctrl+C 结束。开发配置独立，不覆盖日常安装；内嵌液态与正式版共用 SVG 渲染。

```sh
npm run verify         # 运行检查
npm run build          # 编译程序
npm run package        # 生成程序包和源码包
npm run install:local  # 将当前代码安装到本机
```

构建、打包不会自动更新已安装程序。提交问题或改进时，请附版本、系统和复现步骤，并移除密钥与私人聊天内容。

README 默认使用英文；更新用户文档时，请同步 [README.md](README.md) 与本中文版。

## 隐私与许可

配置保存在本机；生成建议时，相关回答片段会发送给你选择的模型服务。CodexBuddy 不持久化聊天正文，不修改官方应用包；宿主升级可能影响兼容性。

自有源码采用 [MIT License](LICENSE)，第三方依赖保留各自许可。
