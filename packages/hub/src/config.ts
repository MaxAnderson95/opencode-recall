import { z } from "zod"

const LogLevel = z.enum(["debug", "info", "warn", "error"])

const Config = z.object({
  dataDir: z.string().min(1),
  listen: z.string().regex(/^.+:\d+$/, "expected host:port"),
  logLevel: LogLevel,
})

export type Config = z.infer<typeof Config>
export type LogLevel = z.infer<typeof LogLevel>

const FileConfig = Config.partial().strict()

const DEFAULTS: Config = { dataDir: "./data", listen: "127.0.0.1:7438", logLevel: "info" }

/**
 * Resolve hub configuration: defaults, then the optional JSON file named by
 * `OPENCODE_RECALL_CONFIG`, then `OPENCODE_RECALL_*` variables, which win.
 */
export async function loadConfig(env: Record<string, string | undefined> = process.env): Promise<Config> {
  const file = env.OPENCODE_RECALL_CONFIG
    ? FileConfig.parse(await Bun.file(env.OPENCODE_RECALL_CONFIG).json())
    : {}
  const fromEnv = {
    dataDir: env.OPENCODE_RECALL_DATA_DIR,
    listen: env.OPENCODE_RECALL_LISTEN,
    logLevel: env.OPENCODE_RECALL_LOG_LEVEL,
  }
  const defined = Object.fromEntries(Object.entries(fromEnv).filter(([, v]) => v !== undefined))
  return Config.parse({ ...DEFAULTS, ...file, ...defined })
}
