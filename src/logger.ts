import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import dotenv from "dotenv";
import path from "path";
import io from "@pm2/io";

dotenv.config();

const instanceName = process.argv[2] || "DEFAULT";
const logDir = path.join("logs", instanceName.toUpperCase());

// Timestamp customizado
const timestampFormat = winston.format((info) => {
  const date = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  }).replace(",", "");
  info.timestamp = `[${date}]`;
  return info;
});

// Cores para console
winston.addColors({
  info: "cyan",
  warn: "yellow",
  error: "red",
  debug: "white",
});

// Formato para console
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  timestampFormat(),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} ${level}: ${message}`;
  })
);

// Formato para arquivos
const fileFormat = winston.format.combine(
  timestampFormat(),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} ${level}: ${message}`;
  })
);

// Instância base do logger
const baseLogger = winston.createLogger({
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

// Mapa de métricas únicas
const metricsMap: Record<string, ReturnType<typeof io.metric>> = {};

// Adiciona métodos customizados ao logger
const logger = Object.assign(baseLogger, {
  /**
   * Envia uma métrica para o PM2+
   * @param name Nome da métrica
   * @param value Valor da métrica
   */
  metric(name: string, value: string | number) {
    if (!metricsMap[name]) {
      metricsMap[name] = io.metric({ name });
    }
    metricsMap[name].set(value);
  },

  /**
   * Envia uma issue para o PM2+
   * @param error Mensagem ou objeto Error
   * @param context Objeto de contexto (opcional)
   */
  issue(error: string | Error, context: Record<string, any> = {}) {
    const err = error instanceof Error ? error : new Error(String(error));
    io.notifyError(err, { custom: context });
  },
});

export default logger;
