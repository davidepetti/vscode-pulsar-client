# Changelog

All notable changes to the Pulsar Client for VSCode extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Message key filtering in Message Consumer
  - Filter messages by key with exact match or regex pattern
  - Visual highlighting of messages that match the filter
  - Auto-stop option to disconnect once a matching message is found

## [0.1.8] - 2026-01-23

### Fixed
- Subscription details now work correctly for partitioned topics

## [0.1.7] - 2026-01-23

### Fixed
- Subscriptions view now shows subscriptions for partitioned topics

## [0.1.6] - 2026-01-23

### Fixed
- Topic stats now work correctly for partitioned topics
- Error logging no longer automatically opens the output panel

## [0.1.5] - 2026-01-23

### Changed
- Internal cleanup

## [0.1.4] - 2026-01-23

### Removed
- Removed experimental JWT token tenant discovery (unreliable)

## [0.1.3] - 2026-01-23

### Added
- Manual namespace entry for service accounts without LIST_TENANTS permission
- When tenants cannot be listed, an "Add Namespace..." action appears to manually specify accessible namespaces

## [0.1.2] - 2026-01-23

### Fixed
- StreamNative Cloud connections now work with limited permissions (non-admin service accounts)
- Token input now allows global keyboard shortcuts to work

## [0.1.1] - 2026-01-23

### Fixed
- Input dialogs no longer close when switching windows (allows copying token from browser)
- Improved error messages when connection to cluster fails

## [0.1.0] - 2026-01-22

### Added
- Initial release of Pulsar Client for VSCode
- **Cluster Management**
  - Add and remove Pulsar cluster connections
  - Token-based authentication support
  - Persistent cluster configuration
- **Explorer View**
  - Hierarchical tree view: Clusters → Tenants → Namespaces → Topics
  - Subscriptions view
  - Brokers view
- **Tenant Operations**
  - Create and delete tenants
- **Namespace Operations**
  - Create and delete namespaces
- **Topic Operations**
  - Create topics (partitioned and non-partitioned)
  - Delete topics
  - Topic Details WebView with real-time statistics
  - Copy topic name to clipboard
- **Message Producer**
  - WebSocket-based message production
  - Message key support
  - Custom properties support
  - Send confirmation with message ID
- **Message Consumer**
  - WebSocket-based message consumption
  - Latest/Earliest position selection
  - Real-time message display
  - JSON formatting
  - Automatic message acknowledgment
- **Subscription Management**
  - Create and delete subscriptions
  - Reset subscription position
  - View subscription details and backlog

### Technical Details
- Uses Pulsar Admin REST API for all admin operations
- Uses Pulsar WebSocket API for produce/consume
- No native dependencies required
