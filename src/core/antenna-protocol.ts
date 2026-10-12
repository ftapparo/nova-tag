/**
 * Formato dos quadros da antena (UHF Prime Reader User Manual V1.0, seção 1.2):
 *
 *   HEAD (0xCF) | ADDR | CMD (2) | LEN | STATUS + Data (LEN bytes) | CRC16 (2)
 *
 * O TCP entrega um fluxo de bytes, não mensagens: um pedaço recebido pode trazer
 * dois quadros grudados ou meio quadro. Os quadros são separados pelo LEN e
 * conferidos pelo CRC antes de qualquer interpretação.
 */

const FRAME_HEAD = 0xcf;
const HEADER_SIZE = 5;   // HEAD + ADDR + CMD (2) + LEN
const CRC_SIZE = 2;

/** Códigos de comando (CMD) usados por este serviço. */
export const AntennaCmd = {
    TAG_READ: 0x0001,      // RFM_INVENTORY_ACTIVE: leitura enviada pela antena em modo ativo
    MODULE_INT: 0x0050,    // RFM_MODULE_INT: verificação de antena online (healthcheck)
    MASK: 0x0076,          // Máscara de leitura (fora do manual V1.0; formato estendido do 0x0073)
    RELAY: 0x0077,         // RFM_RELEASE_CLOSE_RELAY
} as const;

/** Quadro de resposta já validado pelo CRC. */
export interface AntennaFrame {
    cmd: number;
    status: number;
    data: Buffer;          // bytes após o STATUS
    raw: Buffer;
}

/**
 * CRC16 do Apêndice B do manual (valor inicial 0xFFFF, polinômio 0x8408),
 * calculado de HEAD até o fim de Data[] e transmitido com o byte alto primeiro.
 * @param bytes Bytes do quadro sem o CRC.
 * @returns CRC calculado.
 */
export function crc16(bytes: Buffer): number {
    let crc = 0xffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = crc & 1 ? (crc >> 1) ^ 0x8408 : crc >> 1;
        }
    }
    return crc;
}

/**
 * Separa os quadros completos e válidos de um buffer acumulado.
 * @param buffer Bytes pendentes da conexão mais os recém-recebidos.
 * @returns Quadros válidos, bytes descartados (fora de quadro ou com CRC inválido)
 * e o resto incompleto, que deve ser mantido até chegar o restante.
 */
export function extractFrames(buffer: Buffer): { frames: AntennaFrame[]; discarded: Buffer[]; rest: Buffer } {
    const frames: AntennaFrame[] = [];
    const discarded: Buffer[] = [];
    let pending = buffer;

    while (pending.length > 0) {
        const head = pending.indexOf(FRAME_HEAD);
        if (head === -1) {
            discarded.push(pending);
            return { frames, discarded, rest: Buffer.alloc(0) };
        }
        if (head > 0) {
            discarded.push(pending.subarray(0, head));
            pending = pending.subarray(head);
        }

        if (pending.length < HEADER_SIZE) {
            break;
        }
        const size = HEADER_SIZE + pending[4] + CRC_SIZE;
        if (pending.length < size) {
            break;
        }

        const raw = pending.subarray(0, size);
        if (crc16(raw.subarray(0, size - CRC_SIZE)) !== raw.readUInt16BE(size - CRC_SIZE)) {
            // 0xCF solto no meio dos dados não é início de quadro: descarta só esse
            // byte e procura o próximo, para não perder um quadro válido logo adiante.
            discarded.push(pending.subarray(0, 1));
            pending = pending.subarray(1);
            continue;
        }

        frames.push({
            cmd: raw.readUInt16BE(2),
            status: raw[4] > 0 ? raw[HEADER_SIZE] : -1,
            data: raw.subarray(HEADER_SIZE + 1, size - CRC_SIZE),
            raw: Buffer.from(raw),
        });
        pending = pending.subarray(size);
    }

    return { frames, discarded, rest: Buffer.from(pending) };
}
