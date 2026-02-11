import * as vscode from 'vscode';
import { PulsarClientManager } from '../pulsar/pulsarClientManager';
import { PulsarExplorerProvider } from '../providers/pulsarExplorerProvider';
import { SubscriptionProvider } from '../providers/subscriptionProvider';
import { BrokerProvider } from '../providers/brokerProvider';
import { CredentialManager } from '../infrastructure/CredentialManager';
import { ErrorHandler } from '../infrastructure/ErrorHandler';
import { Logger } from '../infrastructure/Logger';
import { PulsarClusterConnection } from '../types/pulsar';

const logger = Logger.getLogger('ConfigCommands');

/**
 * Configuration export format
 */
export interface ExportedConfig {
    version: string;
    exportDate: string;
    clusters?: ExportedCluster[];
    manualNamespaces?: Record<string, string[]>;
    settings?: {
        logLevel?: string;
        connectionTimeout?: number;
        requestTimeout?: number;
        largeListThreshold?: number;
    };
}

/**
 * Exported cluster configuration
 */
export interface ExportedCluster {
    name: string;
    type: 'pulsar' | 'streamnative';
    webServiceUrl: string;
    serviceUrl?: string;
    authMethod: 'none' | 'token' | 'oauth2' | 'tls';
    authToken?: string;
    tlsAllowInsecure?: boolean;
}

/**
 * Export configuration options
 */
interface ExportOptions {
    includeClusters: boolean;
    includeManualNamespaces: boolean;
    includeSettings: boolean;
    includeSecrets: boolean;
    maskSecrets: boolean;
}

/**
 * Import merge strategy
 */
type MergeStrategy = 'overwrite' | 'append' | 'skip';

/**
 * Export configuration to a JSON file
 */
export async function exportConfiguration(
    clientManager: PulsarClientManager,
    credentialManager?: CredentialManager
): Promise<void> {
    try {
        // Ask what to export
        const exportItems = await vscode.window.showQuickPick(
            [
                { label: 'Cluster connections', value: 'clusters', picked: true },
                { label: 'Manual namespaces', value: 'manualNamespaces', picked: true },
                { label: 'Extension settings', value: 'settings', picked: true }
            ],
            {
                canPickMany: true,
                placeHolder: 'Select what to export',
                title: 'Export Configuration'
            }
        );

        if (!exportItems || exportItems.length === 0) {
            return;
        }

        const exportOptions: ExportOptions = {
            includeClusters: exportItems.some(item => item.value === 'clusters'),
            includeManualNamespaces: exportItems.some(item => item.value === 'manualNamespaces'),
            includeSettings: exportItems.some(item => item.value === 'settings'),
            includeSecrets: false,
            maskSecrets: false
        };

        // Ask about sensitive data handling if clusters are being exported
        if (exportOptions.includeClusters) {
            const secretsHandling = await vscode.window.showQuickPick(
                [
                    {
                        label: 'Exclude authentication tokens',
                        description: 'Recommended for sharing configurations',
                        value: 'exclude'
                    },
                    {
                        label: 'Mask authentication tokens',
                        description: 'Replace with ${PULSAR_TOKEN} placeholder',
                        value: 'mask'
                    },
                    {
                        label: 'Include authentication tokens',
                        description: 'Warning: Tokens will be visible in the file',
                        value: 'include'
                    }
                ],
                {
                    placeHolder: 'How should authentication tokens be handled?',
                    title: 'Sensitive Data Handling'
                }
            );

            if (!secretsHandling) {
                return;
            }

            exportOptions.includeSecrets = secretsHandling.value === 'include';
            exportOptions.maskSecrets = secretsHandling.value === 'mask';
        }

        // Build export data
        const exportData: ExportedConfig = {
            version: '1.0',
            exportDate: new Date().toISOString()
        };

        // Export clusters
        if (exportOptions.includeClusters) {
            exportData.clusters = [];
            const clusterNames = clientManager.getClusters();

            for (const clusterName of clusterNames) {
                const connection = clientManager.getClusterConnection(clusterName);
                if (connection) {
                    const exportedCluster: ExportedCluster = {
                        name: connection.name,
                        type: connection.type,
                        webServiceUrl: connection.webServiceUrl,
                        serviceUrl: connection.serviceUrl,
                        authMethod: connection.authMethod,
                        tlsAllowInsecure: connection.tlsAllowInsecure
                    };

                    // Handle authentication tokens
                    if (connection.authMethod === 'token') {
                        if (exportOptions.includeSecrets) {
                            // Get token from secure storage
                            if (credentialManager) {
                                const token = await credentialManager.getAuthToken(clusterName);
                                exportedCluster.authToken = token;
                            }
                        } else if (exportOptions.maskSecrets) {
                            exportedCluster.authToken = '${PULSAR_TOKEN}';
                        }
                        // Otherwise, leave authToken undefined (excluded)
                    }

                    exportData.clusters.push(exportedCluster);
                }
            }
        }

        // Export manual namespaces
        if (exportOptions.includeManualNamespaces) {
            const config = vscode.workspace.getConfiguration('pulsar');
            const manualNamespaces = config.get<Record<string, string[]>>('manualNamespaces', {});
            if (Object.keys(manualNamespaces).length > 0) {
                exportData.manualNamespaces = manualNamespaces;
            }
        }

        // Export settings
        if (exportOptions.includeSettings) {
            const config = vscode.workspace.getConfiguration('pulsar');
            exportData.settings = {
                logLevel: config.get<string>('logLevel'),
                connectionTimeout: config.get<number>('connectionTimeout'),
                requestTimeout: config.get<number>('requestTimeout'),
                largeListThreshold: config.get<number>('explorer.largeListThreshold')
            };
        }

        // Ask for export file location
        const fileUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('pulsar-config.json'),
            filters: {
                'JSON files': ['json']
            },
            saveLabel: 'Export Configuration'
        });

        if (!fileUri) {
            return;
        }

        // Write to file
        const content = JSON.stringify(exportData, null, 2);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));

        logger.info(`Configuration exported to: ${fileUri.fsPath}`);
        vscode.window.showInformationMessage(`Configuration exported successfully to ${fileUri.fsPath}`);
    } catch (error) {
        ErrorHandler.handle(error, 'Exporting configuration');
    }
}

/**
 * Import configuration from a JSON file
 */
export async function importConfiguration(
    clientManager: PulsarClientManager,
    explorerProvider: PulsarExplorerProvider,
    subscriptionProvider: SubscriptionProvider,
    brokerProvider: BrokerProvider,
    credentialManager?: CredentialManager
): Promise<void> {
    try {
        // Ask for import file location
        const fileUris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'JSON files': ['json']
            },
            openLabel: 'Import Configuration'
        });

        if (!fileUris || fileUris.length === 0) {
            return;
        }

        const fileUri = fileUris[0];

        // Read file
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const configText = Buffer.from(fileContent).toString('utf8');
        const importedConfig = JSON.parse(configText) as ExportedConfig;

        // Validate version
        if (!importedConfig.version || importedConfig.version !== '1.0') {
            throw new Error('Unsupported configuration file version');
        }

        // Show what will be imported
        const importSummary: string[] = [];
        if (importedConfig.clusters && importedConfig.clusters.length > 0) {
            importSummary.push(`${importedConfig.clusters.length} cluster(s)`);
        }
        if (importedConfig.manualNamespaces && Object.keys(importedConfig.manualNamespaces).length > 0) {
            importSummary.push(`Manual namespaces for ${Object.keys(importedConfig.manualNamespaces).length} cluster(s)`);
        }
        if (importedConfig.settings) {
            importSummary.push(`Extension settings`);
        }

        if (importSummary.length === 0) {
            vscode.window.showWarningMessage('Configuration file contains no data to import');
            return;
        }

        // Ask for merge strategy if there are existing clusters
        let mergeStrategy: MergeStrategy = 'append';
        if (importedConfig.clusters && importedConfig.clusters.length > 0 && clientManager.getClusters().length > 0) {
            const strategy = await vscode.window.showQuickPick(
                [
                    {
                        label: 'Append',
                        description: 'Add new clusters, skip existing ones',
                        value: 'append' as MergeStrategy
                    },
                    {
                        label: 'Overwrite',
                        description: 'Replace existing clusters with same name',
                        value: 'overwrite' as MergeStrategy
                    },
                    {
                        label: 'Skip existing',
                        description: 'Only add clusters that don\'t exist',
                        value: 'skip' as MergeStrategy
                    }
                ],
                {
                    placeHolder: 'How should existing clusters be handled?',
                    title: 'Import Strategy'
                }
            );

            if (!strategy) {
                return;
            }

            mergeStrategy = strategy.value;
        }

        // Confirm import
        const confirm = await vscode.window.showInformationMessage(
            `Import configuration?\n\nThis will import: ${importSummary.join(', ')}`,
            { modal: true },
            'Import'
        );

        if (confirm !== 'Import') {
            return;
        }

        let addedCount = 0;
        let skippedCount = 0;
        let updatedCount = 0;
        const errors: string[] = [];

        // Import clusters
        if (importedConfig.clusters) {
            for (const cluster of importedConfig.clusters) {
                const exists = clientManager.hasCluster(cluster.name);

                if (exists && mergeStrategy === 'skip') {
                    skippedCount++;
                    continue;
                }

                if (exists && mergeStrategy === 'append') {
                    skippedCount++;
                    continue;
                }

                try {
                    // Check for environment variable placeholders
                    let authToken = cluster.authToken;
                    if (authToken && authToken.startsWith('${') && authToken.endsWith('}')) {
                        const envVarName = authToken.substring(2, authToken.length - 1);
                        const envValue = process.env[envVarName];

                        if (!envValue) {
                            // Ask user for the token
                            const userToken = await vscode.window.showInputBox({
                                prompt: `Enter authentication token for cluster "${cluster.name}" (${envVarName})`,
                                password: true,
                                ignoreFocusOut: true,
                                validateInput: (value) => {
                                    if (!value || value.trim().length === 0) {
                                        return 'Token is required';
                                    }
                                    return undefined;
                                }
                            });

                            if (!userToken) {
                                errors.push(`Skipped cluster "${cluster.name}": Authentication token not provided`);
                                skippedCount++;
                                continue;
                            }
                            authToken = userToken;
                        } else {
                            authToken = envValue;
                        }
                    }

                    // If cluster exists and strategy is overwrite, remove it first
                    if (exists && mergeStrategy === 'overwrite') {
                        await clientManager.removeCluster(cluster.name);
                    }

                    // Store token in secure storage if provided
                    if (authToken && cluster.authMethod === 'token' && credentialManager) {
                        await credentialManager.storeAuthToken(cluster.name, authToken);
                    }

                    // Create connection
                    const connection: PulsarClusterConnection = {
                        name: cluster.name,
                        type: cluster.type,
                        webServiceUrl: cluster.webServiceUrl,
                        serviceUrl: cluster.serviceUrl,
                        authMethod: cluster.authMethod,
                        authToken: authToken,
                        tlsAllowInsecure: cluster.tlsAllowInsecure
                    };

                    // Add cluster
                    await clientManager.addCluster(connection);

                    if (exists && mergeStrategy === 'overwrite') {
                        updatedCount++;
                    } else {
                        addedCount++;
                    }
                } catch (error: any) {
                    errors.push(`Failed to import cluster "${cluster.name}": ${error.message}`);
                    logger.error(`Failed to import cluster "${cluster.name}"`, error);
                }
            }
        }

        // Import manual namespaces
        if (importedConfig.manualNamespaces) {
            const config = vscode.workspace.getConfiguration('pulsar');
            const existingNamespaces = config.get<Record<string, string[]>>('manualNamespaces', {});

            // Merge namespaces
            const mergedNamespaces = { ...existingNamespaces };
            for (const [clusterName, namespaces] of Object.entries(importedConfig.manualNamespaces)) {
                if (!mergedNamespaces[clusterName]) {
                    mergedNamespaces[clusterName] = [];
                }
                // Add namespaces that don't already exist
                for (const ns of namespaces) {
                    if (!mergedNamespaces[clusterName].includes(ns)) {
                        mergedNamespaces[clusterName].push(ns);
                    }
                }
            }

            await config.update('manualNamespaces', mergedNamespaces, vscode.ConfigurationTarget.Global);
        }

        // Import settings
        if (importedConfig.settings) {
            const config = vscode.workspace.getConfiguration('pulsar');

            if (importedConfig.settings.logLevel !== undefined) {
                await config.update('logLevel', importedConfig.settings.logLevel, vscode.ConfigurationTarget.Global);
            }
            if (importedConfig.settings.connectionTimeout !== undefined) {
                await config.update('connectionTimeout', importedConfig.settings.connectionTimeout, vscode.ConfigurationTarget.Global);
            }
            if (importedConfig.settings.requestTimeout !== undefined) {
                await config.update('requestTimeout', importedConfig.settings.requestTimeout, vscode.ConfigurationTarget.Global);
            }
            if (importedConfig.settings.largeListThreshold !== undefined) {
                await config.update('explorer.largeListThreshold', importedConfig.settings.largeListThreshold, vscode.ConfigurationTarget.Global);
            }
        }

        // Refresh views
        explorerProvider.refresh();
        subscriptionProvider.refresh();
        brokerProvider.refresh();

        // Show summary
        const summaryParts: string[] = [];
        if (addedCount > 0) summaryParts.push(`${addedCount} added`);
        if (updatedCount > 0) summaryParts.push(`${updatedCount} updated`);
        if (skippedCount > 0) summaryParts.push(`${skippedCount} skipped`);
        if (errors.length > 0) summaryParts.push(`${errors.length} failed`);

        let message = `Configuration imported successfully`;
        if (summaryParts.length > 0) {
            message += `: ${summaryParts.join(', ')}`;
        }

        if (errors.length > 0) {
            const viewErrors = 'View Errors';
            const result = await vscode.window.showWarningMessage(message, viewErrors);
            if (result === viewErrors) {
                const errorDoc = await vscode.workspace.openTextDocument({
                    content: errors.join('\n'),
                    language: 'plaintext'
                });
                await vscode.window.showTextDocument(errorDoc);
            }
        } else {
            vscode.window.showInformationMessage(message);
        }

        logger.info(`Configuration imported: ${summaryParts.join(', ')}`);
    } catch (error) {
        ErrorHandler.handle(error, 'Importing configuration');
    }
}
