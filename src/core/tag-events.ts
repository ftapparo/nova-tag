import { EventEmitter } from 'events';

/**
 * Eventos do TAG em tempo real, consumidos pelo WebSocket /v3/ws.
 *
 * Emissor de módulo (não por instância) porque GateController é recriado
 * a cada reconexão com a antena — quem assina não precisa se reinscrever.
 * A v2 não assina nada; emitir sem ouvinte é inofensivo.
 */
export type TagEventMap = {
    'gate.state.changed': { state: 'closed' | 'opening' | 'open' | 'closing'; keepOpen: boolean };
    'antenna.connection.changed': { connected: boolean };
    // Sem NOME/QUADRA/LOTE: o canal não carrega dado pessoal; quem precisar
    // consulta o cache pela rota autenticada.
    'tag.read': { tag: string; authorized: boolean; reason: string | null; direction: string };
};

export type TagEventName = keyof TagEventMap;

class TagEvents extends EventEmitter {
    emitEvent<K extends TagEventName>(event: K, data: TagEventMap[K]): void {
        this.emit(event, data);
    }

    onEvent<K extends TagEventName>(event: K, listener: (data: TagEventMap[K]) => void): void {
        this.on(event, listener);
    }
}

export const tagEvents = new TagEvents();
