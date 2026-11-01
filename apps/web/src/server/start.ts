// Starts the HTTP server around a fetch handler, serving the client build as static files.
// Kept apart from the CLI so tests can start it in-process.
import { serve } from "srvx";
import { staticMiddleware } from "srvx/static";

export type StartOptions = {
  fetch: (request: Request) => Response | Promise<Response>;
  clientDir: string;
  port: number;
  hostname?: string;
  silent?: boolean;
  /** Close connections cleanly on SIGINT and SIGTERM. Off for in-process use. */
  gracefulShutdown?: boolean;
};

export async function startServer(options: StartOptions) {
  const server = serve({
    fetch: options.fetch,
    port: options.port,
    hostname: options.hostname,
    middleware: [staticMiddleware({ dir: options.clientDir })],
    silent: options.silent ?? false,
    gracefulShutdown: options.gracefulShutdown ?? false,
  });
  await server.ready();
  return server as typeof server & { url: string };
}
