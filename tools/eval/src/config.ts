import os from "node:os"
import path from "node:path"

const home = os.homedir()

export const config = {
  /** OpenCode's own database: mined for labels and read to freeze a corpus. Only ever opened read-only. */
  opencodeDb: process.env.EVAL_OPENCODE_DB ?? path.join(home, ".local/share/opencode/opencode.db"),
  /** Local, git-ignored. Holds mined labels, frozen corpora, and the embedding model files. */
  dataDir: process.env.EVAL_DATA_DIR ?? path.join(import.meta.dir, "..", "data"),
}

export const paths = {
  labels: path.join(config.dataDir, "labels.json"),
  /** The frozen corpus `baseline` scores; `compare` takes any two by path. */
  corpus: path.join(config.dataDir, "corpus"),
  models: path.join(config.dataDir, "models"),
}
