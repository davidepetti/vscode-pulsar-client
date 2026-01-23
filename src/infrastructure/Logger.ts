import * as vscode from 'vscode';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

// Logger cache for singleton pattern
const loggerCache = new Map<string, Logger>();

// Check if running in test environment
const isTestEnvironment = (): boolean => {
    return process.env.NODE_ENV === 'test' ||
           process.env.VSCODE_TEST === '1' ||
           typeof (global as any).it === 'function' ||
           (global as any).IS_TEST === true;
};

export class Logger {
    private static globalLevel: LogLevel = LogLevel.INFO;
    private channel: vscode.OutputChannel | null;
    private isNoOp: boolean;

    private constructor(private name: string) {
        // In test environment, use no-op logger to prevent file handle exhaustion
        this.isNoOp = isTestEnvironment();

        if (this.isNoOp) {
            this.channel = null;
        } else {
            this.channel = vscode.window.createOutputChannel(`Pulsar: ${name}`);
        }
    }

    /**
     * Set the global log level for all loggers
     */
    static setLevel(level: LogLevel): void {
        Logger.globalLevel = level;
    }

    /**
     * Get logger instance for a specific component (singleton pattern)
     */
    static getLogger(name: string): Logger {
        if (loggerCache.has(name)) {
            return loggerCache.get(name)!;
        }

        const logger = new Logger(name);
        loggerCache.set(name, logger);
        return logger;
    }

    /**
     * Clear all cached loggers (useful for testing)
     */
    static clearLoggers(): void {
        loggerCache.forEach(logger => logger.dispose());
        loggerCache.clear();
    }

    debug(message: string, ...data: any[]): void {
        if (Logger.globalLevel <= LogLevel.DEBUG) {
            this.log('DEBUG', message, data);
        }
    }

    info(message: string, ...data: any[]): void {
        if (Logger.globalLevel <= LogLevel.INFO) {
            this.log('INFO', message, data);
        }
    }

    warn(message: string, ...data: any[]): void {
        if (Logger.globalLevel <= LogLevel.WARN) {
            this.log('WARN', message, data);
        }
    }

    error(message: string, error?: any): void {
        if (Logger.globalLevel <= LogLevel.ERROR) {
            this.log('ERROR', message, error ? [error] : []);
        }
    }

    /**
     * Sanitize sensitive data before logging
     */
    public sanitize(data: any, visited: WeakSet<object> = new WeakSet()): any {
        if (typeof data === 'object' && data !== null && visited.has(data)) {
            return '[CIRCULAR REFERENCE]';
        }

        const SENSITIVE_KEYS = [
            'password', 'secret', 'token', 'apiKey', 'apiSecret',
            'authToken', 'privateKey', 'oauth2PrivateKey',
            'tlsKey', 'credential', 'credentials'
        ];

        if (typeof data === 'object' && data !== null) {
            visited.add(data);
            const sanitized = Array.isArray(data) ? [...data] : { ...data };

            for (const key of SENSITIVE_KEYS) {
                if (key in sanitized) {
                    sanitized[key] = '[REDACTED]';
                }
            }

            for (const key in sanitized) {
                if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
                    sanitized[key] = this.sanitize(sanitized[key], visited);
                }
            }

            return sanitized;
        }

        return data;
    }

    private log(level: string, message: string, data: any[]): void {
        if (this.isNoOp || !this.channel) {
            return;
        }

        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] [${level}] [${this.name}]`;

        try {
            this.channel.appendLine(`${prefix} ${message}`);

            if (data.length > 0) {
                data.forEach(item => {
                    if (item instanceof Error) {
                        this.channel!.appendLine(`  Error: ${item.message}`);
                        if (item.stack) {
                            const sanitizedStack = this.sanitize(item.stack);
                            this.channel!.appendLine(`  Stack: ${sanitizedStack}`);
                        }
                    } else if (typeof item === 'object') {
                        try {
                            const sanitizedItem = this.sanitize(item);
                            this.channel!.appendLine(`  Data: ${JSON.stringify(sanitizedItem, null, 2)}`);
                        } catch (_e) {
                            this.channel!.appendLine(`  Data: [Unable to stringify]`);
                        }
                    } else {
                        this.channel!.appendLine(`  ${item}`);
                    }
                });
            }
        } catch (error) {
            if (error instanceof Error && !error.message.includes('Channel has been closed')) {
                console.error(`Logger error for ${this.name}:`, error.message);
            }
        }
    }

    show(): void {
        if (this.channel) {
            this.channel.show();
        }
    }

    dispose(): void {
        if (this.channel) {
            this.channel.dispose();
        }
    }
}
