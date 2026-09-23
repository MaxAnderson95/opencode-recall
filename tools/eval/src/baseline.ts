/** Scores the frozen corpus through the hub's Archive: BM25 only, semantic only, and hybrid. */
import { paths } from "./config.ts"
import { openCorpus } from "./corpus.ts"
import { formatMetrics, metrics, rankAll } from "./score.ts"

const { archive, labels } = await openCorpus(paths.corpus, paths.models)
const { sessions, chunks } = archive.status()
console.log(`labels=${labels.length}  sessions=${sessions}  chunks=${chunks}`)
console.log()
console.log(formatMetrics("BM25 only", metrics(await rankAll(archive, labels, "lexical"))))
console.log(formatMetrics("semantic only", metrics(await rankAll(archive, labels, "semantic"))))
console.log(formatMetrics("hybrid (production)", metrics(await rankAll(archive, labels, "hybrid"))))
archive.close()
