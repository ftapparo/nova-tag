import type { AccessVerifyData } from './tag-validator';

/**
 * Passagens pelo portão: quais TAGs foram lidas em cada ciclo (abriu → fechou),
 * quais são intrusas e o que gravar no ERP quando o ciclo fecha.
 *
 * Intrusa é a TAG de um veículo parado no alcance da antena (ex.: carro de vaga
 * fixa de frente para a antena da saída). Como a antena só lê com um veículo no
 * laço indutivo, ela é lida junto com quem está passando e, sem este controle,
 * abria o portão e gravava passagens falsas no ERP.
 *
 * Sem rede, sem log e sem relógio próprio: quem chama informa o horário, o que
 * permite reproduzir dias reais de leitura em teste.
 */

export interface PassageTrackerOptions {
    detectionEnabled: boolean;
    intruderMinGapMs: number;    // intervalo mínimo entre as aparições em dois ciclos seguidos
    intruderMaxGapMs: number;    // intervalo máximo (além disso, pode ser o carro saindo de novo)
    confirmations: number;       // leituras seguidas da intrusa sozinha para liberar
    readGapMs: number;           // leituras mais afastadas que isso não são "seguidas"
    dedupMs: number;             // a mesma TAG não é gravada de novo dentro deste intervalo
}

export type ReadDecision =
    | { action: 'process' }
    | { action: 'ignore' }
    | { action: 'await'; count: number };

export interface Registration {
    tag: string;
    verifyData: AccessVerifyData;
    passedAt: Date;
}

export interface CycleResult {
    registrations: Registration[];
    skipped: { tag: string; reason: string }[];
    marked: { tag: string; gapMs: number }[];
}

interface TagInCycle {
    first: number;
    last: number;
    verifyData?: AccessVerifyData;   // presente só para TAG autorizada
    acceptedAlone: boolean;
}

export class PassageTracker {
    private readonly intruders = new Set<string>();
    private cycle: Map<string, TagInCycle> | null = null;
    private cycleOpenedWithoutTag = false;
    private controlledBy = new Set<string>();
    // Leituras com o portão fechado: viram parte do próximo ciclo se ele abrir logo.
    private outsideCycle = new Map<string, TagInCycle>();
    private previousCycle = new Map<string, number>();   // TAG → última leitura no ciclo anterior
    private readonly registeredAt = new Map<string, number>();
    private aloneTag: string | null = null;
    private aloneCount = 0;
    private aloneLast = 0;

    constructor(private readonly options: PassageTrackerOptions) {}

    isIntruder(tag: string): boolean {
        return this.intruders.has(tag);
    }

    getIntruders(): string[] {
        return [...this.intruders];
    }

    /**
     * Registra uma leitura e decide o que fazer com ela.
     * @param tag Número da TAG.
     * @param now Horário da leitura (ms).
     * @returns `process` segue o fluxo normal; `ignore` descarta (intrusa com
     * outro veículo); `await` aguarda mais leituras da intrusa sozinha.
     */
    onRead(tag: string, now: number): ReadDecision {
        const entry = this.record(tag, now);

        if (!this.options.detectionEnabled || !this.intruders.has(tag)) {
            this.aloneTag = null;   // outro veículo no laço: a sequência da intrusa recomeça
            return { action: 'process' };
        }
        if (this.otherVehiclePresent(now)) {
            this.aloneTag = null;
            return { action: 'ignore' };
        }
        if (entry.acceptedAlone) {
            return { action: 'process' };
        }

        if (this.aloneTag === tag && now - this.aloneLast < this.options.readGapMs) {
            this.aloneCount++;
        } else {
            this.aloneTag = tag;
            this.aloneCount = 1;
        }
        this.aloneLast = now;

        if (this.aloneCount < this.options.confirmations) {
            return { action: 'await', count: this.aloneCount };
        }
        entry.acceptedAlone = true;
        return { action: 'process' };
    }

    /** Guarda os dados da validação de uma TAG autorizada (usados na gravação). */
    setAuthorized(tag: string, verifyData: AccessVerifyData | undefined, now: number): void {
        if (!verifyData) return;
        this.record(tag, now).verifyData = verifyData;
    }

    /**
     * Ciclo aberto: as leituras recentes com o portão fechado (a que abriu e as
     * anteriores) passam a fazer parte dele.
     * @param openedBy TAG que abriu, ou `null` quando aberto pela portaria/app
     * (há um veículo no laço sem TAG lida).
     */
    startCycle(now: number, openedBy: string | null): void {
        this.cycle = new Map();
        for (const [tag, entry] of this.outsideCycle) {
            if (now - entry.last < this.options.readGapMs) this.cycle.set(tag, entry);
        }
        this.outsideCycle.clear();
        this.cycleOpenedWithoutTag = openedBy === null;
        this.controlledBy = new Set(openedBy ? [openedBy] : []);
    }

    /**
     * Primeira leitura autorizada de uma TAG nova com o ciclo aberto (fila): ela
     * assume o controle e o portão recebe um novo comando de abrir.
     * @returns `true` se a TAG é nova no ciclo.
     */
    claimControl(tag: string): boolean {
        if (!this.cycle || this.controlledBy.has(tag)) return false;
        this.controlledBy.add(tag);
        return true;
    }

    /**
     * Fecha o ciclo: marca intrusas novas e devolve o que gravar no ERP.
     * A detecção roda antes da gravação, para a intrusa já não ser gravada no
     * ciclo em que é marcada.
     */
    endCycle(now: number): CycleResult {
        const result: CycleResult = { registrations: [], skipped: [], marked: [] };
        if (!this.cycle) return result;
        const cycle = this.cycle;

        if (this.options.detectionEnabled) {
            for (const [tag, entry] of cycle) {
                const previousLast = this.previousCycle.get(tag);
                if (previousLast === undefined || this.intruders.has(tag)) continue;
                const gapMs = entry.first - previousLast;
                if (gapMs >= this.options.intruderMinGapMs && gapMs <= this.options.intruderMaxGapMs) {
                    this.intruders.add(tag);
                    result.marked.push({ tag, gapMs });
                }
            }
        }

        const otherVehicle = this.cycleOpenedWithoutTag || [...cycle.keys()].some((tag) => !this.intruders.has(tag));
        for (const [registered, at] of this.registeredAt) {
            if (now - at > this.options.dedupMs) this.registeredAt.delete(registered);
        }

        for (const [tag, entry] of cycle) {
            if (!entry.verifyData) continue;   // não autorizada: não grava, como sempre
            if (this.intruders.has(tag) && (otherVehicle || !entry.acceptedAlone)) {
                result.skipped.push({ tag, reason: 'intrusa com outro veículo no ciclo' });
                continue;
            }
            const lastRegistration = this.registeredAt.get(tag);
            if (lastRegistration !== undefined && entry.first - lastRegistration < this.options.dedupMs) {
                result.skipped.push({ tag, reason: 'já gravada nesta passagem' });
                continue;
            }
            this.registeredAt.set(tag, entry.first);
            result.registrations.push({ tag, verifyData: entry.verifyData, passedAt: new Date(entry.first) });
        }

        this.previousCycle = new Map([...cycle].map(([tag, entry]) => [tag, entry.last]));
        this.cycle = null;
        this.cycleOpenedWithoutTag = false;
        this.controlledBy.clear();
        return result;
    }

    private record(tag: string, now: number): TagInCycle {
        const target = this.cycle ?? this.outsideCycle;
        if (!this.cycle) {
            for (const [other, entry] of this.outsideCycle) {
                if (now - entry.last >= this.options.readGapMs) this.outsideCycle.delete(other);
            }
        }
        const entry = target.get(tag);
        if (entry) {
            entry.last = now;
            return entry;
        }
        const created: TagInCycle = { first: now, last: now, acceptedAlone: false };
        target.set(tag, created);
        return created;
    }

    private otherVehiclePresent(now: number): boolean {
        if (this.cycle) {
            return this.cycleOpenedWithoutTag || [...this.cycle.keys()].some((tag) => !this.intruders.has(tag));
        }
        return [...this.outsideCycle].some(([tag, entry]) => !this.intruders.has(tag) && now - entry.last < this.options.readGapMs);
    }
}
