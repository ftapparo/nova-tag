import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config();

const instanceName = (process.env.TAG_ID || process.argv[2] || "DEFAULT").toUpperCase();

const LOG_TO_FILE = process.env.LOG_TO_FILE === "true";
const LOG_BASE_DIR = process.env.LOG_DIR || "/app/logs";
const logDir = path.join(LOG_BASE_DIR, instanceName);

// Timestamp customizado (Brasil)
const timestampFormat = winston.format((info) => {
  const date = new Date()
    .toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    .replace(",", "");
  info.timestamp = `[${date}]`;
  return info;
});

// Cores do console
winston.addColors({
  info: "cyan",
  warn: "yellow",
  error: "red",
  debug: "white",
});

// Formato do console (stdout → docker logs)
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  timestampFormat(),
  winston.format.printf(({ timestamp, level, message }) => {
    return `[${instanceName}] ${timestamp} ${level}: ${message}`;
  })
);

// Formato do arquivo
const fileFormat = winston.format.combine(
  timestampFormat(),
  winston.format.printf(({ timestamp, level, message }) => {
    return `[${instanceName}] ${timestamp} ${level}: ${message}`;
  })
);

// Transports
const transports: winston.transport[] = [
  new winston.transports.Console({ format: consoleFormat }),
];

// Transporte de arquivo (OPCIONAL e CONTROLADO)
if (LOG_TO_FILE) {
  try {
    fs.mkdirSync(logDir, { recursive: true });

    const fileTransport = new DailyRotateFile({
      filename: path.join(logDir, "%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      maxSize: "10m",
      maxFiles: "7d",
      level: "debug",
      format: fileFormat,
      zippedArchive: true,
    });

    // Se o filesystem falhar, NÃO trava a aplicação
    fileTransport.on("error", (err) => {
      console.error(
        `[${instanceName}] LOGGER FILE TRANSPORT ERROR (file logging disabled):`,
        err
      );
    });

    transports.push(fileTransport);
  } catch (err) {
    console.error(
      `[${instanceName}] LOGGER INIT ERROR (file logging skipped):`,
      err
    );
  }
}

// Logger base
const baseLogger = winston.createLogger({
  level: "debug",
  transports,
});

// Logger estendido com helpers
const logger = Object.assign(baseLogger, {
  metric(name: string, value: string | number) {
    baseLogger.debug(`[Metric] ${name}_${instanceName}=${value}`);
  },

  counter(name: string) {
    baseLogger.debug(`[Counter] ${name}_${instanceName}+1`);
  },

  issue(error: string | Error, context: Record<string, any> = {}) {
    const err = error instanceof Error ? error : new Error(String(error));
    baseLogger.error(
      `[Issue] ${err.message} | context=${JSON.stringify({
        instance: instanceName,
        ...context,
      })}`
    );
  },
});

export default logger;
