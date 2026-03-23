import { startWebSocketServer } from "./websocket/server";
import { logger } from "./utils/logger";

const host = process.env.MELIX_HOST ?? "0.0.0.0";
const port = Number(process.env.MELIX_PORT ?? 3001);

startWebSocketServer({ host, port });
logger.info("Servidor inicializado");

