import type { TaskPriority } from '@proj-airi/stage-ui/stores/character'
import type { Tool } from '@xsai/shared-chat'

import { useCharacterNotebookStore } from '@proj-airi/stage-ui/stores/character'
import { tool } from '@xsai/tool'
import { z } from 'zod'

const VALID_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const

const scheduleReminderParams = z.object({
  what: z.string().describe('What to remind the user about, e.g. "uống thuốc" (take medicine).'),
  at: z
    .string()
    .nullable()
    .describe('Due time as an ISO 8601 string in LOCAL time (e.g. "2026-09-17T15:00") or "now" for immediate. Accepts null only when afterMs is set.'),
  afterMs: z
    .number()
    .nullable()
    .describe('Delay in milliseconds from now until the reminder fires. Accepts null only when at is set.'),
  priority: z
    .enum(VALID_PRIORITIES)
    .optional()
    .describe('Optional urgency level. "critical" makes AIRI respond immediately; default is "normal".'),
})

const listRemindersParams = z.object({})

const cancelReminderParams = z.object({
  id: z.string().nullable().optional().describe('Exact reminder id from list_reminders to cancel.'),
  title: z.string().nullable().optional().describe('Title/substring of the reminder to cancel.'),
})

type ScheduleReminderParams = z.infer<typeof scheduleReminderParams>
type CancelReminderParams = z.infer<typeof cancelReminderParams>

/**
 * Resolves `at`/`afterMs` into an epoch-ms due time.
 *
 * The two fields are mutually exclusive; this returns an error string when
 * neither/too many are supplied or the value is unparseable.
 */
function resolveDueAt(params: ScheduleReminderParams): { ok: true, dueAt: number } | { ok: false, error: string } {
  const hasAt = typeof params.at === 'string' && params.at.length > 0
  const hasAfterMs = typeof params.afterMs === 'number' && Number.isFinite(params.afterMs)

  if (hasAt === hasAfterMs) {
    return { ok: false, error: 'Provide exactly one of "at" or "afterMs".' }
  }

  if (hasAfterMs && params.afterMs! <= 0) {
    return { ok: false, error: 'afterMs must be a positive number.' }
  }

  if (hasAt) {
    if (params.at! === 'now') {
      return { ok: true, dueAt: Date.now() }
    }

    const dueAt = new Date(params.at!).getTime()
    if (!Number.isFinite(dueAt)) {
      return { ok: false, error: `Could not parse "at" value "${params.at}". Use ISO 8601 local time like "2026-09-17T15:00".` }
    }
    return { ok: true, dueAt }
  }

  return { ok: true, dueAt: Date.now() + params.afterMs! }
}

function formatDueAt(dueAt: number): string {
  const date = new Date(dueAt)
  return date.toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

async function executeScheduleReminder(input: ScheduleReminderParams): Promise<string> {
  if (!input.what.trim()) {
    return 'Error: "what" is required for scheduling a reminder.'
  }

  const due = resolveDueAt(input)
  if (!due.ok) {
    return `Error: ${due.error}`
  }

  const notebookStore = useCharacterNotebookStore()
  const task = notebookStore.scheduleTask({
    title: input.what.trim(),
    priority: (input.priority as TaskPriority | undefined) ?? 'normal',
    dueAt: due.dueAt,
  })

  return `Scheduled reminder "${task.title}" for ${formatDueAt(task.dueAt!)} (id ${task.id}). AIRI will mention it when the time comes.`
}

async function executeListReminders(): Promise<string> {
  const notebookStore = useCharacterNotebookStore()
  const active = notebookStore.tasks.filter(task => task.status !== 'done' && task.status !== 'dropped')
  if (active.length === 0) {
    return 'No pending reminders.'
  }

  const lines = active.map((task, index) => {
    const dueAt = task.dueAt ? formatDueAt(task.dueAt) : 'asap'
    const priority = task.priority === 'normal' ? '' : ` [${task.priority}]`
    return `${index + 1}. (${task.id}) "${task.title}" — ${dueAt}, status ${task.status}${priority}`
  })
  return lines.join('\n')
}

async function executeCancelReminder(input: CancelReminderParams): Promise<string> {
  if (!input.id && !input.title) {
    return 'Error: provide either "id" or "title" to cancel a reminder.'
  }

  const notebookStore = useCharacterNotebookStore()
  const target
    = typeof input.id === 'string' && input.id.length > 0
      ? notebookStore.tasks.filter(task => task.id === input.id || task.id.startsWith(input.id!))
      : typeof input.title === 'string' && input.title.length > 0
        ? notebookStore.tasks.filter(task => task.status !== 'done' && task.status !== 'dropped' && task.title.toLowerCase().includes(input.title!.toLowerCase()))
        : []

  if (target.length === 0) {
    return `No matching reminder to cancel for ${input.id ? `id "${input.id}"` : `title "${input.title}"`}.`
  }

  for (const task of target) {
    notebookStore.markTaskDone(task.id)
  }

  return `Cancelled ${target.length} reminder(s): ${target.map(t => `"${t.title}"`).join(', ')}.`
}

const tools: Promise<Tool>[] = [
  tool({
    name: 'schedule_reminder',
    description: 'Schedule a one-time reminder for the user. AIRI will speak the reminder aloud when the due time arrives (the scheduler checks every few seconds). Set "at" as ISO 8601 local time, or "afterMs" for a duration from now. Use "now" to trigger on the next tick.',
    execute: executeScheduleReminder,
    parameters: scheduleReminderParams,
  }),
  tool({
    name: 'list_reminders',
    description: 'List all pending reminders with their ids, titles, due times, and statuses.',
    execute: executeListReminders,
    parameters: listRemindersParams,
  }),
  tool({
    name: 'cancel_reminder',
    description: 'Cancel one or more pending reminders by exact id (from list_reminders) or a case-insensitive title/substring match.',
    execute: executeCancelReminder,
    parameters: cancelReminderParams,
  }),
]

export const reminderTools = async () => Promise.all(tools)
