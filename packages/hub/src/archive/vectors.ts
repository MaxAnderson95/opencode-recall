/**
 * The active space's vectors held in one contiguous `Float32Array` for a brute-force cosine scan.
 * Kept in step with the database by the archive, row by row, so ingest never forces a reload.
 */

export type VectorRow = { chunkId: number; sessionId: string; messageId: string; time: number; scope: string }

export type Matrix = ReturnType<typeof createMatrix>

/** Rows the matrix has room for, slots in use (live rows and removed rows' slots waiting for the next added rows), and live rows. */
export type MatrixStats = { capacity: number; slots: number; live: number }

/** Each growth during ingest adds a quarter, so at most a fifth of a grown matrix is unused. */
const GROWTH = 1.25
const MIN_GROWN_ROWS = 1024

/** A matrix with room for `capacity` rows: the count about to be loaded, so loading allocates once. */
export function createMatrix(dims: number, capacity = 0) {
  let data = new Float32Array(capacity * dims)
  let bytes = new Uint8Array(data.buffer)
  /** `null` marks a removed row, whose slot is on `free` for the next added row. */
  const rows: (VectorRow | null)[] = []
  const free: number[] = []
  const bySession = new Map<string, number[]>()

  function slot(): number {
    const reused = free.pop()
    if (reused !== undefined) return reused
    if (rows.length * dims === data.length) {
      const grown = new Float32Array(Math.max(MIN_GROWN_ROWS, Math.ceil((data.length / dims) * GROWTH)) * dims)
      grown.set(data)
      data = grown
      bytes = new Uint8Array(data.buffer)
    }
    rows.push(null)
    return rows.length - 1
  }

  return {
    /** Add `row` with its vector's bytes as stored in the database, copied straight into the matrix. */
    add(row: VectorRow, embedding: Uint8Array) {
      const i = slot()
      bytes.set(embedding, i * dims * Float32Array.BYTES_PER_ELEMENT)
      rows[i] = row
      const indexes = bySession.get(row.sessionId)
      if (indexes) indexes.push(i)
      else bySession.set(row.sessionId, [i])
    },

    removeSession(sessionId: string) {
      const indexes = bySession.get(sessionId)
      if (!indexes) return
      for (const i of indexes) {
        rows[i] = null
        free.push(i)
      }
      bySession.delete(sessionId)
    },

    stats: (): MatrixStats => ({ capacity: data.length / dims, slots: rows.length, live: rows.length - free.length }),

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
