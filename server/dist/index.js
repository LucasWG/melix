"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("./websocket/server");
const logger_1 = require("./utils/logger");
const host = process.env.MELIX_HOST ?? "0.0.0.0";
const port = Number(process.env.MELIX_PORT ?? 3001);
(0, server_1.startWebSocketServer)({ host, port });
logger_1.logger.info("Servidor inicializado");
