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

Serve is limited to the tailnet. Keep an existing Funnel mapping for other applications separate from Pi Web's private Serve endpoint.

Android permits one system VPN at a time. If FlClash already provides it, use its authenticated Mihomo Tailscale node and domain/IP rules for Pi Web. Keep the standalone Tailscale VPN disconnected in that setup.
