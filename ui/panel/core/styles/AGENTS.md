# styles/ — 胶囊样式

> L2 | 父级：[AGENTS.md](../AGENTS.md)

install-styles 依次安装 ui/tokens.css、下列六层、popout/native.css；不使用全局 reset，不影响宿主元素。几何尺寸常量由 runtime/constants 注入，间距、圆角和基础语义色共享 ui/tokens.css。data-material 保存选择，data-effective-material 决定当前外观。

- [tokens.css](tokens.css)：宿主语义色映射、材质参数和外壳变量。
- [layout.css](layout.css)：胶囊作用域内的基础规则、外壳、眼睛、标题和窗口几何；不依赖宿主 reset。
- [content.css](content.css)：建议、预览、大纲和内容状态。
- [controls.css](controls.css)：设置控件、材质入口和与材质同框、文字保持整行居中、右侧独立命中的中性色空心/实心 Clear 星星按钮、焦点与基于胶囊宽度的容器查询；不按宿主窗口宽度改变间距。
- [materials.css](materials.css)：共用 CSS 哑光、近似 HUDWindow 的中性染色/均匀模糊磨砂及两种原生材质共用的透明前景；网页表面用主题中性柔光与浅阴影定位，原生液态不叠加此层，弹出哑光与原生磨砂仅保留透明留白内的一层圆角浅阴影；没有旧位移滤镜。
- [motion.css](motion.css)：过渡、关键帧和减少动态效果规则；完成扫光 900ms，胶囊就绪表情仅播放一次，展开阅读不循环；手势几何由 geometry.js 管理，内嵌展开节奏由 runtime/constants 限定为 320–420ms。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。
