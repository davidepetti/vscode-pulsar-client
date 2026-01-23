import * as vscode from 'vscode';
import { Logger } from './Logger';

export interface StoredCredentials {
    authToken?: string;
    oauth2PrivateKey?: string;
    oauth2ClientId?: string;
    oauth2ClientSecret?: string;
    tlsKeyPassword?: string;
}

/**
 * Manages secure storage of credentials using VSCode's SecretStorage API
 */
export class CredentialManager {
    private logger = Logger.getLogger('CredentialManager');

    constructor(private secrets: vscode.SecretStorage) {}

    /**
     * Store credentials for a cluster securely
     */
    async storeCredentials(clusterId: string, credentials: StoredCredentials): Promise<void> {
        try {
            const key = this.getKey(clusterId);
            const serialized = JSON.stringify(credentials);
            await this.secrets.store(key, serialized);
            this.logger.debug(`Stored credentials for cluster: ${clusterId}`);
        } catch (error) {
            this.logger.error(`Failed to store credentials for cluster: ${clusterId}`, error);
            throw new Error('Failed to store credentials securely');
        }
    }

    /**
     * Retrieve credentials for a cluster
     */
    async getCredentials(clusterId: string): Promise<StoredCredentials | undefined> {
        try {
            const key = this.getKey(clusterId);
            const serialized = await this.secrets.get(key);

            if (!serialized) {
                this.logger.debug(`No credentials found for cluster: ${clusterId}`);
                return undefined;
            }

            const credentials = JSON.parse(serialized) as StoredCredentials;
            this.logger.debug(`Retrieved credentials for cluster: ${clusterId}`);
            return credentials;
        } catch (error) {
            this.logger.error(`Failed to retrieve credentials for cluster: ${clusterId}`, error);
            return undefined;
        }
    }

    /**
     * Delete credentials for a cluster
     */
    async deleteCredentials(clusterId: string): Promise<void> {
        try {
            const key = this.getKey(clusterId);
            await this.secrets.delete(key);
            this.logger.debug(`Deleted credentials for cluster: ${clusterId}`);
        } catch (error) {
            this.logger.error(`Failed to delete credentials for cluster: ${clusterId}`, error);
            throw new Error('Failed to delete credentials');
        }
    }

    /**
     * Store auth token for a cluster
     */
    async storeAuthToken(clusterId: string, token: string): Promise<void> {
        const existing = await this.getCredentials(clusterId) || {};
        existing.authToken = token;
        await this.storeCredentials(clusterId, existing);
    }

    /**
     * Get auth token for a cluster
     */
    async getAuthToken(clusterId: string): Promise<string | undefined> {
        const credentials = await this.getCredentials(clusterId);
        return credentials?.authToken;
    }

    /**
     * Store OAuth2 credentials for StreamNative Cloud
     */
    async storeOAuth2Credentials(
        clusterId: string,
        privateKey: string,
        clientId?: string,
        clientSecret?: string
    ): Promise<void> {
        const existing = await this.getCredentials(clusterId) || {};
        existing.oauth2PrivateKey = privateKey;
        if (clientId) existing.oauth2ClientId = clientId;
        if (clientSecret) existing.oauth2ClientSecret = clientSecret;
        await this.storeCredentials(clusterId, existing);
    }

    /**
     * Get OAuth2 credentials
     */
    async getOAuth2Credentials(clusterId: string): Promise<{
        privateKey?: string;
        clientId?: string;
        clientSecret?: string;
    }> {
        const credentials = await this.getCredentials(clusterId);
        return {
            privateKey: credentials?.oauth2PrivateKey,
            clientId: credentials?.oauth2ClientId,
            clientSecret: credentials?.oauth2ClientSecret
        };
    }

    /**
     * Check if credentials exist for a cluster
     */
    async hasCredentials(clusterId: string): Promise<boolean> {
        const credentials = await this.getCredentials(clusterId);
        return credentials !== undefined && Object.keys(credentials).length > 0;
    }

    /**
     * Generate storage key for a cluster
     */
    private getKey(clusterId: string): string {
        return `pulsar.cluster.${clusterId}.credentials`;
    }

    /**
     * Clear all stored credentials (for cleanup/testing)
     */
    async clearAll(clusterIds: string[]): Promise<void> {
        this.logger.info(`Clearing credentials for ${clusterIds.length} clusters`);

        for (const clusterId of clusterIds) {
            try {
                await this.deleteCredentials(clusterId);
            } catch (error) {
                this.logger.error(`Failed to clear credentials for ${clusterId}`, error);
            }
        }
    }
}
