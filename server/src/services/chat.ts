import type { TemplatedApp, WebSocket } from "uWebSockets.js";
import type { MelixMessage } from "../models/message";
import { getRoomMembers } from "../websocket/rooms";

export interface WsData {
  deviceId?: string;
}

const publish = (app: TemplatedApp, channel: string, payload: MelixMessage): void => {
  app.publish(channel, JSON.stringify({ ...payload, timestamp: Date.now() }));
};

export const sendGlobalChat = (app: TemplatedApp, message: MelixMessage): void => {
  publish(app, "melix:all", message);
};

export const sendRoomChat = (
  app: TemplatedApp,
  rooms: Map<string, Set<string>>,
  message: MelixMessage
): void => {
  if (!message.room) {
    return;
  }

  const roomMembers = getRoomMembers(rooms, message.room);
  for (const member of roomMembers) {
    publish(app, `melix:device:${member}`, message);
  }
};

export const sendPrivateChat = (
  clients: Map<string, WebSocket<WsData>>,
  message: MelixMessage
): void => {
  if (!message.to) {
    return;
  }

  const targetWs = clients.get(message.to);
  if (!targetWs) {
    return;
  }

  targetWs.send(JSON.stringify({ ...message, timestamp: Date.now() }));
};

