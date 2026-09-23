/**
 * The active space's vectors held in one contiguous `Float32Array` for a brute-force cosine scan.
 * Kept in step with the database by the archive, row by row, so ingest never forces a reload.
 */

export type VectorRow = { chunkId: number; sessionId: string; messageId: string; time: number; scope: string }

export type Matrix = ReturnType<typeof createMatrix>

export function createMatrix(dims: number) {
  let data = new Float32Array(0)
  /** `null` marks a removed row, reclaimed by the next compaction. */
  let rows: (VectorRow | null)[] = []
  let bySession = new Map<string, number[]>()
  let removed = 0

  function append(row: VectorRow, vector: Float32Array) {
    if ((rows.length + 1) * dims > data.length) {
      const grown = new Float32Array(Math.max(1024, rows.length * 2) * dims)
      grown.set(data)
      data = grown
    }
    data.set(vector, rows.length * dims)
    const indexes = bySession.get(row.sessionId)
    if (indexes) indexes.push(rows.length)
    else bySession.set(row.sessionId, [rows.length])
    rows.push(row)
  }

  function compact() {
    // The subarrays keep the old buffer alive until they are copied into the new one.
    const live = rows.flatMap((row, i) => (row ? [{ row, vector: data.subarray(i * dims, (i + 1) * dims) }] : []))
    data = new Float32Array(Math.max(1024, live.length * 2) * dims)
    rows = []
    bySession = new Map()
    removed = 0
    for (const { row, vector } of live) append(row, vector)
  }

  return {
    add: append,

    removeSession(sessionId: string) {
      const indexes = bySession.get(sessionId)
      if (!indexes) return
      for (const i of indexes) rows[i] = null
      removed += indexes.length
      bySession.delete(sessionId)
      if (removed > 1024 && removed * 2 > rows.length) compact()
    },

    /** The `limit` best rows by dot product with `query` (the cosine, as both are normalized) among those `accept` keeps. */
    scan(query: Float32Array, accept: (row: VectorRow) => boolean, limit: number): { row: VectorRow; score: number }[] {
      const scored: { row: VectorRow; score: number }[] = []
      rows.forEach((row, i) => {
        if (!row || !accept(row)) return
        let score = 0
        const offset = i * dims
        for (let d = 0; d < dims; d++) score += query[d]! * data[offset + d]!
        scored.push({ row, score })
      })
      return scored.sort((a, b) => b.score - a.score).slice(0, limit)
    },
  }
}
