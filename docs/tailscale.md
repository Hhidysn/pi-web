# Private phone access with Tailscale

Keep Pi Web listening on `127.0.0.1:30141`, enable `PI_WEB_PASSWORD`, and use Tailscale Serve as the HTTPS entry point. The phone must be connected to the same tailnet.

Set `PI_WEB_ALLOWED_HOSTS` to the computer's exact MagicDNS hostname, without a scheme or port. In development, this also allows Next.js scripts and HMR through the proxy. Restart Pi Web after changing environment variables.

On Windows, after configuring a long password in your user environment:

```powershell
$dnsName = (tailscale status --json | ConvertFrom-Json).Self.DNSName.TrimEnd('.')
[Environment]::SetEnvironmentVariable('PI_WEB_ALLOWED_HOSTS', $dnsName, 'User')
tailscale serve --bg --https=8443 http://127.0.0.1:30141
```

Open `https://<MagicDNS hostname>:8443/` on the phone and sign in with the Pi Web password. Use a fresh launcher process that inherits the configured environment variables.

`serve --bg` persists across Tailscale restarts. Pi Web must also start after Windows sign-in; a shortcut to your launcher in `shell:startup` provides that. The computer must remain awake for remote access.

For a loopback development launch, open `http://127.0.0.1:30141/open-dev.html` instead of `/`. This entry clears Pi Web's static asset cache and old caching worker before opening the app, while preserving the development push-only worker. Use the same entry when the server is already running, and have the launcher's readiness check require a successful HTTP response. Production and phone URLs stay as above.

本机安装的启动器已使用该入口；仓库 Windows 模板尚未同步，安装前请看[模板差异说明](../scripts/windows/pi-web/README.md)。

Serve is limited to the tailnet. Keep an existing Funnel mapping for other applications separate from Pi Web's private Serve endpoint.

Android permits one system VPN at a time. If FlClash already provides it, use its authenticated Mihomo Tailscale node and domain/IP rules for Pi Web. Keep the standalone Tailscale VPN disconnected in that setup.

手机与电脑不要求使用相同代理订阅。FlClash 的订阅切换后仍需加载同一份 Tailscale 节点、域名解析和分流配置；只给某个订阅绑定覆写脚本，其他订阅不会自动继承。电脑若开 Clash TUN，还应检查 Tailscale 出站是否跟随了代理节点，不能把所有超时都归因于 Pi Web。

蜂窝网络下 tailnet 路径可能不可用：2026-11 实测，电信/联通 5G 上 Tailscale 只能经 DERP 中继（延迟 0.6–1.9s），页面加载超时；独立 Tailscale 应用在 Wi-Fi 下正常。此时可用的免 VPN 入口是 Funnel：`tailscale funnel --bg --https=443 http://127.0.0.1:30141`，手机任何网络（含流量、无需任何 VPN 应用）打开 `https://<MagicDNS hostname>/` 即可。Funnel 把服务暴露到公网，必须保持 `PI_WEB_PASSWORD` 启用；`PI_WEB_ALLOWED_HOSTS` 里已有的 MagicDNS 名同时覆盖 443 与 8443。不再需要时用 `tailscale funnel --https=443 off` 关闭。2026-11 实测：电信 5G + Via 浏览器经 Funnel 可完整加载 Pi Web。

经 Funnel 远程访问建议用生产构建（`start-pi-web.cmd prod`，开机脚本已默认）。开发模式的 `/api/sessions` 等响应未压缩，2MB 级 JSON 在跨洲中继链路上易中途断开，浏览器表现为会话列表 `TypeError: Failed to fetch`；生产构建自动 gzip，响应小一个量级。Windows 启动脚本将 `HEAP` 提到 14336：`next build` 在 8GB 下会堆溢出。改完代码用 `start-pi-web.cmd rebuild` 重建再切回。

## 后台通知与主屏幕入口

开发模式注册 push-only Service Worker，用于推送，不提供离线缓存或 fetch 响应接管；生产模式仍使用原有 worker 缓存分支。后台提示音依赖页面继续执行；页面被节流、冻结或回收时，不能依赖侧栏轮询保持及时通知。

手机配置步骤：

1. 在支持 Web Push 的浏览器打开 `https://<MagicDNS hostname>:8443/` 并登录。多个浏览器的登录和通知权限通常独立。
2. 进入 Pi Web「设置 → 常规 → 注册推送」。若浏览器或安卓系统屏蔽通知，分别允许本站通知和该浏览器的应用通知，再重新注册。
3. Edge 安卓版可从「浏览器菜单 → 全部菜单 → 添加至手机 → 安装」添加入口，再确认「添加至桌面」。系统若拦截，先在 Edge 的应用权限中允许「创建桌面快捷方式」。菜单名称按实机 Edge 155 记录。
4. 从主屏幕 Pi Web 图标打开，再运行任务并切到后台检查通知。iPhone 需从主屏幕 Web App 打开并满足系统版本要求；添加图标本身不等于订阅成功。

2026-10-25 安卓实测：Via 7.3.4 返回 `unsupported or not permitted`，未保存订阅；Edge 155 注册成功，主屏幕图标可打开。测试时手机收到明确标记的后台测试通知，服务端推送服务返回 HTTP 201。

实测边界：这次直接发送测试消息验证了订阅和投递，没有用真实任务触发 `agent_settled`，也未验证锁屏场景。不能据此承诺长期后台或锁屏投递必达。服务端诊断可检查 agent 目录下 `web-push.json` 的订阅数量；不要公开订阅 endpoint、订阅 keys 或 VAPID 私钥。
