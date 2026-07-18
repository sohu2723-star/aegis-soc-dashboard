import type { Response } from "express";

interface SSEClient {
  id: string;
  res: Response;
  alive: boolean;
}

class Broadcaster {
  private clients: SSEClient[] = [];
  private _pingTimer: ReturnType<typeof setInterval> | null = null;

  addClient(id: string, res: Response) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    const client: SSEClient = { id, res, alive: true };
    this.clients.push(client);

    res.write(`event: connected\ndata: ${JSON.stringify({ clientId: id })}\n\n`);

    // Start keep-alive pinger on first client
    if (!this._pingTimer) this._startPinger();

    const remove = () => {
      client.alive = false;
      this.clients = this.clients.filter((c) => c.id !== id);
      if (this.clients.length === 0) this._stopPinger();
    };
    return remove;
  }

  broadcast(event: string, data: unknown) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const dead: string[] = [];
    for (const client of this.clients) {
      try {
        client.res.write(payload);
      } catch {
        // Write failed — connection is dead, prune it
        client.alive = false;
        dead.push(client.id);
      }
    }
    if (dead.length > 0) {
      this.clients = this.clients.filter((c) => !dead.includes(c.id));
      if (this.clients.length === 0) this._stopPinger();
    }
  }

  /** Send SSE comment ping every 25 s to keep proxies from closing idle connections */
  private _startPinger() {
    this._pingTimer = setInterval(() => {
      const dead: string[] = [];
      for (const client of this.clients) {
        try {
          client.res.write(": ping\n\n");
        } catch {
          client.alive = false;
          dead.push(client.id);
        }
      }
      if (dead.length > 0) {
        this.clients = this.clients.filter((c) => !dead.includes(c.id));
        if (this.clients.length === 0) this._stopPinger();
      }
    }, 25_000);
  }

  private _stopPinger() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
  }

  get clientCount() {
    return this.clients.length;
  }
}

export const broadcaster = new Broadcaster();
