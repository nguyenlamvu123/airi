import type { AgentBackendFactory, AgentBackendInstance } from '../../types'

import { startOpencodeServer } from './server'
import { createOpencodeTransport } from './transport'

export interface OpencodeBackendOptions {
  directory: string
  opencodePath?: string
  serverPort?: number
  host?: string
}

/**
 * Starts the opencode backend: a local `opencode serve` process plus a transport
 * that speaks its HTTP API. The caller closes the returned instance to stop the
 * server.
 */
export async function createOpencodeBackend(options: OpencodeBackendOptions): Promise<AgentBackendInstance> {
  const server = await startOpencodeServer({
    directory: options.directory,
    opencodePath: options.opencodePath,
    serverPort: options.serverPort,
    host: options.host,
  })

  return {
    transport: createOpencodeTransport(server.baseUrl),
    serverBaseUrl: server.baseUrl,
    close: () => server.close(),
  }
}

/** Registry-facing factory; pulls the executable override from start options. */
export const createOpencodeBackendFromOptions: AgentBackendFactory = options => createOpencodeBackend({
  directory: options.directory,
  opencodePath: options.commandPath,
  host: options.host,
})
