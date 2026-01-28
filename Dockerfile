# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copia arquivos de dependências
COPY package*.json ./
COPY tsconfig.json ./

# Instala dependências
RUN npm ci --only=production && \
    npm cache clean --force

# Copia código fonte
COPY src ./src

# Build da aplicação TypeScript
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

# Instala PM2 globalmente
RUN npm install -g pm2

WORKDIR /app

# Copia dependências e build da stage anterior
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Copia arquivo de configuração do PM2
COPY ecosystem.config.js ./

# Cria diretório para logs
RUN mkdir -p logs

# Expõe as portas das duas instâncias
EXPOSE 4009 4010

# Define variáveis de ambiente padrão
ENV NODE_ENV=production

# Comando para iniciar a aplicação com PM2
CMD ["pm2-runtime", "start", "ecosystem.config.js"]
