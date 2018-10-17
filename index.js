#!/usr/bin/env node

log4js = require('log4js');
var http = require('http'),
    httpProxy = require('http-proxy'),
    wstun = require('@mdslab/wstun'),
    getPort = require('get-port');
    
log4js.configure({
  appenders: {
    console: { type: 'console' }
  },
  categories: {
    ktun: { appenders: ['console'], level: 'info' },
    wstun: { appenders: ['console'], level: 'error' },
    default: { appenders: ['console'], level: 'info' }
  }
});

const logger = log4js.getLogger('ktun');

var program = require('commander');

program
  .version('0.1.0')
  .option('-p, --port [number]', '(server mode) Tunnel server port to listen')
  .option('-s, --server [url]', '(client mode) Tunnel server address to connect. e.g. ws://proxyserverhost:8080')
  .option('-t, --tunnel [name]', '(client mode) Tunnel name to create. [a-z0-9]*. Tunnel name should be unique')
  .option('-r, --proxy [host:port]', '(client mode) Proxy target host:port. e.g. (localhost:8888)')
  .parse(process.argv);

if (program.port) {
  getPort().then(function(tport) {
    logger.info("Start server on", program.port)
    createServer({
      proxyPort: program.port,
      tunnelServerPort: tport
    })
  })
} else if (program.server && program.tunnel && program.proxy) {
  const client = new wstun.client_reverse;
  client.start(program.tunnel, program.server + "/_ktuncreate", program.proxy);
  logger.info("Starting tunnel", program.proxy)
} else {
  program.help()
}

function createServer(config) {
  function resolveTokenFromRequest(req) {
      var token = undefined
      if (req.url && req.url.startsWith("/_ktun/")) {
          var m = /[/]_ktun[/]([^/]+)(.*)/.exec(req.url)
          if (m && m.length > 1) {
            token = m[1]
            req.url = m[2]
          }
      } else if (req.headers && req.headers['x-ktun-token']) {
          token = req.headers['x-ktun-token']
      } else if (req.host && req.host.startsWith("tun-")) {
          var m = /tun-([^-.]+).*/.exec(req.host)
          if (m && m.length > 0) {
            token = m[1]
          }
      }
      return token    
  }

  var proxy = httpProxy.createProxyServer({ws: true, proxyTimeout: 2000})

  /**
   * Key is token
   * Value is
   * {
   *   port: <port number>,
   *   socket: <websocket object>
   * }
   */
  var tunnelMap = {}
  var count = 0
  var proxyServer = http.createServer(function(req, res) {
    // You can define here your custom logic to handle the request
    // and then proxy the request.
    const token = resolveTokenFromRequest(req)
    if (token && tunnelMap[token]) {
      logger.info("Proxy request to tunnel", token, req.url)
      proxy.web(req, res, { target: 'http://localhost:' + tunnelMap[token].port }, function(err) {
        if (req.url.startsWith("/_ktuncreate/?dst=")) {
          var m = /([^?]+[?]dst=)([^:]+)[:](.*)/.exec(req.url)
          const token = m[3]
          delete tunnelMap[token]
          logger.info('Tunnel disconnect', token)
          logger.trace('Connection error', err)
        } else {
          // retry on error
          logger.warn("Retry proxy request to tunnel", token, req.url)
          proxy.web(req, res, { target: 'http://localhost:' + tunnelMap[token].port })
        }
      });
    } else {
      if (req.url == "/_health") {
        res.writeHead(200)
        res.end();
      } else {
        // error
        res.writeHead(404)
        res.end();
        logger.warn("Can't proxy request. tunnel not found", token, req.url)
      }
    }
  });
  //
  // Listen to the `upgrade` event and proxy the
  // WebSocket requests as well.
  //
  proxyServer.on('upgrade', function (req, socket, head) {
    if (req.url.startsWith("/_ktuncreate/?dst=")) {
      var m = /([^?]+[?]dst=)([^:]+)[:](.*)/.exec(req.url)
      if (m && m.length > 2) {
        var token = m[3]
        if (tunnelMap[token]) {
          // token already exists
          // error
          logger.error("Token already exists", token)
          return
        }
      } else {
        logger.error("invalid dest format")
        return
      }
      getPort().then(function(port) {
        if (tunnelMap[token] || Object.keys(tunnelMap).find((k) => tunnelMap[k].port == port)) {
          // token or port already in the map
          // error
          logger.error("Token or port already exists", token, port)
          return
        } else {
          tunnelMap[token] = {
            port: port,
            socket: socket
          }
          socket._token = token
          // rewrite url
          url = m[1] + "localhost:" + port
          logger.info("Tunnel open", token, port)
          req.url = url
          proxy.ws(req, socket, head, { target: 'http://localhost:' + config.tunnelServerPort });
        }
      })
    } else if (req.url.startsWith("/_ktuncreate/?id=")) {
      logger.trace("websocket connection", req.url)
      proxy.ws(req, socket, head, { target: 'http://localhost:' + config.tunnelServerPort });
    } else { // proxy traffic
      var token = resolveTokenFromRequest(req)
      if (token && tunnelMap[token]) {
        logger.info("Proxy ws request to tunnel", token, req.url)
        proxy.ws(req, socket, head, { target: 'http://localhost:' + tunnelMap[token].port });
      } else {
        logger.warn("Can't proxy websocket request. tunnel not found", token, req.url)
      }
    }
  });

  proxy.on('open', function (socket) {
    logger.trace('connection open');
  });

  proxy.on('close', function (res, socket, head) {
    if (socket && socket._readableState && socket._readableState.pipes &&
        socket._readableState.pipes._token) {
      delete tunnelMap[socket._readableState.pipes._token]
      logger.info("Tunnel close", socket._readableState.pipes._token)
    }
  });

  proxy.on('error', function (err, req, res) {
    if (req.url.startsWith("/_ktuncreate/?dst=")) {
      var m = /([^?]+[?]dst=)([^:]+)[:](.*)/.exec(req.url)
      const token = m[3]
      delete tunnelMap[token]
      logger.info('Tunnel disconnect', token)
      logger.trace('Connection error', err)
    } else {
      // okay to not handle proxy request error
      logger.error("Proxy error", err)
      if (res.writeHead) {
        res.writeHead(500)
      }
      res.end();
    }
  });

  proxy.on('proxyReq', function (proxyReq, req, res, options) {
    logger.trace('Proxy Request', req.url);
  });


  proxy.on('proxyRes', function (proxyRes, req, res) {
    logger.trace('Proxy Response', req.url);
  });

  proxyServer.listen(config.proxyPort);

  // tunnel without security
  var tunnel_server = new wstun.server_reverse();
  tunnel_server.start(config.tunnelServerPort)
}