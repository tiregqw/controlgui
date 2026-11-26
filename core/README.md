# ControlGUI Core

这是 ControlGUI 通用批注核心的唯一维护入口。核心开发、构建和测试不需要安装或运行 DSH、BitFun；只需要 Node.js 24+ 和 pnpm。

## 文件结构

| 文件 | 职责 |
| --- | --- |
| index.ts / manifest.json | 插件贡献与版本清单 |
| controlGuiInspector.ts | DOM 元素、文本范围拾取与悬浮高亮 |
| controlGuiFloatingEditor.ts | 深色批注编辑器与 CSS 属性展示 |
| controlGuiMarkers.ts | 已保存批注的编号标记 |
| annotationProtocolV1.ts / controlGuiAnnotations.ts | 批注数据、校验、草稿与 Prompt 格式 |
| contracts.ts / runtimePackage.ts | 兼容 v1 的接口与插件包序列化、校验、还原 |
| theme.ts | 原主题常量的独立快照，不再依赖 BitFun 主题包 |
| build.mjs / load-core.mjs | 独立构建 |
| *.test.ts / package.test.mjs | DOM 和插件包测试 |

## 独立开发

进入本仓库的 core 目录：

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm test
pnpm test:dom
```

输出：dist/controlgui-0.1.1.bitfun-plugin.json。构建器使用固定版本的 Vite 转换 TypeScript，因为编辑器与标记会序列化函数体；不能直接用 Node 的类型擦除替代，否则生成字节不同。构建与包一致性测试以当前公开版为准。

## 在宿主中测试新包

- **BitFun**：已经适配的宿主打开插件管理面板，选择安装本地插件，导入 core/dist 中的 JSON 文件。无需修改或重新构建 BitFun。
- **DSH**：在已安装的 DSH 插件目录运行 node install-shared-package.mjs "完整路径/ControlGUI/core/dist/controlgui-0.1.1.bitfun-plugin.json"，刷新预览。若要恢复旧批注实现，执行 node install-shared-package.mjs --remove。
- 不要直接在 BitFun 的原有内置源码副本中继续开发核心；该副本保留为内置回退，宿主专属的 React 面板、注册表与原生 WebView 生命周期仍由 BitFun 负责。
- v1 保留旧的事件名、脚本全局变量及格式标识（bitfun-browser-annotation-v1），DSH 安装器负责桥接 IPC 引用。它们属于兼容协议，不代表构建依赖 BitFun。

## 发布新核心版本

1. 修改本目录的源码和测试；协议兼容时更新 manifest.json 及 core/package.json 的核心版本号。
2. pnpm build 生成候选包，在两个宿主中安装候选包并验证。
3. 正式发布前从 core 目录执行 node build.mjs ../assets/shared-controlgui.bitfun-plugin.json 更新仓库随附的共享包，然后在仓库根目录执行 node install-shared-package.mjs core/dist/对应版本.bitfun-plugin.json 重新生成 DSH 默认桥接脚本（注意构建输出文件名随 manifest 版本变化）。
4. pnpm test 与 pnpm test:dom；包一致性测试要求本次生成包与仓库随附共享包一致，避免源码与正式产物漂移。
5. 如需更新 BitFun 的内置回退快照，再单独同步宿主适配补丁，并重新进行宿主回归测试。
6. 更新 CHANGELOG，提交源码与产物，创建新的 Git tag 和 Release；不改动旧标签。

独立核心版本和跨宿主集成发布版本分别管理：当前核心 manifest 为 0.1.1，集成发布为 v0.4.0。现有版本的底层通信协议与已安装宿主保持兼容。

本目录的测试覆盖核心行为和包格式；不替代两个宿主的原生 WebView 和真实 Agent 会话端到端测试。


## 可视化 CSS 编辑器（core 0.1.1）

选中真实 DOM 元素后，批注面板提供 34 个预置 CSS 属性和高级属性搜索。
输入有效 CSS 值立即预览；颜色字段支持系统原生拾色器、hex/rgb 文本输入。
可逐项恢复或恢复原样。保存时自动生成「原计算值 → 新值」的文本差异，
通过现有批注协议发送；无需额外输入自然语言。保存、取消、关闭、重新选取时
临时样式恢复，源码由 Agent 修改，未将临时预览写入文件。

支持标准且浏览器可接受的 CSS 属性；暂不支持自定义 CSS 变量及可能加载外部资源
的值及伪元素。支持单一直接文本节点及选中的文字节点的文字预览，不替换复杂 HTML 或表单值。文字范围的 CSS 预览作用于其父元素。
如页面在预览期间自行改变 inline style，工具尽量保留外部编辑并要求重新选择。
CSS 差异与文字批注总长仍遵守 3000 字符限制。

发布包：core/dist/controlgui-0.1.1.bitfun-plugin.json。
已安装兼容 v1 插件加载器的 BitFun 可直接导入该 JSON；内置源码同步补丁
adapters/bitfun/controlgui-bitfun.patch 可选，用于更新内置回退版本。
DSH 使用 install-shared-package.mjs 安装新版包并刷新预览。

窄窗口优先在目标上下或左右选择无重叠空间，面板随空间缩短并滚动。拖动标题左侧手柄可手动定位，双击手柄恢复自动定位；「查看效果」收起面板而不丢弃预览，「继续编辑」恢复。保存或关闭时恢复临时 CSS 和文本。
