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
