# Ping Documentation

**Ping** is a multi-agent collaboration platform that enables teams of AI agents to work together on complex tasks with human supervision and control.

> **Quick Start**: See [INDEX.md](./INDEX.md) for complete documentation navigation

---

## 🌟 What is Ping?

Ping combines two integrated modes:

### Design Mode (Team Builder)
Create and synthesize agents using the **Role Manager meta-agent**:
- **Think** - Analyze team needs
- **Plan** - Design agent roles
- **Suggest** - Get human approval
- **Build** - Instantiate agents

### Execution Mode (Runtime)
Orchestrate multi-agent teams with full visibility:
- **Teams** - Execution boundaries with agents, tasks, artifacts
- **Orchestration** - Coordinate work, assign tasks, manage dependencies
- **Agent Supervision** - Monitor progress, control agents, human-in-the-loop
- **Artifact Management** - Version outputs, review changes, approve deliverables

---

## 📚 Documentation Structure

```
docs/
├── product/ping/                     # User-Facing Documentation
│   ├── guides/                       # How to use Ping
│   │   ├── getting-started.md        # Installation & first steps
│   │   ├── creating-teams.md         # Team setup
│   │   ├── designing-agents.md       # Using Team Builder
│   │   └── reviewing-artifacts.md    # Approval workflows
│   └── api/                          # API reference
│       ├── orchestrator-api.md       # Give goals to teams
│       ├── team-api.md               # Manage teams
│       ├── artifact-api.md           # Access artifacts
│       └── websocket-events.md       # Real-time agent chat
├── developer-guide/                  # Implementation Guides
│   ├── monorepo-architecture.md      # pnpm workspace structure
│   ├── current-state-to-ping.md      # Migration roadmap
│   ├── modules/                      # Backend components
│   │   ├── orchestrator.md           # (AgentManager)
│   │   ├── role-manager.md           # (Agent registry)
│   │   ├── memory-manager.md         # (Task tracking)
│   │   └── agent-worker.md           # (Execution engine)
│   └── frontend/                     # Frontend components
├── features/                         # Feature Development
│   ├── team-service/                 # Team scoping (v1.0 planned)
│   ├── artifact-store/               # Versioned outputs (TBD)
│   ├── realtime-collaboration/       # ShareDB + OT/CRDT (TBD)
│   ├── approval-governance/          # Human control (TBD)
│   └── role-manager-meta-agent/      # Agent synthesis (TBD)
└── archive/                          # Archived Planning Docs
    ├── ping-vision.md                # Old vision docs
    ├── ping-architecture.md          # Old architecture docs
    └── REFACTORING_*.md              # Completed refactoring plans
```

---

## 🎯 Quick Navigation

### For Product Understanding
1. **[Getting Started](./product/ping/guides/getting-started.md)** - Install and run Ping
2. **[Creating Teams](./product/ping/guides/creating-teams.md)** - Set up your first team
3. **[Designing Agents](./product/ping/guides/designing-agents.md)** - Use Team Builder

### For Development
1. **[Monorepo Architecture](./developer-guide/monorepo-architecture.md)** - Project structure
2. **[Current State to Ping](./developer-guide/current-state-to-ping.md)** - Migration roadmap
3. **[Backend Modules](./developer-guide/modules/)** - Core components
4. **[Frontend](./developer-guide/frontend/)** - Ping UI

### API Reference
1. **[Orchestrator API](./product/ping/api/orchestrator-api.md)** - Give goals to teams
2. **[Team API](./product/ping/api/team-api.md)** - Manage teams and agents
3. **[Artifact API](./product/ping/api/artifact-api.md)** - Access outputs
4. **[WebSocket Events](./product/ping/api/websocket-events.md)** - Real-time agent chat

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- pnpm 8+
- Azure OpenAI API key
- Git

### Installation
```bash
# Clone repository
git clone <repository-url>

# Install dependencies
pnpm install

# Set up environment
cp .env.example .env
# Edit .env with your Azure OpenAI credentials

# Start development
pnpm dev
```

> **Detailed setup**: See [Product Guide - Getting Started](./product/ping/guides/getting-started.md)

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     PING PLATFORM                            │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  DESIGN MODE (Team Builder)                           │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  Role Manager Meta-Agent                        │  │  │
│  │  │  • Think  - Analyze team needs                  │  │  │
│  │  │  • Plan   - Design agent roles                  │  │  │
│  │  │  • Suggest - Get approval                       │  │  │
│  │  │  • Build  - Instantiate agents                  │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│                           ↓                                   │
│                    Team Configuration                         │
│                           ↓                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  EXECUTION MODE (Runtime)                             │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  Teams (Execution Boundaries)                   │  │  │
│  │  │  • Agents (team members)                        │  │  │
│  │  │  • Tasks (work items)                           │  │  │
│  │  │  • Artifacts (outputs)                          │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  Orchestration (Coordinate Work)                │  │  │
│  │  │  • Goal → Tasks → Assignment → Execution        │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  Agent Supervision (Human Control)              │  │  │
│  │  │  • Monitor progress                             │  │  │
│  │  │  • Approve outputs                              │  │  │
│  │  │  • Intervene when needed                        │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                               │
└─────────────────────────────────────────────────────────────┘

### Services
- **Agent Registry**: [services/agentRegistry.md](./services/agentRegistry.md)
- **Semantic agent discovery and capability matching**

### Integration
- **Backend-Frontend**: [BACKEND_FRONTEND_INTEGRATION.md](./BACKEND_FRONTEND_INTEGRATION.md)
- **Agent Manager Service**: [AGENTMANAGERSERVICE_INTEGRATION.md](./AGENTMANAGERSERVICE_INTEGRATION.md)
- **Role Discovery**: [ROLE_DISCOVERY_ENHANCEMENT.md](./ROLE_DISCOVERY_ENHANCEMENT.md)

### API Reference
- **API Documentation**: [API_SPLIT.md](./API_SPLIT.md)
- **REST and WebSocket endpoints**

## 📖 Documentation by Role

### For Frontend Developers
1. [Frontend README](./frontend/README.md) - Architecture and tech stack
2. [Components Guide](./frontend/components.md) - Component details
3. [Backend Integration](./BACKEND_FRONTEND_INTEGRATION.md) - API communication
4. [Agent Manager Service](./AGENTMANAGERSERVICE_INTEGRATION.md) - Service layer

### For Backend Developers
1. [Backend README](./backend/README.md) - System architecture
2. [AgentManager](./backend/agentManager.md) - Core orchestration
3. [RoleManager](./backend/roleManager.md) - Role lifecycle
4. [MemoryManager](./backend/memoryManager.md) - Task management
5. [AgentWorker](./backend/agentWorker.md) - Execution engine

### For DevOps/Infrastructure
1. [Setup Guide](./setup.md) - Installation and configuration
2. [Project Structure](./project.md) - Overall architecture
3. [Environment Configuration](./backend/README.md#environment-configuration)

### For New Contributors
1. [INDEX.md](./INDEX.md) - Start here
2. [Project Overview](./project.md) - Understand the system
3. [Setup Guide](./setup.md) - Get running locally
4. [Architecture Docs](./backend/README.md) - Deep dive

## 🔍 Key Concepts Covered

### Multi-Agent Orchestration
- Dynamic role discovery using LLM-based builders
- Automatic task planning with dependency management
- Event-driven coordination between agents
- Real-time monitoring and logging

**Docs**: [AgentManager](./backend/agentManager.md), [RoleManager](./backend/roleManager.md)

### Task Management
- Task lifecycle tracking (ready → in_progress → completed)
- Dependency resolution and prerequisite checking
- Parallel execution support
- Status updates and event emission

**Docs**: [MemoryManager](./backend/memoryManager.md), [AgentWorker](./backend/agentWorker.md)

### Agent Discovery
- Semantic capability matching using embeddings
- Vector similarity search
- Skill level weighting (basic/intermediate/advanced)
- Agent registration and status tracking

**Docs**: [Agent Registry](./services/agentRegistry.md)

### Real-time Communication
- WebSocket-based agent subscriptions
- Event-driven updates (messages, status, logs)
- HTTP REST API for CRUD operations
- Frontend-backend integration patterns

**Docs**: [Backend-Frontend Integration](./BACKEND_FRONTEND_INTEGRATION.md), [API Split](./API_SPLIT.md)

### Frontend Architecture
- React component hierarchy
- State management patterns
- Real-time UI updates
- Agent hierarchy visualization

**Docs**: [Frontend README](./frontend/README.md), [Components](./frontend/components.md)

## 📝 Documentation Standards

### What's Documented
✅ Architecture and design patterns  
✅ API interfaces and contracts  
✅ Configuration and environment setup  
✅ Usage examples and code snippets  
✅ Error handling and troubleshooting  
✅ Performance optimization tips  
✅ Testing strategies  
✅ Best practices and conventions  

### Documentation Format
- **Overview**: High-level purpose and responsibilities
- **Location**: File paths and module structure
- **Key Methods/Components**: Detailed API documentation
- **Usage Examples**: Practical code examples
- **Integration**: How components work together
- **Best Practices**: Recommended patterns
- **Testing**: Unit test examples
- **Troubleshooting**: Common issues and solutions

## 🚀 Recent Updates

### December 20, 2025
- ✨ Created comprehensive frontend documentation
- ✨ Added detailed backend component docs
- ✨ Documented Agent Registry service
- ✨ Created master index with navigation
- ✨ Added component-level documentation
- ✨ Organized docs into logical folders

## 🔧 Maintenance

### Keeping Docs Updated
When making code changes, please update:
1. Relevant component documentation
2. API references if interfaces change
3. Examples if usage patterns change
4. Architecture diagrams if structure changes

### Documentation TODO
See [todo.md](./todo.md) for planned documentation improvements.

## 📞 Getting Help

### For Questions About:
- **Frontend**: See [frontend/README.md](./frontend/README.md)
- **Backend**: See [backend/README.md](./backend/README.md)
- **Setup**: See [setup.md](./setup.md)
- **APIs**: See [API_SPLIT.md](./API_SPLIT.md)
- **Integration**: See [BACKEND_FRONTEND_INTEGRATION.md](./BACKEND_FRONTEND_INTEGRATION.md)

### For Bug Reports or Feature Requests
1. Check existing documentation
2. Review troubleshooting sections
3. Check related integration docs
4. Open issue with reproduction steps

## 🎓 Learning Path

### Beginner Path
1. Read [INDEX.md](./INDEX.md) for overview
2. Follow [setup.md](./setup.md) to get running
3. Explore [frontend/README.md](./frontend/README.md)
4. Try modifying a component

### Intermediate Path
1. Study [backend/README.md](./backend/README.md)
2. Understand [AgentManager](./backend/agentManager.md)
3. Learn [RoleManager](./backend/roleManager.md)
4. Explore [MemoryManager](./backend/memoryManager.md)

### Advanced Path
1. Deep dive into [AgentWorker](./backend/agentWorker.md)
2. Study [Agent Registry](./services/agentRegistry.md)
3. Review all integration docs
4. Understand complete data flow

## 🏗️ Architecture Highlights

### Frontend (React + TypeScript)
```
User Interface
├── Agent Hierarchy Management
├── Real-time Chat Interface
├── Task Management
└── Orchestration Monitoring
```

### Backend (Node.js + LangGraph)
```
Worker Runtime
├── AgentManager (Orchestration)
├── RoleManager (Role Discovery)
├── MemoryManager (Task Tracking)
└── AgentWorker (Execution)
```

### Services (Express + MongoDB)
```
Agent Registry
├── Agent Registration
├── Semantic Discovery
├── Capability Matching
└── Vector Search
```

## 🔗 External Resources

### Technologies Used
- [React Documentation](https://react.dev/)
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [Azure OpenAI](https://learn.microsoft.com/azure/ai-services/openai/)
- [Socket.IO](https://socket.io/)
- [MongoDB](https://docs.mongodb.com/)

### Related Projects
- [LangChain](https://github.com/langchain-ai/langchain)
- [Model Context Protocol](https://github.com/modelcontextprotocol)

## 📊 Documentation Coverage

| Area | Status | Location |
|------|--------|----------|
| Frontend Overview | ✅ Complete | [frontend/README.md](./frontend/README.md) |
| Frontend Components | ✅ Complete | [frontend/components.md](./frontend/components.md) |
| Backend Overview | ✅ Complete | [backend/README.md](./backend/README.md) |
| AgentManager | ✅ Complete | [backend/agentManager.md](./backend/agentManager.md) |
| RoleManager | ✅ Complete | [backend/roleManager.md](./backend/roleManager.md) |
| MemoryManager | ✅ Complete | [backend/memoryManager.md](./backend/memoryManager.md) |
| AgentWorker | ✅ Complete | [backend/agentWorker.md](./backend/agentWorker.md) |
| Agent Registry | ✅ Complete | [services/agentRegistry.md](./services/agentRegistry.md) |
| Integration Guides | ✅ Complete | Multiple files |
| API Reference | ✅ Complete | [API_SPLIT.md](./API_SPLIT.md) |
| Setup Guide | ✅ Complete | [setup.md](./setup.md) |

## 💡 Tips for Using This Documentation

1. **Start with INDEX.md** for a complete overview
2. **Use the search** (Ctrl+F) to find specific topics
3. **Follow the links** between related documents
4. **Check examples** in each doc for practical usage
5. **Review troubleshooting** sections for common issues
6. **Refer to diagrams** for visual understanding

## 🙏 Contributing to Documentation

### How to Contribute
1. Identify gaps or outdated information
2. Create/update markdown files
3. Follow existing format and style
4. Add examples where helpful
5. Update this summary if adding new docs
6. Submit pull request

### Documentation Style Guide
- Use clear, concise language
- Include code examples
- Add links to related docs
- Use proper markdown formatting
- Include diagrams where helpful
- Keep up-to-date with code changes

---

**Last Updated**: December 20, 2025  
**Documentation Version**: 1.0.0  
**Total Documents**: 15+  
**Coverage**: Complete
