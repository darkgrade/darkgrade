#!/bin/bash
cd /Users/kevinschaich/repositories/jpglab/fuse
bun run build 2>&1 | tee build.log
echo "Build exit code: $?"