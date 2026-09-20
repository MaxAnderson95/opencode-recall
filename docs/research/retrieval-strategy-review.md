# Retrieval strategy review

Resolves research ticket #5: is BM25 + cosine + RRF with session-level aggregation the right retrieval strategy for recalling past agent conversations, and if not, what single change is worth making in 1.0.

## Verdict

The current strategy is fine for 1.0. Ship it unchanged. Every component sits inside the range the primary literature supports for this corpus shape, and the whole query path measures under 100 ms on the reference machine. The one change with clear evidence behind it, a CPU cross-encoder rerank of the top fused sessions, costs 0.7 to 1.7 s per query on an Apple M5 Pro and should wait for a labeled query set that can show it earns that latency. Details and costs are in "What would be worth changing" below.

## What the current implementation does

Read from `/Users/max.anderson/my-opencode-setup/plugins/recall/lib/{search,text,indexer,config}.ts` and `recall.ts`.

- Lexical branch: SQLite FTS5 over a contentless table. Text and reasoning parts are split into segments of at most 8,000 characters (never truncated); tool output is truncated at 16,000 characters before segmentation. Every query token is quoted as an FTS5 phrase, joined with AND, falling back to OR when AND returns nothing. Filters (time, directory, scope, tools, calling session) are applied inside the SQL, and the top 60 rows by FTS5 `rank` are taken.
- Semantic branch: `Xenova/bge-small-en-v1.5` (384 dims, 512-token limit) quantized to q8 through transformers.js in a child process. The embedded unit is a turn pair (`USER: ...` plus every following assistant text part) windowed at 1,200 characters with 200 overlap; a turn over 60,000 characters keeps its head and tail. Windows after the first get a `(re: <first 160 chars of the user message>)` header. Tool output and reasoning are not embedded. Top-level user messages are embedded a second time under a `user-messages` scope. Search is a brute-force dot product over an in-memory matrix, top 60.
- Fusion: reciprocal rank fusion with k = 60. `recall_search` keys groups by session, caps each branch at 3 contributing hits per session, and keeps 2 display hits per session. `recall_inspect` keys by message and, in hybrid mode, drops semantic hits below 0.55 cosine before fusing.

Corpus on the reference machine at the time of writing: 4,419 sessions, 418,540 FTS rows, 74,367 chunks averaging 960 characters.

## Measured baseline on the reference machine

Apple M5 Pro, Bun 1.4.2, transformers.js 3.8.1, q8 ONNX. Scripts were run from a temp dir against the live read-only index and then deleted.

| Step | Latency |
| --- | --- |
| Query embedding (bge-small, warm) | 4 ms |
| Brute-force cosine over 74,367 chunks | 31 to 41 ms |
| FTS5 MATCH, 2 or 3 rare terms, top 60 | 1 to 2 ms |
| FTS5 MATCH, one common term (`kubernetes`), top 60 | 34 to 38 ms |
| Load embedding matrix from SQLite (cold start) | 133 ms |

A full hybrid query is therefore under 100 ms warm. Anything added at query time is measured against that number.

## Fusion: RRF versus convex combination

RRF sums `1 / (k + rank)` across rankers. Cormack, Clarke and Buettcher fixed k = 60 "during a pilot investigation"; their Table 1 shows MAP flat from k = 30 to k = 100 (0.2139 to 0.2147) and only degrading at k = 500, so the choice "was not critical". They chose the reciprocal over an exponential so that lower ranks keep some weight, and k exists to "mitigate the impact of high rankings by outlier systems" ([Cormack et al. 2009](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf), SIGIR, DOI 10.1145/1571941.1572114). Elasticsearch ships RRF with `rank_constant` defaulting to 60 and a `rank_window_size` that plays the role of the 60-candidate cut here ([Elastic reference](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion)).

Chen et al. (ECIR 2022) showed lexical plus dense hybrids beat either branch alone, with an average 20.4% relative gain over the dense model and 9.54% over BM25 on out-of-domain sets, and argued for RRF because it needs no score normalization or tuning ([arXiv 2201.10582](https://arxiv.org/abs/2201.10582)).

Bruch, Gai and Ingber (ACM TOIS 2023) re-examined that claim. They found a convex combination of min-max normalized scores (`alpha * semantic + (1 - alpha) * lexical`, alpha = 0.8 tuned once) "significantly outperforms RRF on all datasets in terms of NDCG, and does generally better in terms of Recall", in-domain and out-of-domain; that RRF is in fact parametric (one k per ranker) and a tuned RRF generalizes poorly; and that RRF "disregards the distribution of scores" so two candidates far apart in cosine can fuse identically. The counterweight: tuning alpha needs labeled queries, though they show "just a handful" suffices ([arXiv 2210.11934](https://arxiv.org/abs/2210.11934), DOI 10.1145/3596512).

Reading for this project: RRF at k = 60 is the correct zero-label default and matches what the reference paper and Elasticsearch ship. Convex combination is the better fusion once a labeled query set exists, and switching is a small code change (normalize per query, one weight). Without labels, changing it is guesswork.

One property of the current session-level RRF worth knowing. With k = 60, rank position inside the top 60 barely moves the score: rank 1 is worth 1/61 = 0.0164 and rank 60 is worth 1/120 = 0.0083. Two hits anywhere in a branch's top 60 (at least 2/120 = 0.0167) therefore always outrank one hit at rank 1 in that branch. The `perBranchCap: 3` stops floods, but the count of hits, not their position, decides the order among sessions with more than one hit. For "which session discussed X", a session that touched X in several turns is usually the right answer, so this bias is defensible, but it is a tuning knob (a smaller k inside a branch, or decayed weights for the second and third hit) that should only move with an eval set behind it.

## Rerankers on CPU

Cross-encoders score a (query, passage) pair with a full forward pass, so query-time cost scales with candidates times passage length. Measured here on the M5 Pro, 60 real chunks averaging 1,293 characters (roughly 300 to 350 tokens), q8 ONNX in Bun:

| Model | Layers x hidden | Load | 60 pairs |
| --- | --- | --- | --- |
| `Xenova/ms-marco-MiniLM-L-6-v2` | 6 x 384 | 1.1 s | 0.74 to 1.66 s |
| `Xenova/ms-marco-MiniLM-L-12-v2` | 12 x 384 | 2.1 s | 1.89 to 2.86 s |

Batch size 8 versus 60 made no consistent difference; the later repetitions were slower, not faster, so treat the range as the honest figure. The Sentence Transformers table ranks these two at 74.30 and 74.31 NDCG@10 on TREC DL 19, so L-6 is the one to consider ([sbert pretrained cross-encoders](https://sbert.net/docs/cross_encoder/pretrained_models.html)).

`BAAI/bge-reranker-v2-m3` is a 24-layer, 1,024-hidden XLM-RoBERTa-large derivative with 0.6B parameters (its `config.json` and model card). That is roughly 25x the per-token compute of MiniLM-L-6, so on this CPU 60 pairs would land in the tens of seconds. Not measured; inferred from the layer and width ratio. It is out of the question for an interactive tool on CPU.

`answerdotai/answerai-colbert-small-v1` is a 12 x 384 BERT (33.4M parameters) trained for late interaction; its card reports BEIR 53.79 versus 51.68 for bge-small-en-v1.5 and claims it "vastly outperforms cross-encoders its size" as a reranker ([model card](https://huggingface.co/answerdotai/answerai-colbert-small-v1)). Used as a query-time reranker it costs one BERT-small forward pass per candidate, the same class as the MiniLM figures above. Used as a first-stage index it needs one 96-dim vector per token: at roughly 300 tokens per chunk that is about 58 KB per chunk in fp16 against 1.5 KB for the current single vector, or about 4 GB for the present 74k chunks before residual compression. That is a different storage design, not a drop-in.

Evidence that reranking pays: Anthropic's contextual retrieval write-up reports that adding a reranker over a hybrid BM25 + embedding retrieval cut top-20 retrieval failures from 2.9% to 1.9% across their domains, on top of the 5.7% to 2.9% that hybrid plus contextual chunks achieved ([Anthropic, Sep 2024](https://www.anthropic.com/news/contextual-retrieval); this is a vendor engineering post, cited for its own experiment, and it used a hosted reranker, not a CPU model). LongMemEval, the closest benchmark to this corpus, used no reranker at all.

Reading for this project: a MiniLM-L-6 rerank over the best 2 chunks of the top 25 fused sessions (50 pairs) would add roughly 1 s to a sub-100 ms query on a fast laptop CPU, and more on a small hub box. That is a 10x to 20x latency increase for a gain that no one has measured on this corpus.

## Chunking for turn-based transcripts

LongMemEval (ICLR 2025) is the benchmark closest to this problem: task-oriented user-assistant chat histories of 50 to 500 sessions, questions that require recalling one or more past sessions, retrieval evaluated with Recall@k and NDCG@k. Its findings on granularity ([arXiv 2410.10813](https://arxiv.org/abs/2410.10813), sections 5.2 to 5.4 and appendix E):

- A "round" (one user message plus the assistant response) is the better storage unit than a whole session; compressing to summaries or extracted facts loses information and hurts QA except on multi-session reasoning questions.
- Using the value itself as the key is "a strong baseline"; summaries or keyphrases alone as keys are worse. Appending LLM-extracted user facts to the original text as the key ("K = V + fact") gave the largest single retrieval gain in the paper, +9.4% Recall@k and +5.4% end-to-end accuracy on average.
- Merging at index time (append to the key) beat "rank merging" (separate indexes fused by rank) in their appendix E.3.
- Time-aware query expansion, where an LLM extracts a date range from the query and retrieval is restricted to it, improved temporal-question recall by 11.3% at round granularity and 6.8% at session granularity, but only with a strong LLM doing the extraction.
- Dense retrieval "significantly" outperformed BM25 on this chat corpus (appendix E.2), with a 1.5B embedding model.

Anthropic's contextual retrieval prepends an LLM-written 50 to 100 token situating sentence to each chunk before both embedding and BM25 indexing, and reports a 35% reduction in top-20 retrieval failures from the embedding side alone (5.7% to 3.7%) and 49% combined with BM25 (to 2.9%). They also note that "adding generic document summaries to chunks" gave "very limited gains" ([Anthropic, Sep 2024](https://www.anthropic.com/news/contextual-retrieval)).

Late chunking (Günther et al.) embeds the whole document through a long-context model and pools per chunk afterwards, so each chunk vector carries surrounding context without any LLM call ([arXiv 2409.04701](https://arxiv.org/abs/2409.04701)). It requires a long-context embedding model; bge-small's 512-token limit rules it out without a model change.

Chroma's chunking evaluation measured recall at the token level across five corpora, including a chat-log corpus. With `all-MiniLM-L6-v2` (the same size class as bge-small) the best recall, 0.824, came from 250-token chunks with 125-token overlap, and dropped to 0.771 with the overlap removed, "suggesting that for smaller context, overlapping chunks are necessary for high recall". With `text-embedding-3-large`, 200 to 400 token chunks with no overlap did best and overlap only hurt precision ([Chroma technical report, Jul 2024](https://research.trychroma.com/evaluating-chunking)).

Reading for this project: the current design already follows the strongest findings without an LLM in the loop. The embedded unit is a round. Windows carry a `(re: <user intent>)` header, which is a free, deterministic version of the contextual header idea. 1,200 characters with 200 overlap is about 300 tokens with 50 of overlap, inside the range Chroma found best for a small model and under bge-small's 512-token limit. Segmenting long FTS parts instead of truncating keeps BM25 length normalization honest. The `since` and `until` filters exposed to the calling agent are the LongMemEval time-aware expansion with the calling model, a strong LLM, doing the extraction, which is exactly the configuration the paper found to work.

Two things the current design does not do, both by design and both acceptable for 1.0: tool output and reasoning are lexical-only (only text parts are embedded), and there is no LLM-generated key expansion. The second is the largest evidence-backed quality lever available, but it introduces an LLM dependency into the indexing path with a per-session cost, and LongMemEval's gain came from extracted user facts, not from summaries, so the existing summarizer output would not be the right thing to append.

## Recency and decay weighting

Generative Agents scores memories as `recency + importance + relevance`, each min-max normalized to [0, 1] and weighted 1, with recency an exponential decay of 0.995 per game hour since the memory was last retrieved ([Park et al. 2023](https://arxiv.org/abs/2304.03442), section 4.1). That is a design for an agent living in the present, where "a moment ago or this morning" should stay in view.

No source surveyed benchmarks a recency prior for the task here, which is recalling a specific past conversation that may be months old. LongMemEval treats time as a filter, not a decay, and its temporal questions improved when the search range was narrowed, not when older items were discounted.

Reading for this project: a decay term would work against the main use case ("the X we built" is often old) and there is no evidence for it. Dates are already shown in results and the agent can pass `since`/`until`. Keep time as a filter and a display field, not a score.

## Session-level versus chunk-level scoring

Dai and Callan split long documents into overlapping passages and scored a document by its first passage (FirstP), best passage (MaxP), or sum of passages (SumP); MaxP was their headline configuration ([arXiv 1905.09217](https://arxiv.org/abs/1905.09217), SIGIR 2019). PARADE compared passage aggregation strategies and found that learned aggregation beats max on collections where relevance is spread across the document (Robust04, GOV2), while "less complex aggregation techniques may work better on collections with an information need that can often be pinpointed to a single passage" ([arXiv 2008.09093](https://arxiv.org/abs/2008.09093)).

A recall query usually points at one moment in one session, so the pinpointed case applies and max-style aggregation is the right family. The current fusion is a capped top-3 reciprocal-rank sum per branch per session, which sits between MaxP and SumP: it rewards a session with several relevant turns without letting a 400-turn session win on volume. That is a sensible choice for this corpus. The ordering property noted under "Fusion" (hit count dominating rank position at k = 60) is the one aspect to revisit with data.

The 0.55 cosine floor in `recall_inspect` is the right shape of fix for within-session semantic search, where there is no cross-session competition to bury weak hits. The number itself is model-specific: the bge card describes v1.5 as having a "more reasonable similarity distribution" than v1, which is a reminder that any embedding model change must recalibrate this threshold.

## What would be worth changing, and what it costs

Nothing is required for 1.0. Ranked by evidence-per-cost for later:

1. A labeled query set first. 30 to 50 real recall queries with their known target session, harvested from actual `recall_search` use. Every other item below is a knob whose direction cannot be verified without it, and Bruch et al. showed a handful of labeled queries is enough to tune fusion. Cost: a JSON file and a small script; no runtime change.
2. Cross-encoder rerank of the top fused sessions' best chunks with `ms-marco-MiniLM-L-6-v2`. Measured cost: 0.7 to 1.7 s per query for 50 to 60 pairs on an M5 Pro, plus about 1 s model load and a second resident ONNX model. TypeScript on Bun: no new dependency, transformers.js already runs the embedder in a child process; the reranker rides the same worker. Go: whatever ONNX Runtime binding the embedder already needs (cgo plus a WordPiece tokenizer; no pure-Go path verified) covers the reranker too, so the marginal dependency cost is near zero once embedding exists. Quality gain on this corpus: unmeasured.
3. Convex combination with min-max normalized scores in place of RRF. Cost: a few lines and one weight; needs item 1 to pick the weight. Bruch et al. found it beats RRF on NDCG on every dataset they tried.
4. LLM key expansion (facts or a situating sentence appended to each round before indexing). Largest retrieval gain in the closest benchmark (+9.4% Recall@k), but it puts an LLM call per session into the indexing path with token cost and a provider dependency the hub does not otherwise need. A design decision for a later version, not a tuning change.

Not worth doing: recency decay in the score (no evidence, works against the use case); `bge-reranker-v2-m3` or any XLM-R-large class reranker on CPU (tens of seconds inferred); ColBERT as a first-stage index (storage rises from about 1.5 KB to about 58 KB per chunk before compression).

## Sources

- Cormack, Clarke, Buettcher. Reciprocal rank fusion outperforms Condorcet and individual rank learning methods. SIGIR 2009. https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf
- Bruch, Gai, Ingber. An analysis of fusion functions for hybrid retrieval. ACM TOIS 2023. https://arxiv.org/abs/2210.11934
- Chen, Zhang, Lu, Bendersky, Najork. Out-of-domain semantics to the rescue! Zero-shot hybrid retrieval models. ECIR 2022. https://arxiv.org/abs/2201.10582
- Elastic. Reciprocal rank fusion reference. https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion
- Wu et al. LongMemEval: benchmarking chat assistants on long-term interactive memory. ICLR 2025. https://arxiv.org/abs/2410.10813
- Anthropic. Introducing contextual retrieval. Sep 2024. https://www.anthropic.com/news/contextual-retrieval
- Günther et al. Late chunking: contextual chunk embeddings using long-context embedding models. https://arxiv.org/abs/2409.04701
- Smith, Troynikov. Evaluating chunking strategies for retrieval. Chroma technical report, Jul 2024. https://research.trychroma.com/evaluating-chunking
- Park et al. Generative agents: interactive simulacra of human behavior. 2023. https://arxiv.org/abs/2304.03442
- Dai, Callan. Deeper text understanding for IR with contextual neural language modeling. SIGIR 2019. https://arxiv.org/abs/1905.09217
- Li et al. PARADE: passage representation aggregation for document reranking. https://arxiv.org/abs/2008.09093
- Sentence Transformers. Pretrained cross-encoder models. https://sbert.net/docs/cross_encoder/pretrained_models.html
- Hugging Face model cards and `config.json`: BAAI/bge-small-en-v1.5, BAAI/bge-reranker-v2-m3, answerdotai/answerai-colbert-small-v1, cross-encoder/ms-marco-MiniLM-L6-v2, cross-encoder/ms-marco-MiniLM-L12-v2.
- SQLite FTS5 documentation, sections 4.3 (tokenizers) and 5.1.1 (bm25). https://sqlite.org/fts5.html
- Local measurements: Bun 1.4.2, transformers.js 3.8.1, Apple M5 Pro, against the live index at `~/.local/share/opencode-recall/index.db` on 2026-09-16.
