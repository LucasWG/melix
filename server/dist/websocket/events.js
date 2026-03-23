"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleClose = exports.handleMessage = void 0;
const logger_1 = require("../utils/logger");
const rooms_1 = require("./rooms");
const presence_1 = require("../services/presence");
const chat_1 = require("../services/chat");
const clipboard_1 = require("../services/clipboard");
const notifications_1 = require("../services/notifications");
const broadcast_1 = require("../services/broadcast");
const handleMessage = (ws, raw, state) => {
    try {
        const message = JSON.parse(Buffer.from(raw).toString());
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
                (0, presence_1.notifyJoin)(state.app, message.from);
                const joinNotification = JSON.stringify({
                    type: "notification",
                    from: message.from,
                    level: "info",
                    message: `${message.from} entrou no Melix.`,
                    timestamp: Date.now()
                });
                for (const [deviceId, clientWs] of state.clients.entries()) {
                    if (deviceId !== message.from) {
                        clientWs.send(joinNotification);
                    }
                }
                (0, presence_1.broadcastPresenceList)(state.app, state.onlineUsers);
                (0, presence_1.sendPresenceToClient)(ws, state.onlineUsers);
                (0, clipboard_1.sendClipboardHistory)(ws, state.clipboardHistory);
                logger_1.logger.info(`Cliente registrado: ${message.from}`);
                break;
            }
            case "join_room": {
                if (!currentDevice || !message.room) {
                    return;
                }
                (0, rooms_1.joinRoom)(state.rooms, message.room, currentDevice);
                logger_1.logger.info(`${currentDevice} entrou na sala ${message.room}`);
                break;
            }
            case "leave_room": {
                if (!currentDevice || !message.room) {
                    return;
                }
                (0, rooms_1.leaveRoom)(state.rooms, message.room, currentDevice);
                logger_1.logger.info(`${currentDevice} saiu da sala ${message.room}`);
                break;
            }
            case "chat_global":
                (0, chat_1.sendGlobalChat)(state.app, { ...message, from: currentDevice ?? message.from });
                break;
            case "chat_room":
                (0, chat_1.sendRoomChat)(state.app, state.rooms, { ...message, from: currentDevice ?? message.from });
                break;
            case "chat_private":
                (0, chat_1.sendPrivateChat)(state.clients, { ...message, from: currentDevice ?? message.from });
                break;
            case "broadcast":
                (0, broadcast_1.sendBroadcast)(state.app, { ...message, from: currentDevice ?? message.from });
                break;
            case "notification":
                (0, notifications_1.sendNotification)(state.app, state.clients, {
                    ...message,
                    from: currentDevice ?? message.from
                });
                break;
            case "clipboard_add":
                (0, clipboard_1.addClipboardItem)(state.clipboardHistory, message.message, currentDevice);
                state.app.publish("melix:all", JSON.stringify({
                    type: "clipboard_history",
                    message: JSON.stringify(state.clipboardHistory),
                    timestamp: Date.now()
                }));
                break;
            case "clipboard_delete": {
                const deleted = (0, clipboard_1.deleteClipboardItem)(state.clipboardHistory, message.clipboardId, currentDevice);
                if (!deleted && currentDevice) {
                    ws.send(JSON.stringify({
                        type: "notification",
                        level: "warning",
                        message: "Voce so pode apagar itens do clipboard enviados por voce.",
                        timestamp: Date.now()
                    }));
                }
                if (deleted) {
                    state.app.publish("melix:all", JSON.stringify({
                        type: "clipboard_history",
                        message: JSON.stringify(state.clipboardHistory),
                        timestamp: Date.now()
                    }));
                }
                break;
            }
            case "clipboard_history":
                (0, clipboard_1.sendClipboardHistory)(ws, state.clipboardHistory);
                break;
            case "ping":
                ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
                break;
            default:
                logger_1.logger.warn(`Evento ignorado: ${message.type}`);
                break;
        }
    }
    catch (error) {
        logger_1.logger.error(`Falha ao processar mensagem: ${error.message}`);
    }
};
exports.handleMessage = handleMessage;
const handleClose = (ws, state) => {
    const deviceId = ws.getUserData().deviceId;
    if (!deviceId) {
        return;
    }
    state.clients.delete(deviceId);
    state.onlineUsers.delete(deviceId);
    for (const room of state.rooms.values()) {
        room.delete(deviceId);
    }
    (0, presence_1.notifyLeave)(state.app, deviceId);
    (0, presence_1.broadcastPresenceList)(state.app, state.onlineUsers);
    logger_1.logger.info(`Cliente desconectado: ${deviceId}`);
};
exports.handleClose = handleClose;
