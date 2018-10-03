# kude-tun

kude-tun establishes http reverse tunnels over WebScoket connections for circumventing the problem of directly connect to hosts behind a strict firewall or without public IP

- Reverse http tunnel over websocket
- Expose service running behind firewall with access token
- Http request 

## Installation

```
npm install @zarvis/kude-tun
```

## Usage


### Setup tunnel server
Start a tunnel server (on port 8080), on publicly accessible host.

```
kude-tun -p 8080
```

### Start tunnel
If public domain name of tunnel server is `ktun.example.com`, kude-tun client can connect the server to reverse proxy service behind firewall.

```
kude-tun -t mysecrettoken -r localhost:7777 -s ws://ktun.example.com
```

kude-tun client request a new tunnel to server (with secret token 'mysecrettoken'), and reverse proxy request from server to service behind firewall `localhost:7777`.

### Make a request through the tunnel

```
$ curl 'http://ktun.example.com:8080/_ktun/my_b!g_$secret/some/web/page'
$ curl '-HX-Ktun-Token: mysecrettoken' http://wstun.example.com:8080/some/web/page
```

http request to `http://wstun.example.com/_ktun/mysecrettoken/` will be forwarded to service running behind firewall (`localhost:7777`) through the tunnel.

```
      HTTP-client ==>\     ||firewall||     /===> HTTP-server
                     |                      | (localhost:7777)
                     \----------------------/
                Kude-tun  <===tunnel==== Kude-tun
          (tunnel-server.com)            (client)
```

This connection mechanism is inspired by [wstunnel](https://github.com/rightscale/wstunnel). However, [wstunnel](https://github.com/rightscale/wstunnel) does not handle websocket request. This project uses [wstun](https://github.com/MDSLab/wstun) to create tcp tunnel over websocket and [node-http-proxy](https://github.com/nodejitsu/node-http-proxy) to reverse proxy request. And it handles websocket connection smoothly.
