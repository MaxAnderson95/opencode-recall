import os from "node:os"
import path from "node:path"
import { Config } from "effect"

/** Where the eval reads and writes, from `EVAL_OPENCODE_DB` and `EVAL_DATA_DIR`. */
export const paths = Config.all({
  /** OpenCode's own database: mined for labels and read to freeze a corpus. Only ever opened read-only. */
  opencodeDb: Config.String("EVAL_OPENCODE_DB").pipe(
    Config.withDefault(path.join(os.homedir(), ".local/share/opencode/opencode.db")),
  ),
  /** Local, git-ignored. Holds mined labels, frozen corpora, and the embedding model files. */
  dataDir: Config.String("EVAL_DATA_DIR").pipe(Config.withDefault(path.join(import.meta.dir, "..", "data"))),
}).pipe(
  Config.map(({ opencodeDb, dataDir }) => ({
    opencodeDb,
    labels: path.join(dataDir, "labels.json"),
    /** The frozen corpus `baseline` scores. */
    corpus: path.join(dataDir, "corpus"),
    models: path.join(dataDir, "models"),
  })),
)
