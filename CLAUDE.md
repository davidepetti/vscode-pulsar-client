# CLAUDE.md

## Project Overview

VS Code extension for Apache Pulsar cluster management. Provides tree views for clusters/tenants/namespaces/topics/subscriptions/brokers, webview panels for dashboards and message produce/consume, and CRUD commands for all Pulsar resources. Uses the Pulsar Admin REST API and WebSocket API. Single runtime dependency: `ws`.

## Architecture

```
src/
  extension.ts              -- Entry point: activate/deactivate, registers all commands and providers
  commands/                 -- Command handlers, one file per resource domain
    clusterCommands.ts      -- Add/remove/refresh/test cluster connections
    tenantCommands.ts       -- Create/delete tenants
    namespaceCommands.ts    -- Create/delete/add namespaces
    topicCommands.ts        -- Create/delete/find topics, show topic details
    subscriptionCommands.ts -- Create/delete/reset subscriptions, peek messages
  infrastructure/           -- Cross-cutting concerns
    CredentialManager.ts    -- Secure storage via VS Code SecretStorage API
    ErrorHandler.ts         -- Centralized error handling with user-facing messages
    EventBus.ts             -- Pub/sub event system (PulsarEvents constants)
    Logger.ts               -- Singleton logger per component with output channels
  providers/                -- Tree data providers for VS Code tree views
    BaseProvider.ts         -- Abstract base with refresh, error/loading items
    pulsarExplorerProvider.ts -- Main tree: clusters > tenants > namespaces > topics
    subscriptionProvider.ts -- Flat subscription view across clusters
    brokerProvider.ts       -- Broker list view per cluster
  pulsar/                   -- Pulsar client layer
    pulsarAdminClient.ts    -- HTTP client wrapping Pulsar Admin REST API
    pulsarClientManager.ts  -- Central manager: cluster configs, delegates to admin clients
  types/
    nodes.ts                -- Tree item classes (ClusterNode, TopicNode, etc.)
    pulsar.ts               -- Pulsar domain interfaces (connections, stats, messages)
  views/                    -- Webview panels (singleton pattern)
    TopicDetailsWebview.ts
    ClusterDashboardWebview.ts
    BrokerDetailsWebview.ts
    MessageProducerWebview.ts
    MessageConsumerWebview.ts
```

## Key Patterns

- **Singleton webviews**: All webviews use `static getInstance()` pattern
- **BaseProvider**: All tree providers extend `BaseProvider<PulsarTreeItem>`
- **Command functions**: Exported as standalone async functions (not classes). They receive `clientManager`, `provider(s)`, and optionally a tree `node`
- **Error handling**: `ErrorHandler.handle(error, context)` for user-facing errors, `ErrorHandler.handleSilently()` for logging only
- **Logging**: `Logger.getLogger('ComponentName')` creates singleton with VS Code output channel
- **Admin client**: `PulsarAdminClient` wraps fetch() with auth headers and AbortController timeouts

## Build Commands

- `npm run compile` -- TypeScript compilation (type checking)
- `npm run bundle` -- Production esbuild bundle to `dist/extension.js`
- `npm run lint` -- **Currently broken** (needs eslint.config.js migration, do not run)
- `npm run package` -- Create .vsix package

## Code Conventions

- PascalCase for classes/interfaces, camelCase for functions/variables
- File naming: PascalCase for class files, camelCase for function modules
- VS Code API imported as `import * as vscode from 'vscode'`
- Internal imports use relative paths
- All Pulsar API calls are async, use `vscode.window.withProgress()` for long operations
- Template literals for strings, no concatenation
- Strict TypeScript mode enabled

## Adding New Features

### New Command
1. Add to or create file in `src/commands/`
2. Export async function taking `clientManager`, relevant providers, optional tree node
3. Register in `src/extension.ts` with `vscode.commands.registerCommand()`
4. Add to `package.json` under `contributes.commands` and `contributes.menus`

### New Tree Provider
1. Create in `src/providers/` extending `BaseProvider<PulsarTreeItem>`
2. Implement `getChildren()` switching on `element.contextValue`
3. Register with `vscode.window.createTreeView()` in `extension.ts`
4. Add view to `package.json` under `contributes.views`

### New Webview
1. Create in `src/views/` with singleton pattern (see `TopicDetailsWebview.ts`)
2. Use `vscode.window.createWebviewPanel()` with `enableScripts: true`
3. Style with VS Code CSS variables (`--vscode-*`)

## Important Files

- `package.json` -- Extension manifest (commands, views, menus, keybindings, configuration)
- `src/extension.ts` -- Activation entry point, wires everything together
- `src/pulsar/pulsarAdminClient.ts` -- All Pulsar REST API calls
- `src/pulsar/pulsarClientManager.ts` -- Central connection/operation manager
- `src/types/nodes.ts` -- All tree node types
- `src/types/pulsar.ts` -- All Pulsar domain types/interfaces
