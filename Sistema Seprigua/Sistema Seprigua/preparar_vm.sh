#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
[[ -f .env ]] || { echo "[ERROR] Copia .env.example a .env y completa la configuración." >&2; exit 1; }
if [[ ! -x .venv/bin/python ]]; then python3 -m venv .venv; fi
.venv/bin/python -m pip install --disable-pip-version-check --upgrade pip
.venv/bin/python -m pip install --disable-pip-version-check -r requirements.txt
.venv/bin/python -m backend.diagnostico
echo "[OK] SEPRIGUA preparado."
