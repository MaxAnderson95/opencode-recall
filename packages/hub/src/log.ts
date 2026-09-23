import { Layer, Logger, References, Schema, type LogLevel as EffectLogLevel } from "effect"

export const LogLevel = Schema.Literals(["debug", "info", "warn", "error"])
export type LogLevel = typeof LogLevel.Type

const MINIMUM: Record<LogLevel, EffectLogLevel.LogLevel> = { debug: "Debug", info: "Info", warn: "Warn", error: "Error" }
const NAME: Partial<Record<EffectLogLevel.LogLevel, LogLevel>> = {
  Trace: "debug",
  Debug: "debug",
  Info: "info",
  Warn: "warn",
  Error: "error",
  Fatal: "error",
}

/** One JSON object per line: the time, the level, the first message as `msg`, then the log annotations. */
const jsonLines = (write: (line: string) => void) =>
  Logger.make(({ message, logLevel, date, fiber }) => {
    const [msg] = Array.isArray(message) ? message : [message]
    const fields = fiber.getRef(References.CurrentLogAnnotations)
    write(`${JSON.stringify({ time: date.toISOString(), level: NAME[logLevel], msg, ...fields })}\n`)
  })

/** The hub's log: every Effect log at or above `minimum`, to stdout unless another sink is given. */
export const layer = (minimum: LogLevel, write: (line: string) => void = (line) => process.stdout.write(line)) =>
  Layer.mergeAll(Logger.layer([jsonLines(write)]), Layer.succeed(References.MinimumLogLevel, MINIMUM[minimum]))

export * as Log from "./log.ts"
