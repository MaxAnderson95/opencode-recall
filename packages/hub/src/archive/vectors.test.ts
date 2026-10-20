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

test("equal scores rank the lower row index first, in a full scan and a session scan alike, after slots are reused", () => {
  const matrix = createMatrix(2, 64)
  for (let i = 0; i < 3; i++) matrix.add(row("ses_old", i), vector(1, 0))
  for (let i = 3; i < 6; i++) matrix.add(row("ses_b", i), vector(1, 0))
  matrix.removeSession("ses_old")
  // The free slots are taken last-freed first, so chunk 6 takes row 2 and chunk 8 takes row 0.
  for (let i = 6; i < 9; i++) matrix.add(row("ses_new", i), vector(1, 0))
  const query = new Float32Array([1, 0])
  const all = () => true
  expect(matrix.scan(query, all, 10).map((h) => h.row.chunkId)).toEqual([8, 7, 6, 3, 4, 5])
  expect(matrix.scan(query, all, 2).map((h) => h.row.chunkId)).toEqual([8, 7])
  expect(matrix.scan(query, all, 10, "ses_new").map((h) => h.row.chunkId)).toEqual([8, 7, 6])
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
