import type { TemplatedApp, WebSocket } from "uWebSockets.js";
import type { MelixMessage } from "../models/message";

export interface WsData {
  deviceId?: string;
}

export const sendNotification = (
  app: TemplatedApp,
  clients: Map<string, WebSocket<WsData>>,
  message: MelixMessage
): void => {
  const payload = JSON.stringify({ ...message, timestamp: Date.now() });

  if (message.to) {
    clients.get(message.to)?.send(payload);
    return;
  }

  app.publish("melix:all", payload);
};

