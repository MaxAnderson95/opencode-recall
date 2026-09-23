/** Scores the frozen corpus through the hub's Archive: BM25 only, semantic only, and hybrid. */
import { Effect } from "effect"
import { Embedder } from "../../../packages/hub/src/embedder.ts"
import { paths } from "./config.ts"
import { openCorpus } from "./corpus.ts"
import { formatMetrics, metrics, rankAll } from "./score.ts"

const program = Effect.gen(function* () {
  const { corpus, models } = yield* paths
  const { archive, labels } = yield* openCorpus(corpus).pipe(Effect.provide(Embedder.onnx(models)))
  const { sessions, chunks } = yield* archive.status()
  console.log(`labels=${labels.length}  sessions=${sessions}  chunks=${chunks}`)
  console.log()
  console.log(formatMetrics("BM25 only", metrics(yield* rankAll(archive, labels, "lexical"))))
  console.log(formatMetrics("semantic only", metrics(yield* rankAll(archive, labels, "semantic"))))
  console.log(formatMetrics("hybrid (production)", metrics(yield* rankAll(archive, labels, "hybrid"))))
})

await Effect.runPromise(Effect.scoped(program))
