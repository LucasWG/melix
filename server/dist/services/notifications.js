"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendNotification = void 0;
const sendNotification = (app, clients, message) => {
    const payload = JSON.stringify({ ...message, timestamp: Date.now() });
    if (message.to) {
        clients.get(message.to)?.send(payload);
        return;
    }
    app.publish("melix:all", payload);
};
exports.sendNotification = sendNotification;
