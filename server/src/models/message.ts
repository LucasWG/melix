export type MelixEventType =
  | "register"
  | "presence_list"
  | "user_join"
  | "user_leave"
  | "chat_global"
  | "chat_room"
  | "chat_private"
  | "chat_private_read"
  | "chat_global_read"
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
  messageId?: string;
  readers?: string[];
  clipboardId?: string;
  level?: NotificationLevel;
  timestamp?: number;
}

