export const joinRoom = (
  rooms: Map<string, Set<string>>,
  roomName: string,
  deviceId: string
): void => {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, new Set<string>());
  }

  rooms.get(roomName)?.add(deviceId);
};

export const leaveRoom = (
  rooms: Map<string, Set<string>>,
  roomName: string,
  deviceId: string
): void => {
  const room = rooms.get(roomName);

  if (!room) {
    return;
  }

  room.delete(deviceId);

  if (room.size === 0) {
    rooms.delete(roomName);
  }
};

export const getRoomMembers = (
  rooms: Map<string, Set<string>>,
  roomName: string
): Set<string> => {
  return rooms.get(roomName) ?? new Set<string>();
};

