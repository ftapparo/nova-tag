import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

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

// Função para formatar data e hora corretamente
const timestampFormat = winston.format((info) => {
  const date = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }).replace(",", "");
  info.timestamp = `[${date}]`; // Exemplo: [25/03/2025 14:30:45]
  return info;
});

// Definir cores personalizadas para o console
winston.addColors({
  info: "cyan",
  warn: "yellow",
  error: "red",
  debug: "gray",
});

// Configuração do Console (exibe todos os logs)
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  timestampFormat(),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} ${level}: ${message}`;
  })
);

// Configuração para arquivos (EXCLUI logs debug e gera logs diários)
const fileFormat = winston.format.combine(
  timestampFormat(),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} ${level}: ${message}`;
  })
);

// Logger
export const logger = winston.createLogger({
  level: "debug", // Captura todos os logs, mas cada transport tem seu filtro
  format: winston.format.combine(winston.format.json()),
  transports: [
    new winston.transports.Console({ format: consoleFormat }), // Exibe TODOS os logs no console
    new DailyRotateFile({
      filename: "logs/%DATE%.log", // Criará arquivos diários com o nome no formato "logs/25032025.log"
      datePattern: "DDMMYYYY", // Formato da data para o nome do arquivo
      maxSize: "10m", // Limite de tamanho do arquivo antes de criar um novo
      maxFiles: "30d", // Mantém logs por 30 dias
      format: fileFormat,
      level: "info", // Apenas info, warn e error serão registrados no arquivo
    }),
  ],
});

// Hook para enviar logs ao Better Stack automaticamente (SOMENTE INFO, WARN, ERROR)
logger.on("data", (log) => {
  if (["info", "warn", "error"].includes(log.level)) {
    sendToBetterStack(log.level, log.message);
  }
});

export default logger;
