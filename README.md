# Calm Todo

「静かに背中を押す」タスク管理アプリ。機能美と低認知負荷を両立し、ユーザーの生産性と達成感を自然に高める。

## Features

- **Cross-platform**: Windows desktop app + Web browser
- **Real-time sync**: Firebase-powered data synchronization
- **AI Task Decomposition**: GPT-4o-mini powered task breakdown
- **Beautiful UI**: Calm Industrial design aesthetic
- **Focus Mode**: Distraction-free task view
- **Progress Tracking**: Daily progress ring, weekly heatmap, streak counter

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Desktop**: Tauri 2.x
- **Backend**: Firebase (Auth, Firestore)
- **State Management**: Zustand
- **Animation**: Framer Motion
- **AI**: OpenAI GPT-4o-mini

## Getting Started

### Prerequisites

- Node.js 18+
- Rust (for Tauri)
- Firebase project
- OpenAI API key (optional, for AI features)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/calm-todo.git
   cd calm-todo
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create `.env` file:
   ```bash
   cp .env.example .env
   ```

4. Configure Firebase:
   - Create a Firebase project at https://console.firebase.google.com
   - Enable Google Authentication
   - Create a Firestore database
   - Copy your config values to `.env`

### Development

```bash
# Web development
npm run dev

# Desktop development (Tauri)
npm run tauri dev
```

### Build

```bash
# Web build
npm run build

# Desktop build
npm run tauri build
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `n` | New task |
| `Enter` | Complete task |
| `e` | Edit task |
| `d` | Delete task |
| `↑/↓` | Navigate tasks |
| `Ctrl+K` | Command palette |
| `Ctrl+F` | Focus mode |
| `Ctrl+D` | AI decompose |
| `Esc` | Close modal |

## License

MIT
