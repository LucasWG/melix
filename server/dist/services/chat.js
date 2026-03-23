"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPrivateChat = exports.sendRoomChat = exports.sendGlobalChat = void 0;
const rooms_1 = require("../websocket/rooms");
const publish = (app, channel, payload) => {
    app.publish(channel, JSON.stringify({ ...payload, timestamp: Date.now() }));
};
const sendGlobalChat = (app, message) => {
    publish(app, "melix:all", message);
};
exports.sendGlobalChat = sendGlobalChat;
const sendRoomChat = (app, rooms, message) => {
    if (!message.room) {
        return;
    }
    const roomMembers = (0, rooms_1.getRoomMembers)(rooms, message.room);
    for (const member of roomMembers) {
        publish(app, `melix:device:${member}`, message);
    }
};
exports.sendRoomChat = sendRoomChat;
const sendPrivateChat = (clients, message) => {
    if (!message.to) {
        return;
    }
    const targetWs = clients.get(message.to);
    if (!targetWs) {
        return;
    }
    targetWs.send(JSON.stringify({ ...message, timestamp: Date.now() }));
};
exports.sendPrivateChat = sendPrivateChat;
