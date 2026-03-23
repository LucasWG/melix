import type { TemplatedApp, WebSocket } from "uWebSockets.js";
import type { MelixMessage } from "../models/message";
import { logger } from "../utils/logger";
import { joinRoom, leaveRoom } from "./rooms";
import {
  broadcastPresenceList,
  notifyJoin,
  notifyLeave,
  sendPresenceToClient
} from "../services/presence";
import { sendGlobalChat, sendPrivateChat, sendRoomChat } from "../services/chat";
import { addClipboardItem, deleteClipboardItem, sendClipboardHistory } from "../services/clipboard";
import { sendNotification } from "../services/notifications";
import { sendBroadcast } from "../services/broadcast";

export interface WsData {
  deviceId?: string;
}

export interface MelixState {
  app: TemplatedApp;
  clients: Map<string, WebSocket<WsData>>;
  rooms: Map<string, Set<string>>;
  onlineUsers: Set<string>;
  clipboardHistory: import("../services/clipboard").ClipboardItem[];
  globalReadReceipts: Map<string, Set<string>>;
}

export const handleMessage = (ws: WebSocket<WsData>, raw: ArrayBuffer, state: MelixState): void => {
  try {
    const message = JSON.parse(Buffer.from(raw).toString()) as MelixMessage;
    const currentDevice = ws.getUserData().deviceId;

    switch (message.type) {
      case "register": {
        if (!message.from) {
          return;
        }

        ws.getUserData().deviceId = message.from;
        state.clients.set(message.from, ws);
        state.onlineUsers.add(message.from);

        ws.subscribe("melix:all");
        ws.subscribe(`melix:device:${message.from}`);

        notifyJoin(state.app, message.from);
        const joinNotification = JSON.stringify({
          type: "notification",
          from: message.from,
          level: "info",
          message: `${message.from} entrou no Melix.`,
          timestamp: Date.now()
        } satisfies MelixMessage);
        for (const [deviceId, clientWs] of state.clients.entries()) {
          if (deviceId !== message.from) {
            clientWs.send(joinNotification);
          }
        }
        broadcastPresenceList(state.app, state.onlineUsers);
        sendPresenceToClient(ws, state.onlineUsers);
        sendClipboardHistory(ws, state.clipboardHistory);
        logger.info(`Cliente registrado: ${message.from}`);
        break;
      }
      case "join_room": {
        if (!currentDevice || !message.room) {
          return;
        }
        joinRoom(state.rooms, message.room, currentDevice);
        logger.info(`${currentDevice} entrou na sala ${message.room}`);
        break;
      }
      case "leave_room": {
        if (!currentDevice || !message.room) {
          return;
        }
        leaveRoom(state.rooms, message.room, currentDevice);
        logger.info(`${currentDevice} saiu da sala ${message.room}`);
        break;
      }
      case "chat_global":
        sendGlobalChat(state.app, { ...message, from: currentDevice ?? message.from });
        break;
      case "chat_room":
        sendRoomChat(state.app, state.rooms, { ...message, from: currentDevice ?? message.from });
        break;
      case "chat_private":
        sendPrivateChat(state.clients, { ...message, from: currentDevice ?? message.from });
        break;
      case "chat_private_read": {
        if (!currentDevice || !message.messageId || !message.to) {
          return;
        }
        const targetWs = state.clients.get(message.to);
        if (!targetWs) {
          return;
        }
        targetWs.send(
          JSON.stringify({
            type: "chat_private_read",
            from: currentDevice,
            to: message.to,
            messageId: message.messageId,
            timestamp: Date.now()
          } satisfies MelixMessage)
        );
        break;
      }
      case "chat_global_read": {
        if (!currentDevice || !message.messageId) {
          return;
        }
        if (!state.globalReadReceipts.has(message.messageId)) {
          state.globalReadReceipts.set(message.messageId, new Set<string>());
        }
        state.globalReadReceipts.get(message.messageId)?.add(currentDevice);
        state.app.publish(
          "melix:all",
          JSON.stringify({
            type: "chat_global_read",
            messageId: message.messageId,
            from: currentDevice,
            readers: [...(state.globalReadReceipts.get(message.messageId) ?? new Set<string>())],
            timestamp: Date.now()
          } satisfies MelixMessage)
        );
        break;
      }
      case "broadcast":
        sendBroadcast(state.app, { ...message, from: currentDevice ?? message.from });
        break;
      case "notification":
        sendNotification(state.app, state.clients, {
          ...message,
          from: currentDevice ?? message.from
        });
        break;
      case "clipboard_add":
        addClipboardItem(state.clipboardHistory, message.message, currentDevice);
        state.app.publish(
          "melix:all",
          JSON.stringify({
            type: "clipboard_history",
            message: JSON.stringify(state.clipboardHistory),
            timestamp: Date.now()
          } satisfies MelixMessage)
        );
        break;
      case "clipboard_delete": {
        const deleted = deleteClipboardItem(state.clipboardHistory, message.clipboardId, currentDevice);
        if (!deleted && currentDevice) {
          ws.send(
            JSON.stringify({
              type: "notification",
              level: "warning",
              message: "Voce so pode apagar itens do clipboard enviados por voce.",
              timestamp: Date.now()
            } satisfies MelixMessage)
          );
        }
        if (deleted) {
          state.app.publish(
            "melix:all",
            JSON.stringify({
              type: "clipboard_history",
              message: JSON.stringify(state.clipboardHistory),
              timestamp: Date.now()
            } satisfies MelixMessage)
          );
        }
        break;
      }
      case "clipboard_history":
        sendClipboardHistory(ws, state.clipboardHistory);
        break;
      case "ping":
        ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() } satisfies MelixMessage));
        break;
      default:
        logger.warn(`Evento ignorado: ${message.type}`);
        break;
    }
  } catch (error) {
    logger.error(`Falha ao processar mensagem: ${(error as Error).message}`);
  }
};

export const handleClose = (ws: WebSocket<WsData>, state: MelixState): void => {
  const deviceId = ws.getUserData().deviceId;
  if (!deviceId) {
    return;
  }

  state.clients.delete(deviceId);
  state.onlineUsers.delete(deviceId);

  for (const room of state.rooms.values()) {
    room.delete(deviceId);
  }

  notifyLeave(state.app, deviceId);
  broadcastPresenceList(state.app, state.onlineUsers);
  logger.info(`Cliente desconectado: ${deviceId}`);
};

