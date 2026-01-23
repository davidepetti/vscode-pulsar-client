# Pulsar Client for VSCode

A Visual Studio Code extension for Apache Pulsar, providing cluster management, message production/consumption, and topic monitoring capabilities.

## Features

### Cluster Management
- Add and remove Pulsar cluster connections
- Support for local, remote, and cloud clusters
- Token-based authentication (JWT) for StreamNative Cloud and secured clusters
- Secure credential storage using system keychain

### Explorer View
Navigate your Pulsar infrastructure with an intuitive tree view:
- **Clusters** → **Tenants** → **Namespaces** → **Topics**
- View subscriptions and their details
- Monitor broker information

### Topic Operations
- Create and delete topics (partitioned and non-partitioned)
- View topic statistics and details
- Real-time dashboard with auto-refresh
- Copy topic names to clipboard

### Message Producer
- Produce messages via WebSocket
- Support for message keys
- Custom properties
- Real-time send confirmation

### Message Consumer
- Consume messages in real-time via WebSocket
- Choose starting position (Latest or Earliest)
- JSON message formatting
- Message acknowledgment

### Subscription Management
- Create and delete subscriptions
- Reset subscription position
- View subscription details and backlog

## Installation

### From VSIX
1. Download the `.vsix` file
2. In VSCode, go to Extensions → `...` menu → "Install from VSIX..."
3. Select the downloaded file

### From Source
```bash
git clone https://github.com/davidepetti/vscode-pulsar-client.git
cd vscode-pulsar-client
npm install
npm run bundle
```

## Usage

### Adding a Local Cluster

1. Click the `+` button in the Pulsar Clusters view
2. Enter a name for your cluster (e.g., `local`)
3. Enter the Web Service URL: `http://localhost:8080`
4. Select "None" for authentication

### Adding StreamNative Cloud

1. Click the `+` button in the Pulsar Clusters view
2. Enter a name for your cluster (e.g., `streamnative-prod`)
3. Enter your StreamNative Web Service URL (e.g., `https://your-instance.streamnative.cloud:443`)
4. Select "Token" for authentication
5. Paste your JWT token from the StreamNative Cloud console

To get your token from StreamNative:
1. Log in to the [StreamNative Cloud Console](https://console.streamnative.cloud)
2. Navigate to your cluster → Service Accounts
3. Create or select a service account
4. Generate a new token and copy it

### Producing Messages

1. Right-click on a topic in the explorer
2. Select "Produce Message"
3. Enter your message payload (JSON or text)
4. Optionally add a message key and properties
5. Click "Send Message"

### Consuming Messages

1. Right-click on a topic in the explorer
2. Select "Consume Messages"
3. Enter a subscription name
4. Select starting position:
   - **Latest**: Only receive new messages
   - **Earliest**: Receive all messages from the beginning
5. Click "Start Consuming"

### Viewing Topic Details

1. Right-click on a topic
2. Select "Topic Details" or "Topic Dashboard"
3. View real-time statistics including:
   - Producer/Subscription counts
   - Message rates
   - Storage size
   - Backlog information

## Requirements

- Visual Studio Code 1.90.0 or higher
- Apache Pulsar cluster (standalone or distributed)

## Configuration

The extension contributes the following settings:

| Setting | Description | Default |
|---------|-------------|---------|
| `pulsar.logLevel` | Log level (info/debug) | `info` |
| `pulsar.requestTimeout` | API request timeout in ms | `60000` |
| `pulsar.clusters` | Saved cluster configurations | `[]` |

## Running Pulsar Locally

For testing, you can run a Pulsar standalone instance:

```bash
docker run -it -p 6650:6650 -p 8080:8080 apachepulsar/pulsar:latest bin/pulsar standalone
```

## Commands

| Command | Description |
|---------|-------------|
| `Pulsar: Add Cluster` | Add a new cluster connection |
| `Pulsar: Refresh` | Refresh all views |
| `Pulsar: Find Topic` | Search for a topic |
| `Pulsar: Find Subscription` | Search for a subscription |

## Known Issues

- WebSocket connections may timeout after extended periods of inactivity
- Some Pulsar admin endpoints may require additional permissions

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- Inspired by the [Kafka Client for VSCode](https://github.com/jlandersen/vscode-kafka)
- Built for the Apache Pulsar community
