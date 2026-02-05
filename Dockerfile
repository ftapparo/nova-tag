# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copia arquivos de dependências
COPY package*.json ./
COPY tsconfig.json ./

# Instala TODAS as dependências (incluindo devDependencies para o build)
RUN npm install && \
    npm cache clean --force

# Copia código fonte
COPY src ./src

# Build da aplicação TypeScript
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Copia apenas package.json para instalar dependências de produção
COPY package*.json ./

# Instala apenas dependências de produção
RUN npm install --only=production && \
    npm cache clean --force

# Copia build da stage anterior
COPY --from=builder /app/dist ./dist
COPY .env ./.env

# Cria diretório para logs
RUN mkdir -p logs

# Expõe as portas das duas instâncias
EXPOSE 4000

# Define variáveis de ambiente padrão
ENV NODE_ENV=production

# Comando para iniciar a aplicação
CMD ["node", "dist/server.js"]
