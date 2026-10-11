# codex_host/ — 独立 CodexHost 管理

> L2 | 父级：[AGENTS.md](../AGENTS.md)

src/codex_host.rs管理Options、安装/运行身份、启停选择、有界冷启动和认证/codex-host API，不进入面板布局或依赖MCP。

- restart.rs：显式重启停用的独立协调进程；复核修订、宿主进程、窗口探针和Dev来源。取消不退出宿主。旧Dev记录可从owner读取监督PID，仍核对准确命令、当前占用和sourceEpoch。
- update.rs：官方Release查询、私有指定版本安装与校验，保留前版本；不覆盖全局安装、不自动更新或重启。适配最低基线0.10.2与本机安装版本分开记录。

开关只保存意愿；启用/停用通过现有启动策略及显式操作，普通会话不能被上游launcher隐式接管。codexHost、revision、previousExecutable和运行记录名保持兼容。

[PROTOCOL]: 成员或接口变化时同步本文及父级地图。
