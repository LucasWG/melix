"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendClipboardHistory = exports.deleteClipboardItem = exports.addClipboardItem = void 0;
const MAX_ITEMS = 30;
const addClipboardItem = (clipboardHistory, content, owner) => {
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
exports.addClipboardItem = addClipboardItem;
const deleteClipboardItem = (clipboardHistory, itemId, requester) => {
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
exports.deleteClipboardItem = deleteClipboardItem;
const sendClipboardHistory = (ws, clipboardHistory) => {
    const payload = {
        type: "clipboard_history",
        message: JSON.stringify(clipboardHistory),
        timestamp: Date.now()
    };
    ws.send(JSON.stringify(payload));
};
exports.sendClipboardHistory = sendClipboardHistory;
