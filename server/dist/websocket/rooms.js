"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRoomMembers = exports.leaveRoom = exports.joinRoom = void 0;
const joinRoom = (rooms, roomName, deviceId) => {
    if (!rooms.has(roomName)) {
        rooms.set(roomName, new Set());
    }
    rooms.get(roomName)?.add(deviceId);
};
exports.joinRoom = joinRoom;
const leaveRoom = (rooms, roomName, deviceId) => {
    const room = rooms.get(roomName);
    if (!room) {
        return;
    }
    room.delete(deviceId);
    if (room.size === 0) {
        rooms.delete(roomName);
    }
};
exports.leaveRoom = leaveRoom;
const getRoomMembers = (rooms, roomName) => {
    return rooms.get(roomName) ?? new Set();
};
exports.getRoomMembers = getRoomMembers;
