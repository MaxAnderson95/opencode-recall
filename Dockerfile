# The hub, as `bun packages/hub/build.ts` compiles it, with the pinned embedding model baked in.
# glibc is required by onnxruntime-node, so the images are Debian rather than Alpine.
FROM oven/bun:1.4.2-debian@sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73 AS build
WORKDIR /src
COPY package.json bun.lock ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/hub/package.json packages/hub/
COPY packages/plugin/package.json packages/plugin/
COPY tools/eval/package.json tools/eval/
RUN bun install --frozen-lockfile --filter @opencode-recall/hub
COPY packages/protocol packages/protocol
COPY packages/hub packages/hub
RUN bun packages/hub/build.ts /out
WORKDIR /src/packages/hub
RUN bun --eval 'import { Effect } from "effect"; import { Embedder } from "./src/embedder.ts"; await Effect.runPromise(Effect.flatMap(Embedder.Service, (e) => e.load).pipe(Effect.provide(Embedder.onnx("/out/models"))))'

FROM debian:trixie-slim@sha256:a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a
LABEL org.opencontainers.image.source=https://github.com/MaxAnderson95/opencode-recall
# sqlite3 takes the online backups the operations guide describes.
RUN apt-get update \
  && apt-get install -y --no-install-recommends sqlite3 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --uid 10001 --no-create-home --home-dir /data --shell /usr/sbin/nologin recall \
  && mkdir /data \
  && chown recall /data
COPY --from=build /out/libonnxruntime.so.1 /usr/local/lib/
RUN ldconfig
COPY --from=build /out/opencode-recall-hub /usr/local/bin/
COPY --from=build /out/models /opt/opencode-recall/models
USER recall
ENV OPENCODE_RECALL_DATA_DIR=/data \
  OPENCODE_RECALL_MODELS_DIR=/opt/opencode-recall/models \
  OPENCODE_RECALL_LISTEN=0.0.0.0:7438
VOLUME /data
EXPOSE 7438
ENTRYPOINT ["opencode-recall-hub"]
CMD ["serve"]
