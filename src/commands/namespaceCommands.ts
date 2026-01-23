import * as vscode from 'vscode';
import { PulsarClientManager } from '../pulsar/pulsarClientManager';
import { PulsarExplorerProvider } from '../providers/pulsarExplorerProvider';
import { ErrorHandler } from '../infrastructure/ErrorHandler';
import { TenantNode, NamespaceNode } from '../types/nodes';

/**
 * Create a new namespace
 */
export async function createNamespace(
    clientManager: PulsarClientManager,
    provider: PulsarExplorerProvider,
    node: TenantNode
): Promise<void> {
    try {
        // Get namespace name
        const namespaceName = await vscode.window.showInputBox({
            prompt: 'Enter namespace name',
            placeHolder: 'my-namespace',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Namespace name is required';
                }
                if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
                    return 'Namespace name can only contain letters, numbers, underscores, and hyphens';
                }
                return undefined;
            }
        });

        if (!namespaceName) {
            return;
        }

        // Create namespace with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Creating namespace ${namespaceName}...`,
                cancellable: false
            },
            async () => {
                await clientManager.createNamespace(node.clusterName, node.tenant!, namespaceName.trim());
            }
        );

        provider.refresh();

        vscode.window.showInformationMessage(`Namespace "${namespaceName}" created successfully!`);
    } catch (error) {
        ErrorHandler.handle(error, 'Creating namespace');
    }
}

/**
 * Delete a namespace
 */
export async function deleteNamespace(
    clientManager: PulsarClientManager,
    provider: PulsarExplorerProvider,
    node: NamespaceNode
): Promise<void> {
    try {
        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete namespace "${node.namespace}"?\n\nThis will fail if the namespace has any topics.`,
            { modal: true },
            'Delete'
        );

        if (confirm !== 'Delete') {
            return;
        }

        // Delete namespace with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Deleting namespace ${node.namespace}...`,
                cancellable: false
            },
            async () => {
                await clientManager.deleteNamespace(node.clusterName, node.tenant!, node.namespace!, false);
            }
        );

        provider.refresh();

        vscode.window.showInformationMessage(`Namespace "${node.namespace}" deleted.`);
    } catch (error) {
        ErrorHandler.handle(error, 'Deleting namespace');
    }
}

/**
 * Add a namespace manually (for service accounts with limited permissions)
 */
export async function addNamespace(
    clientManager: PulsarClientManager,
    provider: PulsarExplorerProvider,
    clusterName: string
): Promise<void> {
    try {
        // Get namespace path
        const namespacePath = await vscode.window.showInputBox({
            prompt: 'Enter namespace path (tenant/namespace)',
            placeHolder: 'my-tenant/my-namespace',
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Namespace path is required';
                }
                const parts = value.trim().split('/');
                if (parts.length !== 2) {
                    return 'Namespace path must be in format: tenant/namespace';
                }
                if (!parts[0] || !parts[1]) {
                    return 'Both tenant and namespace are required';
                }
                return undefined;
            }
        });

        if (!namespacePath) {
            return;
        }

        // Validate that we can access this namespace
        const [tenant, namespace] = namespacePath.trim().split('/');

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Verifying access to ${namespacePath}...`,
                cancellable: false
            },
            async () => {
                // Try to access the namespace - get topics to verify we have access
                try {
                    await clientManager.getTopics(clusterName, tenant, namespace);
                } catch (error: any) {
                    // 404 is ok - namespace might be empty but accessible
                    // 401/403 means no access
                    if (error?.status === 401 || error?.status === 403 || error?.statusCode === 401 || error?.statusCode === 403) {
                        throw new Error(`No access to namespace "${namespacePath}". Check your service account permissions.`);
                    }
                    // Other errors (like 404) might just mean empty namespace, so we continue
                }

                // Add the namespace to manual list
                await clientManager.addManualNamespace(clusterName, namespacePath.trim());
            }
        );

        provider.refresh();

        vscode.window.showInformationMessage(`Namespace "${namespacePath}" added to ${clusterName}.`);
    } catch (error) {
        ErrorHandler.handle(error, 'Adding namespace');
    }
}
