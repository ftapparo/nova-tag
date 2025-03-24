import winston from "winston";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

// 🔹 Função para enviar logs manualmente ao Better Stack
const sendToBetterStack = async (level: string, message: string) => {
  try {
    if (["info", "warn", "error"].includes(level)) { // 🔹 Ignora logs de `debug`
      await axios.post(
        process.env.BETTERSTACK_URL || "",
        {
          dt: new Date().toISOString(),
          level,
          message,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.BETTERSTACK_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );
    }
  } catch (error) {
    console.error("Erro ao enviar log para Better Stack:", error);
  }
};

// 🔹 Função para formatar data e hora
const timestampFormat = winston.format((info) => {
  const date = new Date().toISOString().replace("T", " ").replace("Z", "");
  info.timestamp = `[${date}]`; // Exemplo: [2025-03-11 14:30:45.123]
  return info;
});

// 🔹 Definir cores personalizadas
winston.addColors({
  info: "cyan",
  warn: "yellow",
  error: "red",
  debug: "gray", // Tons de cinza para logs detalhados
});

// 🔹 Configuração das cores no Console
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  timestampFormat(),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} ${level}: ${message}`;
  })
);

// 🔹 Configuração para arquivo (sem cores)
const fileFormat = winston.format.combine(
  timestampFormat(),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} ${level}: ${message}`;
  })
);

// 🔹 Logger
export const logger = winston.createLogger({
  level: "debug", // Captura todos os logs, mas filtra por transport
  format: winston.format.combine(winston.format.json()),
  transports: [
    new winston.transports.File({ filename: "logs/app.log", format: fileFormat }), // 🔹 Salva TODOS os logs
    new winston.transports.Console({ format: consoleFormat }), // 🔹 Exibe TODOS no terminal
  ],
});

// 🔹 Hook para enviar logs ao Better Stack automaticamente (SOMENTE INFO, WARN, ERROR)
logger.on("data", (log) => {
  if (["info", "warn", "error"].includes(log.level)) {
    sendToBetterStack(log.level, log.message);
  }
});

export default logger;
