# nginx configuration mount point

The discovery worker reads nginx vhosts from here (read-only) to map hostnames to
containers — priority 2 in the URL resolution order, after an explicit `sat.url`
label.

**This directory is intentionally empty.** It is the safe default so a fresh
clone starts without nginx mapping; discovery then flags applications as
"Needs Mapping" rather than guessing a hostname.

## On the server

Point the mount at the real nginx directory in `.env`:

```bash
NGINX_CONF_HOST_DIR=/etc/nginx/sites-enabled
```

The worker parses `server { server_name X; ... proxy_pass http://Y; }` blocks and
named `upstream` blocks, matching the proxy target against a container's name,
compose service, or published port.

For a vhost like:

```nginx
server {
    server_name aicommunication.cftools.live;
    location / {
        proxy_pass http://trainer-frontend:80;
    }
}
```

…a container named `trainer-frontend` is mapped to
`https://aicommunication.cftools.live`.

## When nginx cannot be read

If the routing is not expressible this way — dynamic upstreams, a different
proxy, or config held elsewhere — use an explicit label on the container, which
always takes priority:

```yaml
labels:
  sat.url: aicommunication.cftools.live
```

Nothing here is ever written to. The mount is `:ro`.
