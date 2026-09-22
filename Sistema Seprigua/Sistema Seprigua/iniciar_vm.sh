#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
[[ -f .env ]] || { echo "[ERROR] Falta .env. Ejecuta preparar_vm.sh primero." >&2; exit 1; }
[[ -x .venv/bin/python ]] || { echo "[ERROR] Falta .venv. Ejecuta preparar_vm.sh primero." >&2; exit 1; }
exec .venv/bin/python -m backend.run_waitress
