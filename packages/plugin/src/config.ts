import { homedir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

export type HubConfig = { url: string; token: string }

// Other sections (`index`, from today's plugin) share the file, so only `hub` is checked.
const File = z.looseObject({
  hub: z.object({ url: z.string().min(1).optional(), token: z.string().min(1).optional() }).optional(),
})

/** The host-wide `recall.json` shared by every OpenCode process on this machine. */
export function configFilePath(env: Record<string, string | undefined>): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode", "recall.json")
}

/**
 * Resolve the hub address and token: `OPENCODE_RECALL_HUB_URL` and
 * `OPENCODE_RECALL_TOKEN` win over `hub.url` and `hub.token` in the config
 * file. Returns `null` while either is missing. Read fresh on every call so an
 * edited file takes effect without restarting OpenCode.
 */
export async function loadHubConfig(env: Record<string, string | undefined>, path: string): Promise<HubConfig | null> {
  const file = Bun.file(path)
  const { hub } = (await file.exists()) ? File.parse(await file.json()) : {}
  const url = env.OPENCODE_RECALL_HUB_URL || hub?.url
  const token = env.OPENCODE_RECALL_TOKEN || hub?.token
  return url && token ? { url, token } : null
}
