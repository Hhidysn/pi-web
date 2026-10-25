# 当前分支与官方版本的差异

核对日期：2026-10-25。以下统计基于文档提交前的代码版本 `adcc73e`；本次文档改动不计入统计。

## 结论

当前日常分支沿用官方侧栏布局，额外改动集中在远程开发访问、启动缓存、外部子会话发现、模型发现、Windows 启动器和后台完成通知。自定义顶部多会话标签、隐藏／恢复项目没有合入这条分支；侧栏的隐藏页轮询行为已有本地调整。

适合先向上游反馈的是可独立复现的小问题：Discover 丢失显式 `reasoning: false`，以及受信任反向代理域名未进入 Next 开发资源白名单。嵌套子会话与 Magpie 专属字段属于兼容扩展，需要先讨论范围。具体候选、已有 issue 和复现材料见 [上游反馈评估](history/2026-10-24-upstream-issues.zh-CN.md)。

## 比较的是哪几条分支

个人仓 [Hhidysn/pi-web](https://github.com/Hhidysn/pi-web) 是 [agegr/pi-web](https://github.com/agegr/pi-web) 的 GitHub fork，默认分支为 `main`。

| 引用 | 核对时版本 | 含义 |
| --- | --- | --- |
| 当前分支 `codex/official-sidebar-tailscale` | `adcc73e` | 文档提交前的代码实现 |
| `origin/codex/official-sidebar-tailscale` | `adcc73e` | 核对时已推送的同名分支 |
| `origin/main` | `8e602ca`，package 0.11.0 | fork 中保留的官方代码快照 |
| `upstream/main` | `e533d9b`，package 0.12.2 | 本次 fetch 后的官方上游版本，已被当前分支合入 |
| 本地 `main` | `6fcd7d4`，Release v0.10.0 | 更旧的本地引用，不是本次差异基线 |

`origin/main` 是 `upstream/main` 的祖先，中间有 133 个上游提交。代码版本 `adcc73e` 又比 `upstream/main` 多 8 个提交：7 个本地改动提交和 1 个合并提交。

| 比较 | 提交关系 | 文件差异 |
| --- | --- | --- |
| `origin/main` → `adcc73e` | 领先 141 个提交、落后 0 个 | 429 个文件，+26592 / -8965；包含大量官方更新 |
| `upstream/main` → `adcc73e` | 领先 8 个提交、落后 0 个 | **33 个文件，+1468 / -45；这是本地维护的代码与配套说明范围** |
| `origin/codex/official-sidebar-tailscale` → 当前分支 | 领先 0、落后 0 | 已提交文件无差异 |

因此，不应把与 fork 的旧 `main` 相比的 429 个文件整体当作我们的实现提交上游。

## 本地实现清单

### 1. Tailscale／反向代理访问开发服务器

- 提交：`1b8cc91`。
- 问题：应用允许访问某个代理域名，不代表 Next 的开发脚本与 HMR 也允许该来源。
- 实现入口：[next.config.ts](../next.config.ts) 的 `allowedDevOrigins`（核对时第 60 行）读取 `PI_WEB_ALLOWED_HOSTS`，按逗号拆分、去空白和空项，再与原有开发来源合并。
- 配置说明：[tailscale.md](tailscale.md)。监听仍由启动命令决定；该改动本身不创建 Serve 映射、不开放端口，也不修改应用的认证与 Host 校验。
- 范围：开发服务器的受信任域名配置；不是 Tailscale 或 Clash 的网络稳定性修复。

### 2. 本机开发入口清理旧 Service Worker 缓存

- 提交：`9df1d5f`。
- 原始问题：从已有生产版本切回开发版本时，旧 Service Worker 可能仍控制页面。当前开发模式已注册 push-only worker，但不依靠它清理历史静态缓存。
- 实现入口：[public/open-dev.html](../public/open-dev.html)（第 8 行起），在 Next 客户端模块加载前执行。
- 只在 loopback 主机名下清理同源 `/sw.js` 的非 push-only 注册和 `pi-web-static-*` Cache Storage，再跳转到 `/`；保留 `mode=push-only` worker，不读取或清理登录 cookie、localStorage 草稿和其他缓存。
- 代理／手机来源访问该页面时只跳转，不执行清理。此入口按主机名判断，不是 `NODE_ENV` 判断。
- 回归测试：[public/open-dev.test.mjs](../public/open-dev.test.mjs)；维护说明：[client-platform.md](agents/client-platform.md)。
- **接入缺口：仓库中的 Windows 模板仍打开 `/`，没有自动选择 `open-dev.html`。本机安装的启动器有这一步。** 不能把模板与本机安装状态当作同一份实现。

### 3. 发现 pi-subagents 扩展写出的嵌套会话

- 提交：`9abf8ca`。
- 识别的布局：`<project>/<timestamp>_<parent-id>/<run-id>/run-<n>/session.jsonl`，且要求同级存在父会话 `.jsonl`。
- 核心入口：[lib/nested-subagent-sessions.ts](../lib/nested-subagent-sessions.ts) 第 76、111、132 行分别负责枚举、按会话头 ID 查找和推导父子关系。
- 接入点：[lib/session-list-scanner.ts](../lib/session-list-scanner.ts) 第 498 行把文件纳入扫描；[lib/session-reader.ts](../lib/session-reader.ts) 第 213、438 行处理列表关系和缓存未命中的 ID 查找；[详情 API](../app/api/sessions/[id]/route.ts) 第 118 行补充关系。
- 使用既有 `relation.kind = "subagent"` 展示能力；没有修改官方侧栏组件，也没有启动或接管扩展的子进程。
- 边界：只识别上述布局，不覆盖 `forks/` 或任意深度递归；历史行状态写为 `interrupted`，不把它当作扩展实际运行／完成状态。它是历史发现兼容，不是另一套扩展的完整支持。
- 读取可见性不代表会话写入权归属。把该历史切到主聊天再发送，可能成为第二个写入方；不要与仍在写同一文件的扩展同时操作。此次未验证嵌套会话家族删除或跨项目重复 ID。
- 实现说明与测试索引：[sessions.md](agents/sessions.md)、[subagents.md](agents/subagents.md)、[nested-subagent-sessions.test.mjs](../lib/nested-subagent-sessions.test.mjs)、[session-reader.test.mjs](../lib/session-reader.test.mjs)、[runtime-route.test.mjs](../app/api/sessions/runtime-route.test.mjs)。

### 4. 模型 Discover 的字段兼容与显式 false

- 提交：`b5c478e`、`faac8a9`；均在 [lib/model-discovery.ts](../lib/model-discovery.ts)，未增加 provider、运行时依赖或新设置页。
- 推理能力：第 58 行保留能力字段中首先出现的布尔值，区分 `true`、`false` 和未声明；第 98 行不再丢弃显式 `false`。
- 档位列表：第 73 行兼容 `supported_efforts`、`supportedEfforts`、`supported_reasoning_levels`，条目可以是字符串或含 `effort` 的对象；只映射 Pi 认识的档位，未支持的档位标为 `null`。未声明 `off` 时不自行补上；`none`、`ultra` 不被强行转换。
- 常规已支持级别写成同名映射，属于表示方式变化，不能单独当作已经证明的行为修复。列表只有 `off` 而没有其他已知级别时，不生成映射；多个别名同时存在时取第一个数组，不合并。
- 显示名：第 118 行优先使用网关 `magpie_label`，之后才尝试通用显示名字段。
- 上下文窗口、输出上限等通用能力读取在官方已有实现中存在，不能把整套 Discover 能力归为本地新增。
- 测试与说明：[model-discovery.test.mjs](../lib/model-discovery.test.mjs)、[models.md](agents/models.md)。向上游反馈时，应把通用 `false` 丢失问题与网关专属字段兼容分开。

### 5. Windows 自用启动器模板

- 提交：`aa9452a`；[scripts/windows/pi-web](../scripts/windows/pi-web/README.md) 中有四个脚本，`.gitattributes` 规定 `.cmd`／`.vbs` 使用 CRLF。
- 默认目标是当前 fork 的开发模式，也可选已安装官方包、生产模式、端口、dry-run；通过 VBS 隐藏启动窗口，并提供停止脚本。
- 属于自用部署工具，有默认本机路径和内存设置。`stop-pi-web.cmd` 使用强制结束进程树，不能描述为优雅退出。
- 本次核对：仓库模板与 `%LOCALAPPDATA%\pi-web` 中的 `start-pi-web.cmd`、`open-when-ready.cmd`、`stop-pi-web.cmd` 哈希不同；`pi-web-start.vbs` 相同。
- 本机启动器会选择 `open-dev.html` 并探测 `/api/web-auth`；仓库模板尚未同步。安装前见 [模板差异说明](../scripts/windows/pi-web/README.md)。

### 6. 后台完成提示与开发模式推送

- 提交：`adcc73e`。
- 侧栏轮询：[SessionSidebar.tsx](../components/SessionSidebar.tsx) 为隐藏页继续安排 15 秒轮询，可见页仍用 2.5 秒。浏览器可能进一步节流或冻结页面，不保证精确间隔或锁屏持续运行。
- 提示音：[useAudio.ts](../hooks/useAudio.ts) 的 AudioContext 恢复等待预算按调用时可见性取值：可见 3 秒、隐藏 90 秒。它控制是否丢弃恢复过晚的提示音，不是任务超时，也不是推送投递时限。
- 开发 worker：[PwaRegistration.tsx](../components/PwaRegistration.tsx) 注册 `/sw.js?v=...&mode=push-only`；[sw.js](../public/sw.js) 在该模式下不预缓存、不执行 fetch 响应接管，保留 push／notificationclick。生产模式仍走原有缓存分支，不能描述为生产文件逐行未变。
- 注册入口：[SettingsPanel.tsx](../components/SettingsPanel.tsx) 在点击内先请求通知权限，再等待 worker 就绪并调用已有订阅流程。VAPID、订阅存储和任务完成时的服务端发送在官方已有实现中存在，不是本地从零新增。
- 本机入口保留 push-only worker，避免每次启动删除已经建立的推送能力；见第 2 项。
- 2026-10-25 实机：安卓 Via 7.3.4 注册返回 `unsupported or not permitted`，不能仅凭该文案断定是 API 缺失还是权限限制。改用 Edge 155，开启安卓应用通知、允许本站通知并添加 Pi Web 主屏幕图标；图标已验证可打开。
- 服务端保存了 1 条订阅；直接发送标明“推送测试”的消息，推送服务返回 HTTP 201，浏览器退到后台后手机通知栏实际显示该消息。这验证了订阅和系统通知送达，**未验证真实 `agent_settled` 触发、锁屏送达及长期后台可靠性**。操作步骤见 [手机推送配置](tailscale.md#后台通知与主屏幕入口)。

## 不属于当前分支改动的内容

| 内容 | 当前归属／状态 |
| --- | --- |
| 项目分组、官方侧栏布局、文件面板和顶部文件标签 | 官方实现；`session-tree.ts`、`sidebar-actions.ts`、`sidebar.css` 与 `e533d9b` 无差异；`SessionSidebar.tsx` 有后台轮询改动，`AppShell.tsx` 有提示音调用说明 |
| 自定义顶部多会话标签 | 旧分支 `feat/multi-project-tabs`，未合入当前分支 |
| 隐藏／恢复项目 | 独立分支 `codex/sidebar-project-visibility`，未合入当前分支；已有上游 [#764](https://github.com/agegr/pi-web/issues/764) |
| 手机共用 Tailscale 覆写脚本 | 本机下载目录及手机 FlClash 中的设备配置，不在当前 Git diff 中 |
| Serve 8443、原有 Funnel、密码、环境变量、快捷方式、自启 | 本机运行状态，不是这些提交部署出来的代码 |
| Clash／FlClash 节点切换与连接超时 | 网络问题；不能据此认定 Pi Web 分支回归或已有根治 |

## 本次验证与复查方法

已刷新 `origin`、`upstream` 远端跟踪引用，核对 GitHub fork 归属、默认分支、祖先关系、提交列表及文件差异。文档整理前跟踪文件干净，只有用户附件目录未跟踪。

2026-10-24 在 `aa9452a` 运行 `node --test public/open-dev.test.mjs`：当时 3 项通过。`adcc73e` 新增保留 push-only worker 的用例，旧测试计数不能代表新版验证。

同日只读代理实际运行以下定向测试：59 项中 58 项通过、0 失败、1 项跳过（Windows 下的项目 symlink 用例）。与当时入口测试合计 62 项，61 通过、1 跳过；这是 `aa9452a` 的历史检查记录。

```powershell
node --test lib/nested-subagent-sessions.test.mjs lib/model-discovery.test.mjs lib/session-reader.test.mjs app/api/sessions/runtime-route.test.mjs
```

另用同一份最小输入 `{data:[{id:"plain-model",reasoning:false}]}` 分别运行两个固定 revision 的 `parseDiscoveredModels()`：`e533d9b` 输出 `[{"id":"plain-model"}]`，`aa9452a` 输出 `[{"id":"plain-model","reasoning":false}]`。这是解析行为对照，不代表本次测过真实网关或 UI。

2026-10-25 在 `adcc73e` 重新运行通知相关定向测试：54 项全部通过。覆盖 worker 推送／点击、push-only 不接管请求、开发入口保留推送 worker、订阅保存和侧栏既有行为；不据此宣称后台轮询或音频在真实浏览器中按时执行。

```powershell
node --test public/sw.test.mjs public/open-dev.test.mjs lib/web-push.test.mjs lib/browser-notifications.test.mjs lib/session-liveness.test.mjs components/SessionSidebar.test.mjs
```

手机后台推送实测见第 6 项；没有把代码链路完整等同于真实任务／锁屏验收。文档整理不执行 build，也不重启开发服务器或切换分支；长期远程访问稳定性不属于本次验收结论。

```powershell
git fetch origin
git fetch upstream
git rev-parse HEAD origin/main upstream/main
git rev-list --left-right --count origin/main...HEAD
git rev-list --left-right --count upstream/main...HEAD
git log --no-merges --oneline upstream/main..HEAD
git diff --stat upstream/main...HEAD
```

远端继续更新后，以上计数会变化；复查当前已记录实现时用固定基线 `e533d9b` 与 `adcc73e`，不要把文档日期当成版本标识。
