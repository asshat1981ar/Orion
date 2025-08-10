# Orion A2A Platform

🚀 **Autonomous AI Agent Orchestration System**

A comprehensive platform for multi-agent coordination, featuring advanced real-time communication, knowledge graph management, and semantic memory compression.

## Key Features

- **Multi-Agent Orchestration**: Proven A2A communication protocols
- **Real-time WebSocket Communication**: Enhanced with metrics and agent-specific messaging
- **Knowledge Graph**: Neo4j-based semantic knowledge management  
- **Semantic Memory**: Redis-powered vector storage with compression
- **MCP Registry**: Model Context Protocol service discovery
- **Ghost Graph Sidecar**: State tracking for disappeared knowledge nodes
- **Agent Auto-Forge**: 2-second agent creation capability

## Enhanced Components

### WebSocket Communication (`frontend/src/hooks/useSocket.ts`)
Advanced real-time system with:
- Comprehensive metrics tracking and connection status monitoring
- Agent-specific communication protocols with message history
- Reconnection handling and heartbeat functionality
- Specialized hooks for agent communication

### Collaboration Demo (`collaboration-simple-demo.js`)
Realistic agent simulation with:
- Multi-agent workflow orchestration with parallel execution
- Performance metrics and insight generation
- Dependency management and resource optimization

## Quick Start

```bash
npm run setup    # Initialize platform
npm start        # Start all services
npm run health   # Check service status
```

## Architecture

```
orion/
├── backend/              # Main orchestrator service
├── frontend/             # React dashboard  
├── mcp-registry/         # MCP service registry
├── ghost-graph/          # Knowledge state tracking
├── agent-forge/          # Dynamic agent creation
└── mcp-servers/          # MCP server implementations
```

## Development

- **Dashboard**: http://localhost:3000
- **API**: http://localhost:3001  
- **Neo4j**: http://localhost:7474
- **MCP Registry**: http://localhost:4000

Built with TypeScript, Docker, Neo4j, and Redis.