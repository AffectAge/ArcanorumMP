import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "node:http";
import { WegoRoom } from "./rooms/WegoRoom.js";
import { createHttpApp } from "./httpApp.js";
import { ensureDatabaseConnection } from "./db.js";

const port = Number(process.env.PORT ?? 2567);
const hostname = process.env.HOST ?? "0.0.0.0";
const app = createHttpApp();
const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("wego", WegoRoom);

await ensureDatabaseConnection();
await gameServer.listen(port, hostname);
console.log(`[server] listening on http://${hostname}:${port}`);
