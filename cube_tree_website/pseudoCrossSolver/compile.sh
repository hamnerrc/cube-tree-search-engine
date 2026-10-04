#!/bin/bash
# Build pseudo.js / pseudo.wasm (non-MODULARIZE; worker3.js and the Node
# helper pre-set globalThis.Module). Flags reproduce the upstream build: a
# rebuild of the unmodified upstream pseudo.cpp with them gave output
# identical to the shipped binary (PROJECT_STATUS.md §4.23).
set -e
source "$HOME/emsdk/emsdk_env.sh"
cd "$(dirname "$0")"
em++ pseudo.cpp -o pseudo.js -O3 --bind -s ALLOW_MEMORY_GROWTH=1
ls -lh pseudo.js pseudo.wasm
