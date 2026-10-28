/**
 * A running agent backend (opencode, Claude Code, ...) exposed to AIRI as a
 * single conversational session.
 *
 * The OpenAI-compatible proxy in `./proxy` only depends on this interface, so a
 * new backend is added by implementing a transport, not by touching the proxy or
 * the renderer.
 */
export interface AgentPromptResult {
  /** Full assistant text for the turn. */
  text: string
  /**
   * Session id after the turn. Backends that mint the id lazily (CLI agents)
   * return it here so callers can persist it and resume later.
   */
  sessionID: string
  /** Model the backend actually used, when it reports one. */
  modelID?: string
}

/** Per-turn inputs sent alongside the user text. */
export interface AgentPromptOptions {
  /**
   * AIRI's system prompt for this turn: character card, speaking style and the
   * emotion/ACT marker rules the stage parses from the answer. The backend
   * keeps its own conversation history but never AIRI's persona, so it must be
   * resent every turn. Empty or omitted means no persona.
   */
  systemPrompt?: string
}

export interface AgentTransport {
  /**
   * Opens the conversation session. When `options.resumeSessionID` names a
   * session the backend still knows, it is reused so the conversation continues
   * instead of starting fresh; backends that mint ids lazily may return `''`.
   */
  createSession: (options?: { title?: string, resumeSessionID?: string }) => Promise<{ id: string }>
  /**
   * Sends one user turn. `onText` is called for each visible assistant text
   * chunk as it arrives (may be called zero or more times); the returned
   * promise resolves with the complete turn.
   */
  prompt: (sessionID: string, text: string, onText: (delta: string) => void, options?: AgentPromptOptions) => Promise<AgentPromptResult>
  /** Releases any process/connection owned by the transport. */
  close: () => Promise<void>
}

/** Options every backend starter receives; specific backends read what they need. */
export interface AgentStartOptions {
  /** Working directory the agent treats as the project root. */
  directory: string
  host?: string
  /** Executable path override, e.g. from user settings. */
  commandPath?: string
}

/**
 * A started backend: a live transport plus whatever process/connection needs to
 * be torn down. HTTP backends also report their server URL for diagnostics.
 */
export interface AgentBackendInstance {
  transport: AgentTransport
  serverBaseUrl?: string
  close: () => Promise<void>
}

export type AgentBackendFactory = (options: AgentStartOptions) => Promise<AgentBackendInstance>
