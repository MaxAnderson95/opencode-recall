import os from "node:os"
import path from "node:path"

const home = os.homedir()

export const config = {
  /** The recall index being measured. */
  indexDb: process.env.EVAL_INDEX_DB ?? path.join(home, ".local/share/opencode-recall/index.db"),
  /** OpenCode's own database, mined for labels. */
  opencodeDb: process.env.EVAL_OPENCODE_DB ?? path.join(home, ".local/share/opencode/opencode.db"),
  /**
   * The retrieval implementation under test. Today this is the plugin being
   * replaced; point it at the hub's Archive module once that exists.
   */
  retrievalDir: process.env.EVAL_RETRIEVAL_DIR ?? path.join(home, "my-opencode-setup/plugins/recall"),
  /** Local, git-ignored. Holds mined labels and cached candidate vectors. */
  dataDir: process.env.EVAL_DATA_DIR ?? path.join(import.meta.dir, "..", "data"),
}

export const paths = {
  labels: path.join(config.dataDir, "labels.json"),
  corpusVectors: (tag: string) => path.join(config.dataDir, `corpus-${tag}.bin`),
  queryVectors: (tag: string) => path.join(config.dataDir, `queries-${tag}.bin`),
}
