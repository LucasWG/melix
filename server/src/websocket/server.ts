import uWS, { type TemplatedApp, type WebSocket } from "uWebSockets.js";
import { handleClose, handleMessage, type WsData } from "./events";
import { logger } from "../utils/logger";
import type { ClipboardItem } from "../services/clipboard";

export interface MelixServerOptions {
  host: string;
  port: number;
}

export const startWebSocketServer = ({ host, port }: MelixServerOptions): TemplatedApp => {
  const clients = new Map<string, WebSocket<WsData>>();
  const rooms = new Map<string, Set<string>>();
  const onlineUsers = new Set<string>();
  const clipboardHistory: ClipboardItem[] = [];

  const app = uWS.App();

  app.ws<WsData>("/ws", {
    compression: uWS.SHARED_COMPRESSOR,
    maxPayloadLength: 16 * 1024,
    idleTimeout: 120,
    upgrade: (res, req, context) => {
      res.upgrade(
        {} as WsData,
        req.getHeader("sec-websocket-key"),
        req.getHeader("sec-websocket-protocol"),
        req.getHeader("sec-websocket-extensions"),
        context
      );
    },
    open: (ws) => {
      ws.subscribe("melix:all");
      logger.info("Conexao WebSocket aberta");
    },
    message: (ws, message) => {
      handleMessage(ws, message, {
        app,
        clients,
        rooms,
        onlineUsers,
        clipboardHistory
      });
    },
    close: (ws) => {
      handleClose(ws, {
        app,
        clients,
        rooms,
        onlineUsers,
        clipboardHistory
      });
    }
  });

  app.get("/health", (res) => {
    res.writeStatus("200 OK").writeHeader("content-type", "application/json").end(
      JSON.stringify({
        status: "ok",
        onlineUsers: onlineUsers.size,
        rooms: rooms.size,
        clipboardItems: clipboardHistory.length
      })
    );
  });

  app.listen(host, port, (token) => {
    if (!token) {
      logger.error(`Nao foi possivel subir o servidor em ${host}:${port}`);
      process.exit(1);
    }
    logger.info(`Melix ativo em ws://${host}:${port}/ws`);
  });

  return app;
};

