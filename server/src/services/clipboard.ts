import type { WebSocket } from "uWebSockets.js";
import type { MelixMessage } from "../models/message";

export interface WsData {
  deviceId?: string;
}

const MAX_ITEMS = 30;

export interface ClipboardItem {
  id: string;
  content: string;
  owner: string;
  timestamp: number;
}

export const addClipboardItem = (
  clipboardHistory: ClipboardItem[],
  content: string | undefined,
  owner: string | undefined
): ClipboardItem[] => {
  if (!content || !owner) {
    return clipboardHistory;
  }

  clipboardHistory.unshift({
    id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    content,
    owner,
    timestamp: Date.now()
  });

  if (clipboardHistory.length > MAX_ITEMS) {
    clipboardHistory.length = MAX_ITEMS;
  }

  return clipboardHistory;
};

export const deleteClipboardItem = (
  clipboardHistory: ClipboardItem[],
  itemId: string | undefined,
  requester: string | undefined
): boolean => {
  if (!itemId || !requester) {
    return false;
  }

  const index = clipboardHistory.findIndex((item) => item.id === itemId);
  if (index < 0) {
    return false;
  }

  if (clipboardHistory[index].owner !== requester) {
    return false;
  }

  clipboardHistory.splice(index, 1);
  return true;
};

export const sendClipboardHistory = (
  ws: WebSocket<WsData>,
  clipboardHistory: ClipboardItem[]
): void => {
  const payload: MelixMessage = {
    type: "clipboard_history",
    message: JSON.stringify(clipboardHistory),
    timestamp: Date.now()
  };
  ws.send(JSON.stringify(payload));
};

