# 📜 Ptah - Claude Code GUI

**The complete visual interface for Claude Code CLI within VS Code**

Transform your Claude Code experience with Ptah, the first and only VS Code extension that makes Claude Code's full power accessible through native, integrated visual interfaces.

## 🚀 Features

### ⭐ Core Features

- **Integrated Chat Sidebar** - Native VS Code chat interface with Claude Code
- **Visual Command Builder** - Build Claude commands through intuitive UI forms
- **Smart Context Management** - Visual file inclusion/exclusion with optimization suggestions
- **Session Management** - Multiple sessions with workspace awareness
- **Real-time Analytics** - Token usage, cost tracking, and productivity insights

### 🎯 Quick Actions

- **Instant Code Review** - Right-click any file for immediate Claude analysis
- **Test Generation** - Generate comprehensive tests for your code
- **Bug Detection** - AI-powered bug finding and security analysis
- **Documentation** - Auto-generate docs for functions and classes
- **Code Optimization** - Performance and style improvements

## 📦 Installation

### Prerequisites

1. **VS Code** 1.74.0 or higher
2. **Claude Code CLI** - [Installation Guide](https://github.com/anthropics/claude-code#installation)

### Install Extension

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Ptah - Claude Code GUI"
4. Click Install

### First Run

1. Open any workspace in VS Code
2. Click the Ptah icon (📜) in the Activity Bar
3. Follow the welcome guide to configure your Claude CLI path

## 🏗️ Development

### Setup Development Environment

```bash
# Clone the repository
git clone https://github.com/your-org/ptah-claude-code.git
cd ptah-claude-code

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Start development
code .
```

### Running the Extension

1. Open the project in VS Code
2. Press `F5` to launch Extension Development Host
3. Test the extension in the new VS Code window

### Available Scripts

```bash
npm run compile     # Compile TypeScript
npm run watch      # Watch mode for development
npm run test       # Run test suite
npm run lint       # Lint TypeScript code
```

## 🎨 Architecture

### Core Components

- **Extension Host** (`src/extension.ts`) - Main entry point
- **Core Services** (`src/services/`) - Claude CLI, Session, Context management
- **UI Providers** (`src/providers/`) - Webview providers for chat, analytics
- **Type Definitions** (`src/types/`) - TypeScript interfaces

### Key Services

- **ClaudeCliService** - Integration with Claude Code CLI
- **SessionManager** - Multi-session support with persistence
- **ContextManager** - Smart file inclusion and optimization
- **WorkspaceManager** - Project type detection and workspace integration

## 🔧 Configuration

### Extension Settings

```json
{
  "ptah.claudeCliPath": "claude",
  "ptah.defaultProvider": "anthropic",
  "ptah.maxTokens": 200000,
  "ptah.autoIncludeOpenFiles": true,
  "ptah.contextOptimization": true,
  "ptah.analyticsEnabled": true
}
```

### Workspace Settings

Project-specific context rules and session preferences are automatically saved to workspace settings.

## 📚 Usage Guide

### Basic Chat

1. Click Ptah icon in Activity Bar
2. Type your question in the chat input
3. Press Enter or click Send

### Code Review

1. Right-click any file in Explorer
2. Select "Ptah: Review Current File"
3. View analysis in chat sidebar

### Context Management

1. Open Context Files tree view
2. Click checkmarks to include/exclude files
3. View token usage and optimization suggestions

### Command Builder

1. Press `Ctrl+Shift+P` > "Ptah: Build Command"
2. Select template from gallery
3. Fill in parameters through visual form
4. Execute command in chat

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Workflow

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🔗 Links

- [Claude Code CLI](https://github.com/anthropics/claude-code)
- [VS Code Extension API](https://code.visualstudio.com/api)
- [Issue Tracker](https://github.com/your-org/ptah-claude-code/issues)
- [Marketplace Page](https://marketplace.visualstudio.com/items?itemName=ptah-extensions.ptah-claude-code)

## 🆘 Support

- **Documentation**: [Wiki](https://github.com/your-org/ptah-claude-code/wiki)
- **Issues**: [GitHub Issues](https://github.com/your-org/ptah-claude-code/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-org/ptah-claude-code/discussions)

---

**Made with ❤️ for the VS Code community**
