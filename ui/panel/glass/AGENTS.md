# glass/ — 内嵌液态 SVG

> L2 | 父级：[AGENTS.md](../AGENTS.md)

正式与开发构建均包含，不采集聊天画面、不依赖第三方渲染库。已选定 B 版凸面透镜；Regular/Clear 共用折射几何与动效，区别为后置模糊和底色。A 版已归档，A/B 对比入口移除。

- `lab.js`：appearance/stop 生命周期、几何更新、减少透明度与共享 liquidVariant 同步；清理旧比较偏好，退出清理节点、监听器与帧任务。
- `lens.js`：自有凸面曲线与 Snell 折射位移，折射率 3，厚度随边缘尺度变化，不使用 RGB 分离。
- `svg.js`：refresh(variant) 使用同一张透镜贴图；Regular 4px 模糊、Clear 保持 B 版 0.3px，饱和度均为 100%；仅尺寸或圆角变化时重建贴图。
- `lab.css`：Regular 浅色 28%/深色 24% 底色；Clear 保持 B 版 6% 底色；共用内反光、轻外阴影与指针高光，不提供失焦染色分支。

“外观”框内液态旁独立星星切换共享 liquidVariant，未点亮 Regular，点亮 Clear。内嵌 SVG、原生弹出与 Web 设置同步同一偏好；弹出继续由 AppKit 渲染。减少透明度或 SVG 未支持时沿用 CSS 磨砂回退。

验证：npm run test:glass 检查双变体像素差异、同图复用、热重载、控件边界、清理与实时背景；npm run test:e2e 检查网页与窗口偏好同步；原生检查独立执行。合成截图不替代宿主现场验收。

[PROTOCOL]: 结构或契约变化时更新本文并核对父级地图。
