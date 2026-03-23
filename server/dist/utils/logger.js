"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const format = (level, message) => {
    return `[${new Date().toISOString()}] [${level}] ${message}`;
};
exports.logger = {
    info(message) {
        console.log(format("INFO", message));
    },
    warn(message) {
        console.warn(format("WARN", message));
    },
    error(message) {
        console.error(format("ERROR", message));
    }
};
