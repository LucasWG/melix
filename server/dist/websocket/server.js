"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWebSocketServer = void 0;
const uWebSockets_js_1 = __importDefault(require("uWebSockets.js"));
const events_1 = require("./events");
const logger_1 = require("../utils/logger");
const startWebSocketServer = ({ host, port }) => {
    const clients = new Map();
    const rooms = new Map();
    const onlineUsers = new Set();
    const clipboardHistory = [];
    const globalReadReceipts = new Map();
    const app = uWebSockets_js_1.default.App();
    app.ws("/ws", {
        compression: uWebSockets_js_1.default.SHARED_COMPRESSOR,
        maxPayloadLength: 16 * 1024,
        idleTimeout: 120,
        upgrade: (res, req, context) => {
            res.upgrade({}, req.getHeader("sec-websocket-key"), req.getHeader("sec-websocket-protocol"), req.getHeader("sec-websocket-extensions"), context);
        },
        open: (ws) => {
            ws.subscribe("melix:all");
            logger_1.logger.info("Conexao WebSocket aberta");
        },
        message: (ws, message) => {
            (0, events_1.handleMessage)(ws, message, {
                app,
                clients,
                rooms,
                onlineUsers,
                clipboardHistory,
                globalReadReceipts
            });
        },
        close: (ws) => {
            (0, events_1.handleClose)(ws, {
                app,
                clients,
                rooms,
                onlineUsers,
                clipboardHistory,
                globalReadReceipts
            });
        }
    });
    app.get("/health", (res) => {
        res.writeStatus("200 OK").writeHeader("content-type", "application/json").end(JSON.stringify({
            status: "ok",
            onlineUsers: onlineUsers.size,
            rooms: rooms.size,
            clipboardItems: clipboardHistory.length
        }));
    });
    app.listen(host, port, (token) => {
        if (!token) {
            logger_1.logger.error(`Nao foi possivel subir o servidor em ${host}:${port}`);
            process.exit(1);
        }
        logger_1.logger.info(`Melix ativo em ws://${host}:${port}/ws`);
    });
    return app;
};
exports.startWebSocketServer = startWebSocketServer;
