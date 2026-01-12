import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

const BACKUP_DIR = 'C:/CalmTodoBackup'
const BACKUP_FILE = path.join(BACKUP_DIR, 'calm-todo-backup.json')

// Backup plugin for development
function backupPlugin(): Plugin {
  return {
    name: 'backup-plugin',
    configureServer(server) {
      // Ensure backup directory exists
      if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true })
      }

      // Save backup endpoint
      server.middlewares.use('/api/backup/save', (req, res) => {
        if (req.method === 'POST') {
          let body = ''
          req.on('data', chunk => { body += chunk })
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              fs.writeFileSync(BACKUP_FILE, JSON.stringify(data, null, 2), 'utf-8')
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: true, path: BACKUP_FILE }))
            } catch (error) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, error: String(error) }))
            }
          })
        } else {
          res.writeHead(405)
          res.end()
        }
      })

      // Load backup endpoint
      server.middlewares.use('/api/backup/load', (req, res) => {
        if (req.method === 'GET') {
          try {
            if (fs.existsSync(BACKUP_FILE)) {
              const data = fs.readFileSync(BACKUP_FILE, 'utf-8')
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(data)
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ todos: [], collapsed: [] }))
            }
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: String(error) }))
          }
        } else {
          res.writeHead(405)
          res.end()
        }
      })
    }
  }
}

// https://vite.dev/config/
const isDev = process.env.NODE_ENV !== 'production'

export default defineConfig({
  plugins: [react(), backupPlugin()],
  base: isDev ? '/' : './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 4000,
    strictPort: true,
    headers: {
      'Cache-Control': 'no-store',
    },
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 4000,
    },
  },
  optimizeDeps: {
    force: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_PLATFORM == 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
})
