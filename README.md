# opencode-recall

> [!WARNING]
> This project is a work in progress. It is still being built and is not ready for use.

Shared conversation memory for OpenCode across multiple machines. A central recall service holds an archive of every OpenCode session from every host; a thin OpenCode plugin on each host uploads finished sessions and exposes `recall_*` tools that query the service.

This project replaces the single-machine recall plugin in `my-opencode-setup/plugins/recall`.

Planning happens on the Wayfinder map in this repo's issues (label `wayfinder:map`).
