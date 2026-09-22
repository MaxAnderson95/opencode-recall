import type { LogLevel } from "./config.ts"

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export type Log = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => void

/** One JSON object per line, to stdout unless another sink is given. */
export function createLog(minimum: LogLevel, write: (line: string) => void = (line) => process.stdout.write(line)): Log {
  return (level, msg, fields) => {
    if (RANK[level] < RANK[minimum]) return
    write(`${JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields })}\n`)
  }
}
