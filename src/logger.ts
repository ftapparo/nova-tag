import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import dotenv from "dotenv";
import axios from "axios";
import path from "path";

dotenv.config();

// Captura o argumento passado (ex: "TAG1" ou "TAG2")
const instanceName = process.argv[2] || "DEFAULT";

// Caminho do diretório de logs
const logDir = path.join("logs", instanceName.toUpperCase());

// Função para enviar logs ao Better Stack
const sendToBetterStack = async (level: string, message: string) => {
  try {
    if (["info", "warn", "error"].includes(level)) {
      await axios.post(
        process.env.BETTERSTACK_URL || "",
        {
          dt: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }).replace(",", ""),
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

// Formata a data/hora para logs
const timestampFormat = winston.format((info) => {
  const date = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }).replace(",", "");
  info.timestamp = `[${date}]`;
  return info;
});

// Cores para o console
winston.addColors({
  info: "cyan",
  warn: "yellow",
  error: "red",
  debug: "white",
});

// Console formatado
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  timestampFormat(),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} ${level}: ${message}`;
  })
);

// Arquivos formatados
const fileFormat = winston.format.combine(
  timestampFormat(),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} ${level}: ${message}`;
  })
);

// Logger
export const logger = winston.createLogger({
  level: "debug",
  format: winston.format.combine(winston.format.json()),
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    new DailyRotateFile({
      filename: `${logDir}/%DATE%.log`,
      datePattern: "DDMMYYYY",
      maxSize: "10m",
      maxFiles: "30d",
      format: fileFormat,
      level: "debug",
    }),
  ],
});

// Envia automaticamente para o Better Stack
// logger.on("data", (log) => {
//   if (["info", "warn", "error"].includes(log.level)) {
//     sendToBetterStack(log.level, log.message);
//   }
// });

export default logger;
