import { Console, Effect } from "effect"
import { Archive } from "./archive/index.ts"

export const TOKEN_USAGE = "opencode-recall-hub token issue <source> | token list | token revoke <id>"

const usage = Console.error(`usage: ${TOKEN_USAGE}`).pipe(Effect.as(2))

/** The `token` subcommand: prints to the console and returns the process exit code. */
export const runToken = Effect.fn("Token.run")(function* (args: readonly string[]) {
  const archive = yield* Archive.Service
  const [action, arg, ...rest] = args
  if (rest.length > 0) return yield* usage

  switch (action) {
    case "issue": {
      const source = arg?.trim()
      // A leading dash is a mistyped flag such as `--help`, and the token would be printed for it.
      if (!source || source.startsWith("-")) return yield* usage
      yield* Console.log(yield* archive.issueToken(source))
      yield* Console.error(`issued a token for source "${source}"; it is shown only once`)
      return 0
    }
    case "list": {
      if (arg !== undefined) return yield* usage
      const tokens = yield* archive.listTokens()
      yield* Console.log(
        ["id\tsource\tcreated", ...tokens.map((t) => `${t.id}\t${t.source}\t${new Date(t.timeCreated).toISOString()}`)].join("\n"),
      )
      return 0
    }
    case "revoke": {
      const id = Number(arg)
      if (!Number.isSafeInteger(id)) return yield* usage
      if (!(yield* archive.revokeToken(id))) {
        yield* Console.error(`no token with id ${id}`)
        return 1
      }
      yield* Console.error(`revoked token ${id}`)
      return 0
    }
    default:
      return yield* usage
  }
})
