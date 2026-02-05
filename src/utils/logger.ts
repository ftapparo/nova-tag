import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import dotenv from "dotenv";
import path from "path";

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
    return `[${instanceName}] ${timestamp} ${level}: ${message}`;
  })
);

// Formato para arquivos
const fileFormat = winston.format.combine(
  timestampFormat(),
  winston.format.printf(({ timestamp, level, message }) => {
    return `[${instanceName}] ${timestamp} ${level}: ${message}`;
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

// Adiciona métodos customizados ao logger
const logger = Object.assign(baseLogger, {
  /**
   * Registra uma métrica única (valor direto) no log local, com nome separado por instância
   * @param name Nome da métrica (sem o nome da instância)
   * @param value Valor da métrica (string ou número)
   */
  metric(name: string, value: string | number) {
    const fullName = `${name}_${instanceName}`;
    if (process.env.DEBUG === "true") {
      baseLogger.debug(`[Metric] ${fullName}=${value}`);
    }
  },

  /**
   * Incrementa um contador por nome e instância no log local
   * @param name Nome do contador
   * @param increment Valor a ser incrementado (padrão: 1)
   */
  counter(name: string) {
    const fullName = `${name}_${instanceName}`;
    if (process.env.DEBUG === "true") {
      baseLogger.debug(`[Counter] ${fullName}+1`);
    }
  },

  /**
   * Registra uma issue (erro crítico) no log local
   * @param error Mensagem ou objeto Error
   * @param context Objeto adicional com contexto (opcional)
   */
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
