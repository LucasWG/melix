export type MelixEventType =
  | "register"
  | "presence_list"
  | "user_join"
  | "user_leave"
  | "chat_global"
  | "chat_room"
  | "chat_private"
  | "join_room"
  | "leave_room"
  | "broadcast"
  | "notification"
  | "clipboard_add"
  | "clipboard_delete"
  | "clipboard_history"
  | "ping"
  | "pong";

export type NotificationLevel = "info" | "warning" | "error" | "success";

export interface MelixMessage {
  type: MelixEventType;
  from?: string;
  to?: string;
  room?: string;
  message?: string;
  clipboardId?: string;
  level?: NotificationLevel;
  timestamp?: number;
}

