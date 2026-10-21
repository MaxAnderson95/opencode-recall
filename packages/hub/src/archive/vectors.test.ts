import { expect, test } from "bun:test"
import { createMatrix, type VectorRow } from "./vectors.ts"

const vector = (...values: number[]) => new Uint8Array(new Float32Array(values).buffer)
const row = (sessionId: string, chunkId: number, scope = "all"): VectorRow => ({ chunkId, sessionId, messageId: `m${chunkId}`, time: chunkId, scope })
const ranked = (hits: { row: VectorRow; score: number }[]) => hits.map((h) => [h.row.chunkId, h.score])

test("the scan keeps the best rows by score among those accepted, best first", () => {
  const matrix = createMatrix(2, 64)
  matrix.add(row("ses_a", 1), vector(0.6, 0.8))
  matrix.add(row("ses_a", 2), vector(1, 0))
  matrix.add(row("ses_b", 3, "user-messages"), vector(1, 0))
  matrix.add(row("ses_b", 4), vector(0, 1))
  const query = new Float32Array([1, 0])
  expect(ranked(matrix.scan(query, (r) => r.scope === "all", 2))).toEqual([
    [2, 1],
    [1, expect.closeTo(0.6)],
  ])
  expect(matrix.scan(query, () => true, 0)).toEqual([])
})

test("equal scores rank the lower chunkId first, in a full scan and a session scan alike, after slots are reused", () => {
  const matrix = createMatrix(2, 64)
  for (let i = 0; i < 3; i++) matrix.add(row("ses_old", i), vector(1, 0))
  for (let i = 3; i < 6; i++) matrix.add(row("ses_b", i), vector(1, 0))
  matrix.removeSession("ses_old")
  // The free slots are taken last-freed first, so chunk 6 takes slot 2 and chunk 8 takes slot 0, ahead of chunks 3 to 5.
  for (let i = 6; i < 9; i++) matrix.add(row("ses_new", i), vector(1, 0))
  const query = new Float32Array([1, 0])
  const all = () => true
  expect(matrix.scan(query, all, 10).map((h) => h.row.chunkId)).toEqual([3, 4, 5, 6, 7, 8])
  expect(matrix.scan(query, all, 2).map((h) => h.row.chunkId)).toEqual([3, 4])
  expect(matrix.scan(query, all, 10, "ses_new").map((h) => h.row.chunkId)).toEqual([6, 7, 8])
})

test("removing chunks frees only their rows, and the session's other rows stay in its scan", () => {
  const matrix = createMatrix(2, 64)
  for (let i = 0; i < 4; i++) matrix.add(row("ses_a", i), vector(1, 0))
  matrix.add(row("ses_b", 4), vector(1, 0))
  const query = new Float32Array([1, 0])
  const scanned = (sessionId?: string) => matrix.scan(query, () => true, 10, sessionId).map((h) => h.row.chunkId)

  matrix.removeChunks("ses_a", [1, 3, 99])
  expect(scanned()).toEqual([0, 2, 4])
  expect(scanned("ses_a")).toEqual([0, 2])
  expect(matrix.stats()).toEqual({ capacity: 64, slots: 5, live: 3 })

  matrix.removeChunks("ses_a", [0, 2])
  expect(scanned("ses_a")).toEqual([])
  matrix.add(row("ses_a", 5), vector(1, 0))
  expect(scanned("ses_a")).toEqual([5])
  expect(matrix.stats()).toEqual({ capacity: 64, slots: 5, live: 2 })
})

test("a session scan visits only that session's rows", () => {
  const matrix = createMatrix(2, 64)
  for (let i = 0; i < 50; i++) matrix.add(row(`ses_${i % 5}`, i), vector(1, 0))
  const visited: string[] = []
  const hits = matrix.scan(new Float32Array([1, 0]), (r) => (visited.push(r.sessionId), true), 60, "ses_3")
  expect(new Set(visited)).toEqual(new Set(["ses_3"]))
  expect(visited).toHaveLength(10)
  expect(hits).toHaveLength(10)
  expect(matrix.scan(new Float32Array([1, 0]), () => true, 60, "ses_missing")).toEqual([])
})
