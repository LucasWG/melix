"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPresenceToClient = exports.notifyLeave = exports.notifyJoin = exports.broadcastPresenceList = void 0;
const send = (ws, payload) => {
    ws.send(JSON.stringify({ ...payload, timestamp: Date.now() }));
};
const broadcastPresenceList = (app, onlineUsers) => {
    const presencePayload = {
        type: "presence_list",
        message: JSON.stringify([...onlineUsers])
    };
    app.publish("melix:all", JSON.stringify({ ...presencePayload, timestamp: Date.now() }));
};
exports.broadcastPresenceList = broadcastPresenceList;
const notifyJoin = (app, deviceId) => {
    const payload = {
        type: "user_join",
        from: deviceId,
        message: `${deviceId} entrou.`
    };
    app.publish("melix:all", JSON.stringify({ ...payload, timestamp: Date.now() }));
};
exports.notifyJoin = notifyJoin;
const notifyLeave = (app, deviceId) => {
    const payload = {
        type: "user_leave",
        from: deviceId,
        message: `${deviceId} saiu.`
    };
    app.publish("melix:all", JSON.stringify({ ...payload, timestamp: Date.now() }));
};
exports.notifyLeave = notifyLeave;
const sendPresenceToClient = (ws, onlineUsers) => {
    send(ws, {
        type: "presence_list",
        message: JSON.stringify([...onlineUsers])
    });
};
exports.sendPresenceToClient = sendPresenceToClient;
