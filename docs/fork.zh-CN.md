# pi-web-gui 使用说明（本仓库 = 你的本地分支）

这是 `agegr/pi-web` 的个人分支，只改了界面，其它功能（文件浏览、Git diff、worktree、模型与插件配置、技能、终端、会话搜索/重命名/导出/删除、分支与「从此处编辑」）与官方版一致。命令行、数据目录都与官方版共用 `~/.pi`，不需要迁移。

## 启动

```bash
cd F:/documents/software/pi-web-gui
npm run dev          # 开发模式，http://127.0.0.1:30141
npm run build && npm start   # 生产模式，同一个端口
```

官方版（`npx @agegr/pi-web`）默认也用 30141，两者不能同时监听同一个端口：先关掉一个，或者用
`npx next dev -H 127.0.0.1 -p 30142` 起本分支、把 30141 留给官方版做回退。

日常使用请用下面的桌面快捷方式/启动器；`npm run dev` 适合在终端里调试。

## 桌面快捷方式 / 启动器（Windows）

桌面和开始菜单里的 **Pi Web** 快捷方式 → `%LOCALAPPDATA%\pi-web\pi-web-start.vbs`（后台无窗口）→
`start-pi-web.cmd`。这个启动器**已经指向本仓库**（默认 dev 模式、端口 30141），参数可以随时切换：

| 参数 | 作用 |
| --- | --- |
| *（无参数）* | 启动本仓库，**dev 模式**（热重载，无需构建），端口 30141 |
| `30142` | 换端口：任何非关键字参数都当作端口号（1–65535） |
| `prod` | 用本仓库的**生产构建**启动（更快更稳，需要先构建） |
| `rebuild` | 先构建（自动带 `NODE_OPTIONS=--max-old-space-size=8192`，8 GB 是 V8 老生代上限、不是总内存），再按 `prod` 启动 |
| `official` | 回到 npm 安装的官方包 `@agegr/pi-web` |
| `quiet` | 不打印自己的输出，日志写入 `pi-web-<端口>.log`（隐藏窗口是快捷方式的 VBS 负责的，不是这个参数） |
| `dry` | 只打印解析后的 target/mode/port/日志路径，不启动任何东西 |
| `help` | 打印用法 |

- 端口已被占用时：只打开浏览器、不再起第二个实例，并说明占用者是谁（本分支 / 官方包 / 别的程序）以及你请求的是哪个 target，然后以退出码 100 结束（快捷方式据此认为「已在运行」）。
- **每个端口一个日志**：`pi-web-<端口>.log`，两个实例不会互相截断或占用日志；参数错误在端口确定前写入 `pi-web-launcher.log`。
- 停止：`stop-pi-web.cmd [端口] [force]`（默认 30141）。它只接受看起来是 pi-web 的进程（本仓库 / `@agegr/pi-web` / Next 的 dev·prod 入口），其它一律拒绝并提示加 `force`；`taskkill /F` 是强制结束，不会优雅关闭正在跑的 agent。
- dev 模式对同一个仓库目录只能有一个实例（Next 的 `.next/dev/lock`，启动器会提示）；prod 模式没有这个限制，可以和官方版同时跑在不同端口。`rebuild` 在 dev 实例运行时会被拒绝（构建会同时弄坏两边）。
- 改默认值：编辑 `start-pi-web.cmd` 顶部的 `set "FORK=..."`、`set "MODE=dev"`，或用环境变量 `PI_WEB_FORK` 覆盖仓库路径。原文件备份为同目录的 `start-pi-web.cmd.orig-backup`。
- 这些文件的版本化副本在仓库的 `scripts/windows/pi-web/`（含说明），换机器时复制到 `%LOCALAPPDATA%\pi-web` 即可。

### 两个实例同时跑（共用 `~/.pi`）

读历史是安全的，**两个写入者同时写同一个会话文件不安全**：不要在两个实例里对同一个「正在运行」的会话发消息、重命名、删除或做分支；「运行中/完成」是各服务端自己的状态，不代表归属。想完全隔离第二个实例，用 `PI_CODING_AGENT_DIR` 指向另一个 agent 目录。

## 上游状态（2026-10-06 查）

- `upstream/main` = `6fcd7d4`（= 本分支的基线 = npm 最新版 `0.10.0`），**领先 0 个提交**；npm 最新版本也是 `0.10.0`。
- 复查命令：`git fetch upstream && git log --oneline 6fcd7d4..upstream/main`。
- 未来合并的冲突面主要是我们改得最多的两个文件：`components/AppShell.tsx`（+552/−74）、`components/SessionSidebar.tsx`（+318/−40）；新文件（`SessionTabBar.tsx`、`lib/session-tabs.ts`、`lib/session-status.ts`、`lib/project-accordion.ts`）不与上游同文件冲突。
- 上游相关的公开提案：#910（open，「Active 侧栏视图」，跨项目活动+置顶）与 #982（PR，已关闭未合并）；已合并的 #887 是「每个浏览器标签页记住一个会话」，都不是应用内 keep-alive 标签页，所以本分支没有被上游取代。
- **推送**：`origin` = `https://github.com/Hhidysn/pi-web-gui`（**私有**，个人备份/版本）。`main` 始终等于上游基线（目前 `6fcd7d4`），本分支的改动都在 `feat/multi-project-tabs` 上；日常 `git push origin feat/multi-project-tabs`。`upstream` 仍指 `agegr/pi-web`，将来合并用 `git fetch upstream`。改可见性/删除：`gh repo edit Hhidysn/pi-web-gui --visibility public` / `gh repo delete Hhidysn/pi-web-gui`。

## 新功能怎么用

### 1. 对话标签页（一个窗口里开多个会话）

- 从侧栏点开一个会话，它就会在聊天区上方开一个标签；再点别的会话就多一个标签，可以跨项目。
- 标签栏在聊天区顶部：`运行中`（转圈）/ `完成`（绿勾）/ 无状态（空）三种状态直接标在标签上。
- 切换标签不会重新加载、也不会打断正在跑的任务：后台标签继续接收输出，切回来内容还在原处（滚动位置、展开的「处理过程」都保留）。
- 标签可拖动排序、中键或点 × 关闭；**关闭标签不会删除会话**，会话仍在侧栏里。
- 刷新页面后标签会恢复，并回到地址栏里那个会话。
- 默认最多同时开 5 个标签（每个标签都是一个常驻的会话视图，占内存）。需要更多就在浏览器控制台执行：
  `localStorage.setItem("pi-web:max-open-tabs", "8")`，改回默认则 `localStorage.removeItem("pi-web:max-open-tabs")`。

### 2. 侧栏按项目分组（所有项目同时可见）

- 侧栏现在是「项目 → 会话」的折叠列表，不再需要用下拉框切项目；项目按最近活跃排序。
- 点项目行展开/收起；展开状态会被记住。
- 项目行右侧的 `+` 表示 **在该项目里新建会话**（会顺带把工作区切到那个项目）；鼠标悬停或该项目为当前工作区时才显示。
- 项目行上的数字分别是会话数，以及「运行中 / 完成 / 未读」的计数。
- 项目行最右边的**斜杠眼睛** = **从侧栏移除这个项目**（一直显示，悬停变亮；触屏也点得到）。它只是不在列表里显示：**不删除任何对话**，不向服务端发请求，会话文件、标签页、状态都不变。
- 移除过的项目会在列表下方多出一行「已隐藏 N 个项目」；点开可以看到项目路径、会话数和「重新显示」按钮，随时放回来。移除状态存在浏览器里（`pi-web:hidden-project-keys`），刷新后仍然保持。
- 移除后即使打开该项目里的会话，该项目也不会自动回到列表（标签页上照样显示「运行中 / 完成」）；要恢复就用上面那行。
- 打开任意目录作为新项目：仍然用左上角 `+ New` 旁的项目选择器 → 选择/输入路径（或「默认目录」）。

### 3. 状态含义

| 状态 | 含义 | 何时消失 |
| --- | --- | --- |
| 运行中 | 该会话正在跑（来自服务端的运行集合轮询） | 跑完 |
| 完成 | 跑完且你还没打开过它 | 打开该会话，或 30 分钟后 |
| 无状态 | 既没在跑、也不是刚跑完 | — |

（侧栏里被「移除」的项目不会显示这些状态；它的标签页上仍然显示。）

## 自检命令

```bash
npx tsc --noEmit                                   # 类型
npx eslint components lib                          # 静态检查
node --experimental-strip-types --test lib/session-tabs.test.mjs lib/session-status.test.mjs lib/project-accordion.test.mjs components/SessionSidebar.test.mjs components/AppShell.tab-session.test.mjs
npm run test:tabs                                  # 标签/分组/状态的浏览器端到端测试
npm run test:e2e                                   # 官方整套端到端测试（较慢）
```

Playwright 的内置浏览器若未下载，用系统浏览器跑：
`E2E_BROWSER_CHANNEL=msedge npm run test:tabs`。

端到端测试会自己起一个 dev 实例（需要 `.next/dev/lock`）。如果此时你正在跑 `npm run dev`，测试实例会启动失败（`Another next dev server is already running`）——先停掉 dev 实例再跑，或者用下面的方式对**正在运行的**服务做只读检查：

```bash
node test-results/live-check.mjs      # 需要 127.0.0.1:30141 上已有实例；用全新浏览器配置，只读
```

不要为了绕开锁而在 git worktree 里把 `node_modules` 做成指向主仓库的 junction：Turbopack 会报 `Symlink ... points out of the filesystem root`，而且 `git worktree remove` 会顺着 junction 删掉主仓库 `node_modules` 里的文件（npm install 可以补回来，但没必要冒这个险）。

## 已知取舍

- 每个打开的标签都保持挂载（否则切换会重新加载），所以标签越多内存占用越高，默认上限 5。
- 「完成」是浏览器端按 30 分钟窗口推算的，时间戳存在浏览器里，所以刷新页面后仍会保留；打开该会话会立即清除；「运行中」始终以服务端为准。
- 「移除项目」是浏览器本地偏好（`localStorage`）：换个浏览器/隐身窗口就看不到隐藏，也不影响 `~/.pi` 里的任何文件；隐藏中的项目只能从列表下方的「已隐藏 N 个项目」行恢复。
- Esc 只停止「当前显示的」会话：后台标签里的运行不会因为按 Esc 被误停。后台标签在空闲时会让出会话（不长期占用进程），正在运行时仍持续接收输出。
- 本分支的界面改动都在 `components/` 与 `lib/`（详见 `docs/adr/0007-conversation-tabs-and-project-accordion.md`），没有改服务端接口。
