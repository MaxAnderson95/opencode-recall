import type { Archive } from "./archive/index.ts"

export const TOKEN_USAGE = "opencode-recall-hub token issue <source> | token list | token revoke <id>"

type Output = { stdout: (line: string) => void; stderr: (line: string) => void }

/** The `token` subcommand. Returns the process exit code. */
export function runToken(archive: Archive, args: string[], out: Output): number {
  const [action, arg, ...rest] = args
  if (rest.length > 0) return usage(out)

  switch (action) {
    case "issue": {
      const source = arg?.trim()
      if (!source) return usage(out)
      out.stdout(archive.issueToken(source))
      out.stderr(`issued a token for source "${source}"; it is shown only once`)
      return 0
    }
    case "list": {
      if (arg !== undefined) return usage(out)
      const tokens = archive.listTokens()
      out.stdout(["id\tsource\tcreated", ...tokens.map((t) => `${t.id}\t${t.source}\t${new Date(t.timeCreated).toISOString()}`)].join("\n"))
      return 0
    }
    case "revoke": {
      const id = Number(arg)
      if (!Number.isSafeInteger(id)) return usage(out)
      if (!archive.revokeToken(id)) {
        out.stderr(`no token with id ${id}`)
        return 1
      }
      out.stderr(`revoked token ${id}`)
      return 0
    }
    default:
      return usage(out)
  }
}

function usage(out: Output): number {
  out.stderr(`usage: ${TOKEN_USAGE}`)
  return 2
}
