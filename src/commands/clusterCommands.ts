import * as vscode from 'vscode';
import { PulsarClientManager } from '../pulsar/pulsarClientManager';
import { PulsarExplorerProvider } from '../providers/pulsarExplorerProvider';
import { SubscriptionProvider } from '../providers/subscriptionProvider';
import { BrokerProvider } from '../providers/brokerProvider';
import { CredentialManager } from '../infrastructure/CredentialManager';
import { ErrorHandler } from '../infrastructure/ErrorHandler';
import { PulsarClusterConnection } from '../types/pulsar';
import { ClusterNode } from '../types/nodes';

/**
 * Add a new Pulsar cluster
 */
export async function addCluster(
    clientManager: PulsarClientManager,
    explorerProvider: PulsarExplorerProvider,
    subscriptionProvider: SubscriptionProvider,
    brokerProvider: BrokerProvider,
    credentialManager?: CredentialManager
): Promise<void> {
    try {
        // Get cluster name
        const name = await vscode.window.showInputBox({
            prompt: 'Enter a name for this cluster',
            placeHolder: 'my-pulsar-cluster',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Cluster name is required';
                }
                if (clientManager.hasCluster(value)) {
                    return 'A cluster with this name already exists';
                }
                return undefined;
            }
        });

        if (!name) {
            return;
        }

        // Get web service URL
        const webServiceUrl = await vscode.window.showInputBox({
            prompt: 'Enter the Pulsar web service URL',
            placeHolder: 'http://localhost:8080',
            value: 'http://localhost:8080',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Web service URL is required';
                }
                try {
                    new URL(value);
                    return undefined;
                } catch {
                    return 'Invalid URL format';
                }
            }
        });

        if (!webServiceUrl) {
            return;
        }

        // Ask for authentication method
        const authMethod = await vscode.window.showQuickPick(
            [
                { label: 'None', description: 'No authentication (local development)', value: 'none' as const },
                { label: 'Token', description: 'JWT token authentication (StreamNative, production clusters)', value: 'token' as const }
            ],
            {
                placeHolder: 'Select authentication method',
                title: 'Authentication'
            }
        );

        if (!authMethod) {
            return;
        }

        let authToken: string | undefined;

        if (authMethod.value === 'token') {
            authToken = await vscode.window.showInputBox({
                prompt: 'Enter the JWT token',
                password: true,
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Token is required';
                    }
                    return undefined;
                }
            });

            if (!authToken) {
                return;
            }

            // Store token securely
            if (credentialManager) {
                await credentialManager.storeAuthToken(name, authToken);
            }
        }

        // Create connection
        const connection: PulsarClusterConnection = {
            name: name.trim(),
            type: 'pulsar',
            webServiceUrl: webServiceUrl.trim(),
            authMethod: authMethod.value,
            authToken: authMethod.value === 'token' ? authToken : undefined
        };

        // Add cluster with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Connecting to ${name}...`,
                cancellable: false
            },
            async () => {
                await clientManager.addCluster(connection);
            }
        );

        // Refresh views
        explorerProvider.refresh();
        subscriptionProvider.refresh();
        brokerProvider.refresh();

        vscode.window.showInformationMessage(`Cluster "${name}" connected successfully!`);
    } catch (error) {
        ErrorHandler.handle(error, 'Adding cluster');
    }
}

/**
 * Remove a Pulsar cluster
 */
export async function removeCluster(
    clientManager: PulsarClientManager,
    explorerProvider: PulsarExplorerProvider,
    subscriptionProvider: SubscriptionProvider,
    brokerProvider: BrokerProvider,
    node: ClusterNode
): Promise<void> {
    try {
        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to remove cluster "${node.clusterName}"?`,
            { modal: true },
            'Remove'
        );

        if (confirm !== 'Remove') {
            return;
        }

        await clientManager.removeCluster(node.clusterName);

        // Refresh views
        explorerProvider.refresh();
        subscriptionProvider.refresh();
        brokerProvider.refresh();

        vscode.window.showInformationMessage(`Cluster "${node.clusterName}" removed.`);
    } catch (error) {
        ErrorHandler.handle(error, 'Removing cluster');
    }
}

/**
 * Refresh all cluster views
 */
export function refreshCluster(
    explorerProvider: PulsarExplorerProvider,
    subscriptionProvider: SubscriptionProvider,
    brokerProvider: BrokerProvider
): void {
    explorerProvider.refresh();
    subscriptionProvider.refresh();
    brokerProvider.refresh();
}

/**
 * Test connection to a cluster
 */
export async function testConnection(
    clientManager: PulsarClientManager,
    node?: ClusterNode
): Promise<void> {
    try {
        let clusterName: string | undefined;

        if (node) {
            clusterName = node.clusterName;
        } else {
            // Let user select a cluster
            const clusters = clientManager.getClusters();
            if (clusters.length === 0) {
                vscode.window.showInformationMessage('No clusters configured. Add a cluster first.');
                return;
            }
            const selected = await vscode.window.showQuickPick(clusters, {
                placeHolder: 'Select a cluster to test'
            });
            if (!selected) {
                return;
            }
            clusterName = selected;
        }

        const result = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Testing connection to ${clusterName}...`,
                cancellable: false
            },
            async () => {
                try {
                    // Try to get tenants as a connectivity test
                    const tenants = await clientManager.getTenants(clusterName!);
                    return { success: true, tenants: tenants.length };
                } catch (error: any) {
                    return { success: false, error: error.message };
                }
            }
        );

        if (result.success) {
            vscode.window.showInformationMessage(
                `✓ Connection to "${clusterName}" successful! Found ${result.tenants} tenant(s).`
            );
        } else {
            vscode.window.showErrorMessage(
                `✗ Connection to "${clusterName}" failed: ${result.error}`
            );
        }
    } catch (error) {
        ErrorHandler.handle(error, 'Testing connection');
    }
}
