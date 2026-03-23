import type { TemplatedApp } from "uWebSockets.js";
import type { MelixMessage } from "../models/message";

export const sendBroadcast = (app: TemplatedApp, message: MelixMessage): void => {
  app.publish("melix:all", JSON.stringify({ ...message, timestamp: Date.now() }));
};

