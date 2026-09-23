import type { StorageDomain } from "@opencode/plugin/promise/storage"
import { Context, Effect, Layer, Schema } from "effect"

/** `ctx.storage` as OpenCode hands it to a plugin. */
export type Domain = Pick<StorageDomain, "get" | "set" | "remove" | "scan">
type Json = Parameters<Domain["set"]>[1]

/** A storage call failed, or a stored value is not the shape its key holds. */
export class Failed extends Schema.TaggedError<Failed>()("Storage.Failed", { message: Schema.String, cause: Schema.Defect() }) {}

const failed = (cause: unknown) => new Failed({ message: cause instanceof Error ? cause.message : String(cause), cause })

/** The JSON values the plugin keeps, each decoded on read with the schema for its keys. */
export interface Interface {
  readonly get: <A>(key: string, schema: Schema.Codec<A>) => Effect.Effect<A | undefined, Failed>
  readonly set: (key: string, value: Json) => Effect.Effect<void, Failed>
  readonly remove: (key: string) => Effect.Effect<void, Failed>
  /** Every entry under `prefix`, across all pages. */
  readonly scan: <A>(prefix: string, schema: Schema.Codec<A>) => Effect.Effect<{ key: string; value: A }[], Failed>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-recall/plugin/Storage") {}

export const fromDomain = (domain: Domain) =>
  Layer.succeed(
    Service,
    Service.of({
      get: Effect.fn("Storage.get")(function* <A>(key: string, schema: Schema.Codec<A>) {
        const value = yield* Effect.tryPromise({ try: () => domain.get(key), catch: failed })
        if (value === undefined) return undefined
        return yield* Schema.decodeUnknownEffect(schema)(value).pipe(Effect.mapError(failed))
      }),
      set: (key, value) => Effect.tryPromise({ try: () => domain.set(key, value), catch: failed }),
      remove: (key) => Effect.tryPromise({ try: () => domain.remove(key), catch: failed }),
      scan: Effect.fn("Storage.scan")(function* <A>(prefix: string, schema: Schema.Codec<A>) {
        const found: { key: string; value: A }[] = []
        let after: string | undefined
        do {
          const page = yield* Effect.tryPromise({ try: () => domain.scan({ prefix, after }), catch: failed })
          for (const { key, value } of page.entries)
            found.push({ key, value: yield* Schema.decodeUnknownEffect(schema)(value).pipe(Effect.mapError(failed)) })
          after = page.next
        } while (after !== undefined)
        return found
      }),
    }),
  )

export * as Storage from "./storage.ts"
