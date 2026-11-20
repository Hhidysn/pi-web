# Windows launcher for this checkout

Copies of the launcher that runs this fork on the user's Windows machine. They live
outside the repository on purpose — the installed copies are machine state:

```
Desktop / Start-menu shortcut "Pi Web"
  -> wscript %LOCALAPPDATA%\pi-web\pi-web-start.vbs   (hidden console, reports a failure)
     -> %LOCALAPPDATA%\pi-web\start-pi-web.cmd quiet
        -> this checkout (next dev, or its production build)
        -> or the installed npm package @agegr/pi-web ("official")
```

Install or update them by copying all four files into `%LOCALAPPDATA%\pi-web` (next to
`pi-web.ico` and the logs). Keep them CRLF — `.gitattributes` enforces that for this
folder, because cmd is happiest with CRLF batch files.

## 本机开始菜单快捷方式

2026-11-21 核对两个快捷方式。实际使用的是 `%LOCALAPPDATA%\pi-web` 下的本机脚本。

| 操作 | 开始菜单快捷方式 | 本机脚本 |
| --- | --- | --- |
| 启动 | `C:\Users\24590\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Pi Web.lnk` | `C:\Users\24590\AppData\Local\pi-web\pi-web-start.vbs`，调用 `start-pi-web.cmd quiet prod` |
| 停止 | `C:\Users\24590\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Pi Web (Stop).lnk` | `C:\Users\24590\AppData\Local\pi-web\stop-pi-web.cmd`，调用 `stop-pi-web.ps1` |

本机启动和停止均使用 `30141`。更新已安装脚本前，先和仓库模板比较，保留本机修复。

开始菜单启动不显示命令行窗口。VBS 用隐藏控制台运行启动器并等待其退出，
Pi Web 的日志写到 `pi-web-30141.log`。浏览器、资源管理器等窗口的关闭不会结束
服务，停止服务仍使用 Stop 快捷方式。

## 模板与本机安装版本的差异（2026-10-24）

本目录是可跟踪的模板，不保证与 `%LOCALAPPDATA%\pi-web` 中已安装的文件同步。本次核对，`start-pi-web.cmd`、`open-when-ready.cmd` 的哈希不同；`stop-pi-web.cmd`、`stop-pi-web.ps1`、VBS 相同。

已安装版本会在 fork 开发模式下打开 `/open-dev.html`，并以 `/api/web-auth` 的成功 HTTP 响应作为就绪条件。此处模板仍打开 `/`；其 `curl` 探测没有 `-f`，无 curl 时还会退回端口监听检测。因此直接用模板覆盖本机文件，会丢失上述启动修复。模板同步前应先比较两份文件。

相关实现与上游反馈边界见 [当前分支差异](../../../docs/fork-status.zh-CN.md)。

## `start-pi-web.cmd`

```
start-pi-web.cmd [port] [quiet] [fork|official] [dev|prod] [rebuild] [dry] [help]
```

| Argument | Meaning |
| --- | --- |
| *(none)* | fork, dev mode, port 30141 |
| `<port>` | any non-keyword argument is the listen port (1-65535) |
| `quiet` | no console output of its own; output goes to `pi-web-<port>.log` (the shortcut hides the window through the VBS, not through this flag) |
| `fork` | the checkout below (default) |
| `official` | the npm package `@agegr/pi-web` on PATH |
| `dev` | `next dev` in the checkout: hot reload, no build, one instance per checkout (Next's `.next/dev/lock`) |
| `prod` | serve the checkout's last production build through its own `bin/pi-web.js` |
| `rebuild` | run the production build first (implies `prod`); refuses while a dev server holds the lock |
| `dry` | print the resolved target/mode/port/fork/log and exit |
| `help` | usage |

The checkout folder is `F:\documents\software\pi-web-gui` by default; override it with
the `PI_WEB_FORK` environment variable or by editing the `FORK` line. Every internal
variable is reset at the start, so a same-named variable in the caller's environment
(`PORT`, `LOG`, `TARGET`, ...) cannot change what the launcher does.

Behaviour worth knowing:

- A port that is already in use is never replaced: the launcher prints what holds it
  (this fork / the installed official package / something else), repeats the shared-data
  warning, opens the browser and exits with code 100 (which the VBS reads as "already
  running").
- Port discovery reads `Get-NetTCPConnection -LocalPort <port>` and accepts a zero remote
  port; it does not depend on `netstat` or the reported `State`, both of which can be
  blank for a working loopback listener on this Windows installation. A stale Pi Web
  process with no listener is reported with the exact stop command.
- One log per port (`pi-web-<port>.log`), so a second instance never truncates or locks
  the first one's log. Argument errors before the port is known go to
  `pi-web-launcher.log`. Launcher lifecycle messages always go to
  `pi-web-launcher.log`, so a repeated click never writes into a running server's log.
- `prod rebuild` needs `NODE_OPTIONS=--max-old-space-size=8192` on this machine; the
  launcher sets it for the build (8 GB is the V8 old-space limit, not total RAM).
- `open-when-ready.cmd <port>` waits for the server to answer over HTTP (not merely for
  a bound socket) before opening the browser, and notes a timeout in the port's log.

## `stop-pi-web.cmd [port] [force]`

Resolves the port listener and also scans Node processes for this checkout's Pi Web
server and for the matching `next dev -p <port>` process tree. It therefore still finds
and stops stale `start-server.js` and Turbopack workers when the listening socket has
already closed. The helper ends every process in the computed tree, checks that no Pi Web
Node process remains, and reports failure if cleanup was incomplete. A port held by an
unrelated process is refused with the exact override:
`stop-pi-web.cmd <port> force`. Forced termination means running agents are not shut
down gracefully.

## Two instances at once

The two servers share `~/.pi`. Reading history is safe; two *writers* on one session
file are not, and the running/finished status is per server, not ownership. So: never
send, rename, delete or branch the same live conversation in both servers. For a second
instance that is genuinely isolated, point it at another agent directory with
`PI_CODING_AGENT_DIR`.

## Why not `npm link`

The fork and the installed package share the same package and command name, so linking
would replace the global `pi-web` and weaken the fallback. It also would not make
`pi-web` run in dev mode: its entry point always serves `.next`. The launcher keeps the
two targets side by side instead (`official` switches back).
