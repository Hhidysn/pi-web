# 上游反馈评估与草稿（2026-10-24）

本文是讨论记录，尚未向上游发布。实现事实和固定比较基线见 [当前分支差异](../fork-status.zh-CN.md)。上游版本为 `e533d9b`，本地版本为 `aa9452a`。

## 2026-10-25 补充：后台完成通知

新增提交 `adcc73e` 为隐藏页保留慢轮询、按可见性调整提示音恢复预算，并在开发模式注册不缓存／不接管 fetch 的 push-only worker。它没有重写原有 VAPID、订阅和任务完成发送链。

若反馈上游，宜把「开发模式无法注册推送 worker」与「隐藏页完成提示」分开讨论。前者可用生产／开发模式对照；后者受浏览器后台执行策略约束，不能把 15 秒定时器或 90 秒音频恢复预算描述为通知时延保证。

安卓 Edge 已保存订阅并收到直接发送的后台测试通知，Via 注册失败；真实任务完成与锁屏尚未实测。操作与证据边界见 [手机推送配置](../tailscale.md#后台通知与主屏幕入口)。以下 10 月 24 日候选保留原比较版本，不代表对新增提交做过同等复现。

## 选择建议

| 候选 | 建议 | 原因／已有讨论 |
| --- | --- | --- |
| Discover 保留 `reasoning: false` | 优先；按独立 bug 反馈 | 能用小 JSON 样本复现；与已完成的通用元数据发现 [#856](https://github.com/agegr/pi-web/issues/856) 区分 |
| 代理域名访问 Next 开发资源 | 优先；先补最新 main 的完整复现 | 改动小，不绑定 Tailscale 产品；只复用明确配置的受信任域名 |
| 生产 → 开发切换后遗留 worker | 可反馈，但先补真实浏览器复现 | [#1088](https://github.com/agegr/pi-web/issues/1088) 已解决另一种冷缓存阻塞；不能照抄为同一问题；本地模板接入尚不完整 |
| 外部扩展的嵌套会话发现 | 暂留 fork；确有新证据再问范围 | [#1041](https://github.com/agegr/pi-web/issues/1041#issuecomment-6064897263) 已明确“不计划”支持另一套存储／配置模型 |
| Magpie 显示名与档位别名 | 可先保留自用，或附在独立兼容提案 | `magpie_label` 等不是统一接口；不要与通用 bug 打包 |
| Windows 启动器整套模板 | 暂不作为完整 PR | 本机路径／内存假设及模板与安装版本差异需要先整理 |
| 隐藏／恢复项目、旧顶部多会话标签 | 不作为当前分支实现反馈 | 未合入日常分支；项目隐藏已有 [#764](https://github.com/agegr/pi-web/issues/764) |

上游 [CONTRIBUTING.md](../../CONTRIBUTING.md) 第 42 行起要求功能先开 issue、每个 PR 只处理一个改动；bug 要提供官方 `main` 复现。这里的“优先”是选题建议，不表示补丁已达到提交 PR 的全部检查要求。

## 候选一：Discover 丢弃显式非推理能力

建议标题：`Model discovery should preserve an explicit reasoning: false`

可用问题描述：

> 当 provider 的模型列表明确返回 `reasoning: false` 或 `supports_reasoning: false` 时，Discover 应保留这个布尔值。显式不支持与未声明不是同一种输入；丢弃 false 会使后续消费者无法区分。

最小输入：

```json
{"data":[{"id":"plain-model","reasoning":false}]}
```

期望发现结果保留 `{ "id": "plain-model", "reasoning": false }`。本次用同一输入实际运行官方基线和本地版本：`e533d9b` 输出 `[{"id":"plain-model"}]`，`aa9452a` 输出 `[{"id":"plain-model","reasoning":false}]`。本地采用“首先出现的布尔能力声明原样保留，未声明则省略”的规则，测试覆盖 true、false、缺失与无效值；字段优先级由实现顺序定义。

实现索引：[model-discovery.ts](../../lib/model-discovery.ts) 的 `reasoningFromValue()` 与 `capabilitiesFromValue()`；对应提交 `faac8a9`。独立反馈这一个问题，不夹带 `magpie_label`、档位对象或网关专属参数。投稿前若官方 main 已更新，应在新版本重跑最小输入；UI 中的具体影响也应实际验证后再写。

## 候选二：应用信任代理域名，但 Next 开发资源仍受阻

建议标题：`Development assets should accept explicitly trusted reverse-proxy hostnames`

复现材料应包含：

1. 在官方 main 运行开发服务器，绑定 loopback，设置一个明确的 `PI_WEB_ALLOWED_HOSTS` 域名。
2. 通过该域名的 HTTPS 反向代理访问；验证应用 Host／认证层通过。
3. 记录浏览器 Network 中失败的开发脚本／HMR 请求，以及对应 Next 服务端日志。区分应用的 403 与 Next 的开发来源限制。

本地实现把同一环境变量中的明确域名加入 `allowedDevOrigins`，没有把来源改成任意通配，也没有创建网络入口。实现索引：[next.config.ts](../../next.config.ts) 第 60 行；提交 `1b8cc91`。

这应描述为反向代理下的开发访问问题；Serve 8443 只是复现环境之一。手机连接超时、Clash 节点质量不属于该补丁要解决的问题。

## 候选三：旧生产 worker 控制开发页面

建议标题：`An existing production service worker can keep stale assets when switching to development`

问题场景：同一来源曾安装生产版本，之后切到开发服务器。出现模块工厂缺失等客户端错误，强制刷新恢复。应先确认服务端与新页面正常，再验证遗留 worker／缓存是否是触发条件；仅凭错误文案不能断定原因。

本地实现是在 Next 客户端加载前增加 loopback 引导页，只移除本应用的 worker 与静态缓存，再进入 `/`；登录状态与草稿保留。索引：[open-dev.html](../../public/open-dev.html)，提交 `9df1d5f`。

提交前还需补足：

- 在官方 main 上保存“有旧 worker／无旧 worker”的对照证据。
- 说明与已完成的 [#1088](https://github.com/agegr/pi-web/issues/1088) 的区别：那里是冷缓存写入阻塞导航，这里是生产／开发切换后的遗留控制器。
- 选定通用的开发启动接入点。本机启动器已经使用引导页，但仓库 Windows 模板未接入，不能只提交页面就声称启动问题完整解决。

## 不建议重新包装成新功能的问题

**嵌套子会话。** 当前本地只补历史文件发现、ID 解析和父子关系，未接管扩展运行状态，也不等于“完整支持 nicobailon/pi-subagents”。维护者在 #1041 已拒绝把另一种存储和配置模型作为一等支持路径。若要继续沟通，应先引用该结论，说明是否存在独立、通用的会话发现缺口，而不是重复发相同功能请求。

**模型元数据。** #856 已完成通用能力元数据发现。新增反馈应给出尚未保留的具体字段／值，以及实际网关响应。通用 `false` 丢失与专属字段别名应分别讨论。

**项目隐藏。** #764 已关闭，维护者说明归档能隐藏全部已归档会话的项目。后来官方代码又有删除项目全部会话的 API。不要把早期评论当成当前能力清单，也不要把独立实验分支当作本次日常分支改动。

## 投稿前的最小整理

从最新上游为每个候选单独准备分支，只选择该问题所需的实现、回归测试和相关说明，不把日常分支整条合并过去。发布前按上游要求执行该候选的完整检查；本次文档核对与定向测试不替代上游要求的 `npm test`、typecheck 和 lint。

可先选候选一；候选二需要补浏览器／Next 的对照日志；候选三需要补可重复的真实浏览器场景。本文未新建 issue、评论或 PR。
