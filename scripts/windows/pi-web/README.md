# Windows launcher for this checkout

Copies of the launcher that runs this fork on the user's Windows machine. They live
outside the repository on purpose — the installed copies are machine state:

```
Desktop / Start-menu shortcut "Pi Web"
  -> wscript %LOCALAPPDATA%\pi-web\pi-web-start.vbs   (no window, reports a failure)
     -> %LOCALAPPDATA%\pi-web\start-pi-web.cmd quiet
        -> this checkout (next dev, or its production build)
        -> or the installed npm package @agegr/pi-web ("official")
```

Install or update them by copying all four files into `%LOCALAPPDATA%\pi-web` (next to
`pi-web.ico` and the logs). Keep them CRLF — `.gitattributes` enforces that for this
folder, because cmd is happiest with CRLF batch files.

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
- One log per port (`pi-web-<port>.log`), so a second instance never truncates or locks
  the first one's log. Argument errors before the port is known go to
  `pi-web-launcher.log`.
- `prod rebuild` needs `NODE_OPTIONS=--max-old-space-size=8192` on this machine; the
  launcher sets it for the build (8 GB is the V8 old-space limit, not total RAM).
- `open-when-ready.cmd <port>` waits for the server to answer over HTTP (not merely for
  a bound socket) before opening the browser, and notes a timeout in the port's log.

## `stop-pi-web.cmd [port] [force]`

Resolves the listening PID on the port and kills the tree with `taskkill /F` after
checking that the command line is one of the expected entry points (this checkout,
`@agegr/pi-web`, or a Next dev/prod server). Anything else is refused with the exact
override to use: `stop-pi-web.cmd <port> force`. Forced termination means running agents
are not shut down gracefully.

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
