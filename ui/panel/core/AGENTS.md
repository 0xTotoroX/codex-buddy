# ui/panel/core/ — 胶囊外壳与交互

> L2 | 父级：[AGENTS.md](../AGENTS.md)

views 组合功能视图，settings-view 负责设置控件；几何、交互、外观和效果使用明确的下层依赖。需要重新渲染或刷新业务时发送 signals，由入口协调，不反向调用 views。

成员清单：

- [panel-appearance.js](panel-appearance.js)：三材质、liquidVariant（Regular/Clear）、字号与尺寸偏好；停靠主侧栏默认液态 Clear，独立前景聊天默认哑光，两类选择按宿主场景单独存于本地，不覆盖胶囊与原生窗口共享偏好，弹出明暗读取并监听系统颜色方案；内嵌液态发出 appearance 事件，由 glass 模块接管背景，弹出磨砂映射 native-frosted，液态按能力映射 native-glass 或哑光。
- [install-styles.js](install-styles.js)：将共享变量、styles/ 的职责层、native.css 与内嵌 glass/lab.css 按顺序安装为单个样式节点；开发时可强制替换样式而不重建胶囊。
- [styles/AGENTS.md](styles/AGENTS.md)：变量、布局、内容、控件、材质与动画分层。
- [effects.js](effects.js)：高光和视线跟踪；不读取业务正文。
- [geometry.js](geometry.js)：位置、内嵌收放形变、吸边、尺寸与滚动位置；弹出强制保持展开；宿主边界来自 host/host-appearance。
- [shell.js](shell.js)：表情派生、完成光效与视图过渡；不负责识别宿主。
- [interaction.js](interaction.js)：表情鼠标单击等待 100ms 收放、稳定外层识别双击窗口切换，记录首击前 open 并取消首击触发的收放后直接弹出，拖拽、固定对角 1:1 缩放、排序和快捷键；原生手势交给 popout/transport；连续缩放仅更新几何，结束时保存尺寸；窗口交接缩放不保存中间尺寸。
- [settings-view.js](settings-view.js)：胶囊设置模板和内嵌与弹出“外观”框内液态旁中性色星星（空心 Regular、实心 Clear）等控件绑定；网络操作交给 runtime/settings-sync。
- [views.js](views.js)：创建胶囊 DOM、组合视图与下一步预览交互，选择工作台时委托双面板渲染；表情提示单/双击及拖动，弹出眼睛单击不收起、双击收回。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。
