import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import path from "path";
import dotenv from "dotenv";
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

const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  timestampFormat(),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} ${level}: ${message}`;
  })
);

const fileFormat = winston.format.combine(
  timestampFormat(),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} ${level}: ${message}`;
  })
);

// Logger base
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

// Mapa para métricas únicas
const metricsMap: Record<string, ReturnType<typeof io.metric>> = {};

// Criação do logger com funções adicionais
const proxyLogger = {
  ...baseLogger,

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
   * Envia uma issue (erro crítico) para o PM2+
   * @param error Mensagem de erro ou Error
   * @param context Objeto adicional com contexto
   */
  issue(error: string | Error, context: Record<string, any> = {}) {
    const err = error instanceof Error ? error : new Error(String(error));
    io.notifyError(err, { custom: context });
  },

  /**
   * Wrapper para logger.error que também envia issue para o PM2+
   */
  error(message: string, ...args: any[]) {
    baseLogger.error(message, ...args);
    this.issue(message);
  },
};

export default proxyLogger;
