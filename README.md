<h1 align="center">
    <a href="https://index.network/#gh-light-mode-only">
    <img style="width:400px" src="https://index.network/logo-black.svg">
    </a>
    <a href="https://index.network/#gh-dark-mode-only">
    <img style="width:400px" src="https://index.network/logo.svg">
    </a>
</h1>

<p align="center">
  <i align="center">Discovery Protocol</i>
</p>

<h4 align="center">
  <a href="https://opensource.org/licenses/MIT">
    <img src="https://img.shields.io/badge/mit-blue.svg?label=license" alt="license">
  </a>
  <br>
  <a href="https://discord.gg/wvdxP6XvYu">
    <img src="https://img.shields.io/badge/discord-7289da.svg" alt="discord">
  </a>
  <a href="https://x.com/indexnetwork_">
    <img src="https://img.shields.io/twitter/follow/indexnetwork_?style=social" alt="X">
  </a>
</h4>

## About Index Network

Index Network enables **private, intent-driven discovery** through a sophisticated opportunity detection system. Users express what they're seeking as structured intents, and the protocol identifies **opportunities**—legible coordination points that emerge when aligned intents intersect with trust thresholds, timing constraints, and expected value calculations, making action rational for all parties involved.

Unlike traditional matching systems that operate on profile similarity, Index treats opportunities as **first-class coordination primitives**: they exist as distinct entities with their own lifecycle, interpretations, and contextual metadata, enabling nuanced understanding of *why* and *when* a connection makes sense, not just *that* it matches.

## Key Features

### 🔒 Private Intent-Driven Discovery

- **Intent-Based**: Express specific needs like "finding a privacy-focused AI engineer"
- **Privacy by Design**: Index-based access control with granular permissions
- **Opportunity Detection**: Context-aware agents surface coordination points when intents align
- **Semantic Understanding**: Vector similarity and HyDE strategies for intelligent matching
- **Agent Orchestration**: LangGraph-powered workflows for complex discovery tasks

## How It Works

1. **Users Express Intents**: Define what you're seeking in natural language
2. **Context Organization**: Group intents into indexes with privacy controls
3. **Opportunity Detection**: Agents identify coordination points when profiles and intents align
4. **Connection Facilitation**: Dual-perspective descriptions preserve privacy while explaining value
5. **Continuous Discovery**: Profile updates trigger new opportunity searches

## Architecture

```
┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│   Intent Graph       │───▶│  Opportunity Engine  │───▶│  Discovery Layer     │
│                      │    │                      │    │                      │
│ • Semantic vectors   │    │ • Multi-strategy     │    │ • Dual synthesis     │
│ • Index partitions   │    │   HyDE generation    │    │ • Contextual         │
│ • Speech act types   │    │ • 4-dimensional      │    │   integrity          │
│ • Felicity scores    │    │   threshold eval     │    │ • Attribution model  │
│ • Temporal decay     │    │ • Confidence scoring │    │ • Privacy boundaries │
└──────────────────────┘    └──────────────────────┘    └──────────────────────┘
```

**Three-Layer Architecture**:

1. **Intent Graph**: Structured intent storage with semantic embeddings, speech act validation, and index-based access control. Intents are first-class entities with quality scores (semantic entropy, felicity conditions) ensuring high-signal inputs.

2. **Opportunity Engine**: Multi-dimensional detection system that generates hypothetical documents (HyDE) across 6 relationship strategies, evaluates candidates against trust/timing/value/alignment thresholds, and produces scored opportunities with dual-perspective interpretations.

3. **Discovery Layer**: Privacy-preserving presentation system where each party receives synthesized insights about potential connections without exposure to raw private data. Maintains contextual integrity through attributed agent interpretations.

**Core Infrastructure**:

- **LangGraph** for agent state machines and complex orchestration workflows
- **PostgreSQL with pgvector** for 2000-dimensional semantic search (HNSW indexes)
- **Drizzle ORM** for type-safe database operations with schema-driven types
- **OpenRouter** for LLM-powered agents with Zod-validated structured output

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+ with pgvector extension

### Future Roadmap

The protocol architecture is designed for future deployment with:
- **TEE (Trusted Execution Environments)** for confidential compute
- **Decentralized storage** with on-chain finality
- **XMTP integration** for decentralized messaging

### Quick Start

1. **Clone the repository**

```bash
git clone https://github.com/indexnetwork/index.git
cd index
```

2. **Install dependencies**

```bash
# Install all workspace dependencies
bun install
```

3. **Set up environment variables**

```bash
# Copy example environment files
cp protocol/env.example protocol/.env
cp frontend/.env.example frontend/.env

# Configure your database URL and API keys
```

4. **Initialize the database**

```bash
cd protocol
bun run db:generate
bun run db:migrate
```

5. **Start the development servers**

```bash
# Terminal 1: Start the protocol server
cd protocol
bun run dev

# Terminal 2: Start the frontend
cd frontend
bun run dev
```

Visit `http://localhost:3000` to see the application.

## Development

### Project Structure

```
index/
├── protocol/          # Protocol and backend services
├── frontend/          # Next.js web application
```

## Protocol Implementation

The `protocol/` directory contains the core agent infrastructure:

### Key Components

- **Agents**: LangGraph-based agents for intent inference, opportunity evaluation, and profile generation
- **Graph Workflows**: Six state machines (Intent, Index, Opportunity, Profile, HyDE, Chat) orchestrating complex operations
- **Database Layer**: PostgreSQL with pgvector for semantic search and Drizzle ORM for type safety
- **Semantic Governance**: Intent quality validation using speech act theory and felicity conditions

### Development Commands

For the full list of protocol commands (DB, workers, maintenance), see [CLAUDE.md](CLAUDE.md).

```bash
cd protocol

# Start development server (Bun.serve, port 3001)
bun run dev

# Build for production
bun run build

# Database operations
bun run db:generate    # Generate migrations after schema changes
bun run db:migrate     # Run database migrations
bun run db:studio      # Open Drizzle Studio (DB GUI)

# Code quality
bun run lint           # Run ESLint
```

## Contributing

We welcome contributions! Before submitting a Pull Request:

1. **Get Assigned**: Comment on an existing issue or create a new one
2. **Fork & Branch**: Create a feature branch from `main`
3. **Test**: Ensure all tests pass and add tests for new features
4. **Document**: Update relevant documentation
5. **Submit**: Open a PR with a clear description

### Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/index.git

# Create feature branch  
git checkout -b feature/your-feature-name

# Make changes and test
bun test

# Submit PR
git push origin feature/your-feature-name
```

## Resources

- **[index.network](https://index.network)** - Production application
- **[GitHub](https://github.com/indexnetwork/index)** - Source code and issue tracking
- **[Twitter](https://x.com/indexnetwork_)** - Latest updates and announcements
- **[Blog](https://blog.index.network)** - Latest insights and updates
- **[Book a Call](https://calendly.com/d/2vj-8d8-skt/call-with-seren-and-seref)** - Chat with founders

## License

Index Network is licensed under the MIT License. See [LICENSE](LICENSE) for details.
