import type { Response } from "express";

interface SSEClient {
  id: string;
  res: Response;
}

class Broadcaster {
  private clients: SSEClient[] = [];

  addClient(id: string, res: Response) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    const client: SSEClient = { id, res };
    this.clients.push(client);

    res.write(`event: connected\ndata: ${JSON.stringify({ clientId: id })}\n\n`);

    return () => {
      this.clients = this.clients.filter((c) => c.id !== id);
    };
  }

  broadcast(event: string, data: unknown) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.res.write(payload);
      } catch {
      }
    }
  }

  get clientCount() {
    return this.clients.length;
  }
}

export const broadcaster = new Broadcaster();
