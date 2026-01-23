import * as vscode from 'vscode';
import { PulsarClientManager } from '../pulsar/pulsarClientManager';
import { PulsarExplorerProvider } from '../providers/pulsarExplorerProvider';
import { ErrorHandler } from '../infrastructure/ErrorHandler';
import { ClusterNode, TenantNode } from '../types/nodes';

/**
 * Create a new tenant
 */
export async function createTenant(
    clientManager: PulsarClientManager,
    provider: PulsarExplorerProvider,
    node: ClusterNode
): Promise<void> {
    try {
        // Get tenant name
        const tenantName = await vscode.window.showInputBox({
            prompt: 'Enter tenant name',
            placeHolder: 'my-tenant',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Tenant name is required';
                }
                if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
                    return 'Tenant name can only contain letters, numbers, underscores, and hyphens';
                }
                return undefined;
            }
        });

        if (!tenantName) {
            return;
        }

        // Create tenant with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Creating tenant ${tenantName}...`,
                cancellable: false
            },
            async () => {
                await clientManager.createTenant(node.clusterName, tenantName.trim());
            }
        );

        provider.refresh();

        vscode.window.showInformationMessage(`Tenant "${tenantName}" created successfully!`);
    } catch (error) {
        ErrorHandler.handle(error, 'Creating tenant');
    }
}

/**
 * Delete a tenant
 */
export async function deleteTenant(
    clientManager: PulsarClientManager,
    provider: PulsarExplorerProvider,
    node: TenantNode
): Promise<void> {
    try {
        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete tenant "${node.tenant}"?\n\nThis will fail if the tenant has any namespaces.`,
            { modal: true },
            'Delete'
        );

        if (confirm !== 'Delete') {
            return;
        }

        // Delete tenant with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Deleting tenant ${node.tenant}...`,
                cancellable: false
            },
            async () => {
                await clientManager.deleteTenant(node.clusterName, node.tenant!);
            }
        );

        provider.refresh();

        vscode.window.showInformationMessage(`Tenant "${node.tenant}" deleted.`);
    } catch (error) {
        ErrorHandler.handle(error, 'Deleting tenant');
    }
}
