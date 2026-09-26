import { createServer, type Server } from "node:http";
import { config } from "../config.js";
import { logger } from "../logger.js";

export function startHealthServer(): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url?.split("?")[0] === "/health") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      response.end("OK");
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not Found");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.httpPort, "0.0.0.0", () => {
      server.off("error", reject);
      logger.info("Health server is listening.", { port: config.httpPort });
      resolve(server);
    });
  });
}