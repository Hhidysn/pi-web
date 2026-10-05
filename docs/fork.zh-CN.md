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
- 打开任意目录作为新项目：仍然用左上角 `+ New` 旁的项目选择器 → 选择/输入路径（或「默认目录」）。

### 3. 状态含义

| 状态 | 含义 | 何时消失 |
| --- | --- | --- |
| 运行中 | 该会话正在跑（来自服务端的运行集合轮询） | 跑完 |
| 完成 | 跑完且你还没打开过它 | 打开该会话，或 30 分钟后 |
| 无状态 | 既没在跑、也不是刚跑完 | — |

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

## 已知取舍

- 每个打开的标签都保持挂载（否则切换会重新加载），所以标签越多内存占用越高，默认上限 5。
- 「完成」是浏览器端按 30 分钟窗口推算的：刷新页面后已消失；「运行中」始终以服务端为准。
- 本分支的界面改动都在 `components/` 与 `lib/`（详见 `docs/adr/0007-conversation-tabs-and-project-accordion.md`），没有改服务端接口。
