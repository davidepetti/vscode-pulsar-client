import * as vscode from 'vscode';
import { Logger } from './Logger';

export class ErrorHandler {
    private static logger = Logger.getLogger('ErrorHandler');

    /**
     * Handle an error with appropriate user feedback
     */
    static handle(error: any, context: string): void {
        const message = this.formatError(error, context);
        this.logger.error(`${context}: ${error?.message || error}`, error);

        if (this.isAuthenticationError(error)) {
            vscode.window.showErrorMessage(
                message,
                'Check Credentials',
                'Show Logs'
            )?.then(action => {
                if (action === 'Show Logs') {
                    this.logger.show();
                }
            });
        } else if (this.isNetworkError(error)) {
            vscode.window.showErrorMessage(
                message,
                'Retry',
                'Check Connection',
                'Show Logs'
            )?.then(action => {
                if (action === 'Show Logs') {
                    this.logger.show();
                }
            });
        } else if (this.isAuthorizationError(error)) {
            vscode.window.showErrorMessage(
                message,
                'Learn About Pulsar Permissions',
                'Show Logs'
            )?.then(action => {
                if (action === 'Learn About Pulsar Permissions') {
                    vscode.env.openExternal(vscode.Uri.parse('https://pulsar.apache.org/docs/security-authorization/'));
                } else if (action === 'Show Logs') {
                    this.logger.show();
                }
            });
        } else {
            vscode.window.showErrorMessage(message, 'Show Logs')?.then(action => {
                if (action === 'Show Logs') {
                    this.logger.show();
                }
            });
        }
    }

    /**
     * Wrap an async function with error handling
     */
    static async wrap<T>(
        fn: () => Promise<T>,
        context: string
    ): Promise<T | undefined> {
        try {
            return await fn();
        } catch (error) {
            this.handle(error, context);
            return undefined;
        }
    }

    /**
     * Wrap an async function with error handling and return a default value on error
     */
    static async wrapWithDefault<T>(
        fn: () => Promise<T>,
        context: string,
        defaultValue: T
    ): Promise<T> {
        try {
            return await fn();
        } catch (error) {
            this.handle(error, context);
            return defaultValue;
        }
    }

    /**
     * Format error message for display
     */
    private static formatError(error: any, context: string): string {
        const errorMsg = error?.message || error?.toString() || 'Unknown error';

        if (this.isAuthenticationError(error)) {
            return `Authentication error in ${context}: ${this.simplifyAuthError(errorMsg)}`;
        } else if (this.isAuthorizationError(error)) {
            return `Authorization error in ${context}: ${this.simplifyAuthorizationError(errorMsg)}`;
        } else if (this.isNetworkError(error)) {
            return `Network error in ${context}: ${this.simplifyNetworkError(errorMsg)}`;
        } else if (this.isPulsarError(error)) {
            return `Pulsar error in ${context}: ${this.simplifyPulsarError(errorMsg)}`;
        }

        return `Error in ${context}: ${errorMsg}`;
    }

    /**
     * Check if error is authentication-related
     */
    static isAuthenticationError(error: any): boolean {
        const msg = error?.message?.toLowerCase() || '';
        const status = error?.status || error?.statusCode;
        return status === 401 ||
               msg.includes('authentication') ||
               msg.includes('unauthenticated') ||
               msg.includes('invalid token') ||
               msg.includes('token expired');
    }

    /**
     * Check if error is authorization-related
     */
    static isAuthorizationError(error: any): boolean {
        const msg = error?.message?.toLowerCase() || '';
        const status = error?.status || error?.statusCode;
        return status === 403 ||
               msg.includes('authorization') ||
               msg.includes('not authorized') ||
               msg.includes('permission denied') ||
               msg.includes('forbidden');
    }

    /**
     * Check if error is network-related
     */
    private static isNetworkError(error: any): boolean {
        const msg = error?.message?.toLowerCase() || '';
        return msg.includes('econnrefused') ||
               msg.includes('enotfound') ||
               msg.includes('timeout') ||
               msg.includes('network') ||
               msg.includes('connection');
    }

    /**
     * Check if error is Pulsar-specific
     */
    private static isPulsarError(error: any): boolean {
        const msg = error?.message?.toLowerCase() || '';
        return msg.includes('broker') ||
               msg.includes('topic') ||
               msg.includes('namespace') ||
               msg.includes('tenant') ||
               msg.includes('subscription') ||
               msg.includes('pulsar');
    }

    /**
     * Simplify authentication error messages
     */
    private static simplifyAuthError(msg: string): string {
        if (msg.includes('expired') || msg.includes('Token expired')) {
            return 'Authentication token has expired. Please refresh your credentials.';
        }
        if (msg.includes('invalid token')) {
            return 'Invalid authentication token. Please check your credentials.';
        }
        return msg;
    }

    /**
     * Simplify authorization error messages
     */
    private static simplifyAuthorizationError(msg: string): string {
        if (msg.includes('permission denied')) {
            return 'Permission denied. Check that you have the necessary permissions.';
        }
        if (msg.includes('not authorized')) {
            return 'Not authorized to perform this operation. Check your role permissions.';
        }
        return msg;
    }

    /**
     * Simplify network error messages
     */
    private static simplifyNetworkError(msg: string): string {
        if (msg.includes('ECONNREFUSED')) {
            return 'Connection refused. Check that Pulsar is running and accessible.';
        }
        if (msg.includes('ENOTFOUND')) {
            return 'Host not found. Check the service URL.';
        }
        if (msg.includes('timeout')) {
            return 'Operation timed out. Check network connectivity and broker availability.';
        }
        return msg;
    }

    /**
     * Simplify Pulsar error messages
     */
    private static simplifyPulsarError(msg: string): string {
        if (msg.includes('topic not found') || msg.includes('404')) {
            return 'Topic not found.';
        }
        if (msg.includes('namespace not found')) {
            return 'Namespace not found.';
        }
        if (msg.includes('tenant not found')) {
            return 'Tenant not found.';
        }
        if (msg.includes('already exists') || msg.includes('409')) {
            return 'Resource already exists.';
        }
        return msg;
    }

    /**
     * Handle error silently (only log, no UI)
     */
    static handleSilently(error: any, context: string): void {
        this.logger.error(`${context}: ${error?.message || error}`, error);
    }

    /**
     * Show warning (less severe than error)
     */
    static warn(message: string, context: string): void {
        this.logger.warn(`${context}: ${message}`);
        vscode.window.showWarningMessage(`${context}: ${message}`);
    }
}
