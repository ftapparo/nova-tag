import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';

type WsEnvelope = {
  event: string;
  timestamp: string;
  data: unknown;
  meta?: { version: string };
};

// Mesmo desenho do broker do nova-cie (src/core/ws/cie-ws-broker.ts),
// duplicado de propósito por serem repositórios separados. Sem opções o
// broker fica aberto, sem limite e sem heartbeat; a v3 sempre passa as
// opções para exigir token, limitar conexões e derrubar clientes mortos.
export type TagWsBrokerOptions = {
  authorize?: (request: http.IncomingMessage) => boolean;
  maxClients?: number;
  heartbeatMs?: number;
  version?: string;
};

const rejectUpgrade = (socket: import('stream').Duplex, status: number, reason: string) => {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
};

export class TagWsBroker {
  private readonly path: string;
  private readonly wss: WebSocketServer;
  private readonly options: TagWsBrokerOptions;
  private readonly alive = new WeakMap<WebSocket, boolean>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(server: http.Server, path = '/v1/ws', options: TagWsBrokerOptions = {}) {
    this.path = path;
    this.options = options;
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      const url = request.url || '';
      if (!url.startsWith(this.path)) {
        socket.destroy();
        return;
      }

      if (this.options.authorize && !this.options.authorize(request)) {
        rejectUpgrade(socket, 401, 'Unauthorized');
        return;
      }

      if (this.options.maxClients && this.wss.clients.size >= this.options.maxClients) {
        rejectUpgrade(socket, 503, 'Service Unavailable');
        return;
      }

      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });

    this.wss.on('connection', (ws) => {
      this.alive.set(ws, true);
      ws.on('pong', () => this.alive.set(ws, true));
      ws.send(JSON.stringify(this.envelope('connection.established', { ok: true })));
    });

    if (this.options.heartbeatMs) {
      // Conexão que caiu sem FIN (rede, container reiniciado) ficaria
      // contando no maxClients para sempre; o ping periódico a descobre.
      this.heartbeatTimer = setInterval(() => {
        this.wss.clients.forEach((ws) => {
          if (!this.alive.get(ws)) {
            ws.terminate();
            return;
          }
          this.alive.set(ws, false);
          ws.ping();
        });
      }, this.options.heartbeatMs);
    }
  }

  private envelope(event: string, data: unknown): WsEnvelope {
    return {
      event,
      timestamp: new Date().toISOString(),
      data,
      ...(this.options.version ? { meta: { version: this.options.version } } : {}),
    };
  }

  publish(event: string, data: unknown) {
    const text = JSON.stringify(this.envelope(event, data));
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(text);
    });
  }

  close() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.wss.close();
  }
}
