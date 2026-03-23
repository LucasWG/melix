"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendBroadcast = void 0;
const sendBroadcast = (app, message) => {
    app.publish("melix:all", JSON.stringify({ ...message, timestamp: Date.now() }));
};
exports.sendBroadcast = sendBroadcast;
