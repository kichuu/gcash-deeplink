/**
 * A single-page HTTP server for the tap-through page.
 *
 * Deliberately not a static file server: it holds one rendered page in memory
 * and answers every path with it. Nothing on disk is exposed, so pointing a
 * tunnel at it cannot publish anything but the page itself.
 */

import { createServer, type Server } from 'node:http';
import { networkInterfaces } from 'node:os';

export interface ServeOptions {
  html: string;
  port: number;
  host: string;
  /** Called with each request path, for a progress log. */
  onRequest?: (path: string) => void;
}

/** Every non-internal IPv4 address, so the operator can pick the LAN one. */
export function localAddresses(): string[] {
  const out: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address);
    }
  }
  return out;
}

export function startServer(options: ServeOptions): Promise<Server> {
  const { html, port, host, onRequest } = options;
  const body = Buffer.from(html, 'utf8');

  const server = createServer((req, res) => {
    onRequest?.(req.url ?? '/');

    // A favicon 404 in the log is noise that looks like a failure; answer it.
    if (req.url === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(body.byteLength),
      // The page embeds a live QR and its amount. Caching it invites a tester
      // to tap yesterday's expired links without noticing.
      'cache-control': 'no-store',
    });
    res.end(body);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}
