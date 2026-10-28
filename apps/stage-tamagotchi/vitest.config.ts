import { cwd } from 'node:process'

import vue from '@vitejs/plugin-vue'
import Info from 'unplugin-info/vite'

import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    vue(),
    // Serves the `~build/*` virtual modules, as `electron.vite.config.ts` does.
    // `@proj-airi/stage-ui/stores/character` reaches them through analytics,
    // so any renderer test importing it (e.g. chat-sync via the reminder tools)
    // fails to resolve without this.
    Info(),
  ],
  test: {
    env: loadEnv('test', cwd(), ''),
    // `tests/` holds the golden-file runner; its cases live in tests/input and tests/expect.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.git/**'],
    fileParallelism: false,
    maxWorkers: 1,
  },
})
