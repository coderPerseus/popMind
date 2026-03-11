#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"
target_dir="${1:-$project_root}"

if [[ ! -d "$target_dir" ]]; then
  echo "Directory not found: $target_dir" >&2
  exit 1
fi

find "$target_dir" \
  \( -name node_modules -o -name build -o -name out -o -name .git \) -prune -o \
  -type f \
  \( \
  -iname '*.png' -o \
  -iname '*.jpg' -o \
  -iname '*.jpeg' -o \
  -iname '*.gif' -o \
  -iname '*.svg' -o \
  -iname '*.webp' -o \
  -iname '*.bmp' -o \
  -iname '*.ico' -o \
  -iname '*.avif' -o \
  -iname '*.tif' -o \
  -iname '*.tiff' \
  \) \
  -exec dirname {} \; | sort -u
