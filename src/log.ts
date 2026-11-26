// src/log.ts
// The one logger: every line starts with the product name, data goes to stderr so `status --json` keeps stdout clean.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type Logger = {
    readonly verbose: boolean;
    debug(message: string, detail?: unknown): void;
    info(message: string, detail?: unknown): void;
    warn(message: string, detail?: unknown): void;
    error(message: string, detail?: unknown): void;
};

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const clockOf = (now: number): string => {
    const date = new Date(now);
    const pad = (value: number, size = 2) => String(value).padStart(size, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const describeDetail = (detail: unknown): string => {
    if (detail === undefined) return '';
    if (detail instanceof Error) return ` ${detail.name}: ${detail.message}`;
    try {
        return ` ${JSON.stringify(detail)}`;
    } catch {
        return ` ${String(detail)}`;
    }
};

export function createLogger({
    verbose = false,
    level = verbose ? 'debug' : 'info',
    now = Date.now,
    write = (line: string) => process.stderr.write(`${line}\n`),
}: {
    verbose?: boolean;
    level?: LogLevel;
    now?: () => number;
    write?: (line: string) => void;
} = {}): Logger {
    const floor = LEVELS[level];
    const emit = (entry: LogLevel, message: string, detail?: unknown) => {
        if (LEVELS[entry] < floor) return;
        write(`[Spolyric] ${clockOf(now())} ${entry} ${message}${describeDetail(detail)}`);
    };
    return {
        verbose,
        debug: (message, detail) => emit('debug', message, detail),
        info: (message, detail) => emit('info', message, detail),
        warn: (message, detail) => emit('warn', message, detail),
        error: (message, detail) => emit('error', message, detail),
    };
}
