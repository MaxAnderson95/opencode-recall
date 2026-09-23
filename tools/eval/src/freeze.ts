/** Freezes the mined labels and a corpus built from OpenCode's database into `data/corpus/`. */
import { configFilePath } from "../../../packages/plugin/src/config.ts"
import { config, paths } from "./config.ts"
import { freezeCorpus } from "./corpus.ts"

// The host-wide recall.json, where today's plugin reads `index.excludeDirectories`.
const file = Bun.file(configFilePath(process.env))
const { index }: { index?: { excludeDirectories?: string[] } } = (await file.exists()) ? await file.json() : {}

await freezeCorpus({
  dir: paths.corpus,
  opencodeDb: config.opencodeDb,
  labelsPath: paths.labels,
  modelDir: paths.models,
  excludeDirectories: index?.excludeDirectories ?? [],
})
console.log(`frozen into ${paths.corpus}`)
