# styles/ — 胶囊样式

> L2 | 父级：[AGENTS.md](../AGENTS.md)

install-styles 安装 ui/shared/tokens.css、theme/tokens、外壳样式、features/content、theme/materials 与 desktop/legacy/native.css；不使用全局 reset，不影响宿主元素。几何尺寸常量由 shared/constants 注入，间距、圆角和基础语义色共享 ui/shared/tokens.css。data-material 保存选择，data-effective-material 决定当前外观。

- [layout.css](layout.css)：左栏入口启用时隐藏紧凑胶囊；胶囊作用域内的基础规则、外壳、眼睛、标题和窗口几何，表情键盘焦点使用中性色细线；胶囊与所有工作台位置共用透明工具按钮，悬停改变前景、按下轻缩放、键盘焦点细轮廓；不依赖宿主 reset。
- [controls.css](controls.css)：统一控制图标尺寸、沿用公共工具图标中性色焦点、显式设置选择器、材质入口和与材质同框、文字保持整行居中、右侧独立命中的中性色空心/实心 Clear 星星按钮、焦点与基于胶囊宽度的容器查询；不按宿主窗口宽度改变间距。
- [motion.css](motion.css)：过渡、关键帧和减少动态效果规则（关闭过渡，不以 1ms 意外激活宽高动画）；完成扫光 900ms，胶囊就绪表情仅播放一次，展开阅读不循环；手势几何由 geometry.js 管理，内嵌展开节奏由 shared/constants 限定为 320–420ms。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。
