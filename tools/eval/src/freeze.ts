/** Freezes the mined labels and a corpus built from OpenCode's database into `data/corpus/`. */
import { Effect } from "effect"
import { Embedder } from "../../../packages/hub/src/embedder.ts"
import { PluginConfig } from "../../../packages/plugin/src/config.ts"
import { paths } from "./config.ts"
import { freezeCorpus } from "./corpus.ts"

const program = Effect.gen(function* () {
  const { corpus, labels, models, opencodeDb } = yield* paths
  // The host-wide recall.json, where today's plugin reads `index.excludeDirectories`.
  const file = Bun.file(yield* PluginConfig.filePath)
  const { index }: { index?: { excludeDirectories?: string[] } } = (yield* Effect.promise(() => file.exists()))
    ? yield* Effect.promise(() => file.json())
    : {}
  yield* freezeCorpus({
    dir: corpus,
    opencodeDb,
    labelsPath: labels,
    excludeDirectories: index?.excludeDirectories ?? [],
  }).pipe(Effect.provide(Embedder.onnx(models)))
  console.log(`frozen into ${corpus}`)
})

await Effect.runPromise(program)
