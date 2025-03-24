import Firebird from 'node-firebird';
import dotenv from 'dotenv';
import net from 'net';

interface AntennaConfig {
    device: number;
    ip: string;
    port: number;
    direction: string;
}

// Carregar variáveis de ambiente
dotenv.config();

const firebirdOptions = {
    host: process.env.FIREBIRD_HOST,
    port: parseInt(process.env.FIREBIRD_PORT || '3050', 10),
    database: process.env.FIREBIRD_DATABASE,
    user: process.env.FIREBIRD_USER,
    password: process.env.FIREBIRD_PASSWORD,
};

// Variável global para armazenar a conexão
let dbConnection: any = null;

// Função para obter a conexão persistente
export const openConnection = (): Promise<any> => {
    return new Promise((resolve, reject) => {
        if (dbConnection) {
            resolve(dbConnection);
        } else {
            Firebird.attach(firebirdOptions, (err, db: any) => {
                if (err) {
                    reject(err);
                } else {
                    dbConnection = db;
                    resolve(dbConnection);
                }
            });
        }
    });
};

// Função para encerrar a conexão
export const closeConnection = (): Promise<void> => {
    return new Promise((resolve, reject) => {
        if (dbConnection) {
            dbConnection.detach((err: any) => {
                if (err) {
                    reject(err);
                } else {
                    dbConnection = null;
                    resolve();
                }
            });
        } else {
            resolve();
        }
    });
};

// Função para executar uma consulta
export const executeQuery = async (query: string): Promise<any> => {
    const db = await openConnection();
    return new Promise((resolve, reject) => {
        db.query(query, (err: any, result: unknown) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
};

// **Função para liberar veículos**
export const openGateVehicle = async ({
    device,
    ip,
    port,
    direction
}: AntennaConfig,
    tag: string
): Promise<{ success: boolean; message: string }> => {

    try {
        // Chamar a procedure para validar o acesso
        const query = `EXECUTE PROCEDURE ACESSO_DISPOSITIVO ('${tag}', ${device}, NULL, '${direction}')`;
        const result = await executeQuery(query);

        if (!result || result.length === 0) {
            return { success: false, message: 'Erro ao obter resposta do banco de dados.' };
        }

        if (result.PERMITIDO.trim() === 'S') {
            return { success: true, message: 'Acesso liberado.' };
        } else {
            return { success: false, message: 'Acesso negado.' };
        }

    } catch (error) {
        console.error('Erro na liberação do veículo:', error);
        return { success: false, message: 'Erro ao consultar o banco de dados.' };
    }
};
