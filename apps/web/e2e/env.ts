import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Loads apps/web/.env.local into process.env (without overriding variables
 * already set) so the Playwright config and setup projects can reach the
 * Clerk Backend API. The app itself loads this file through Vite; Playwright
 * runs outside Vite, so it needs its own loader.
 */
export function loadWebEnv() {
  const webRoot = path.resolve(
    fileURLToPath(new URL('.', import.meta.url)),
    '..',
  )
  const envPath = path.join(webRoot, '.env.local')
  if (!fs.existsSync(envPath)) {
    return
  }

  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue
    }
    const separator = trimmed.indexOf('=')
    if (separator === -1) {
      continue
    }
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^(["'])(.*)\1$/, '$2')
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}
