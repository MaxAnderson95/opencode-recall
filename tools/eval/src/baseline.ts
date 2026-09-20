/** Scores the retrieval implementation as it stands today. */
import { paths } from "./config.ts"
import { embedQueries, loadCorpus } from "./corpus.ts"
import { fuseToSessions, lexical } from "./retrieval.ts"
import { filtersFor, formatMetrics, score, semantic, type Label } from "./score.ts"

const labels: Label[] = await Bun.file(paths.labels).json()
const corpus = loadCorpus()
console.log(`labels=${labels.length}  chunks=${corpus.n}  dims=${corpus.dims}`)

const qvecs = await embedQueries(labels.map((l) => l.query))
const lex = labels.map((l) => lexical(l.query, filtersFor(l)))

console.log()
console.log(formatMetrics("BM25 only", score(labels, (_l, i) => fuseToSessions(lex[i], []))))
console.log(
  formatMetrics(
    "semantic only",
    score(labels, (l, i) => fuseToSessions([], semantic(qvecs[i], corpus, filtersFor(l)))),
  ),
)
console.log(
  formatMetrics(
    "hybrid (production)",
    score(labels, (l, i) => fuseToSessions(lex[i], semantic(qvecs[i], corpus, filtersFor(l)))),
  ),
)
