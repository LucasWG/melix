import type { TemplatedApp, WebSocket } from "uWebSockets.js";
import type { MelixMessage } from "../models/message";

export interface WsData {
  deviceId?: string;
}

const send = (ws: WebSocket<WsData>, payload: MelixMessage): void => {
  ws.send(JSON.stringify({ ...payload, timestamp: Date.now() }));
};

export const broadcastPresenceList = (
  app: TemplatedApp,
  onlineUsers: Set<string>
): void => {
  const presencePayload: MelixMessage = {
    type: "presence_list",
    message: JSON.stringify([...onlineUsers])
  };
  app.publish("melix:all", JSON.stringify({ ...presencePayload, timestamp: Date.now() }));
};

export const notifyJoin = (app: TemplatedApp, deviceId: string): void => {
  const payload: MelixMessage = {
    type: "user_join",
    from: deviceId,
    message: `${deviceId} entrou.`
  };
  app.publish("melix:all", JSON.stringify({ ...payload, timestamp: Date.now() }));
};

export const notifyLeave = (app: TemplatedApp, deviceId: string): void => {
  const payload: MelixMessage = {
    type: "user_leave",
    from: deviceId,
    message: `${deviceId} saiu.`
  };
  app.publish("melix:all", JSON.stringify({ ...payload, timestamp: Date.now() }));
};

export const sendPresenceToClient = (ws: WebSocket<WsData>, onlineUsers: Set<string>): void => {
  send(ws, {
    type: "presence_list",
    message: JSON.stringify([...onlineUsers])
  });
};

