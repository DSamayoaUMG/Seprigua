#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

. .venv/bin/activate
python -m pip install --disable-pip-version-check -q -r requirements.txt

if [ ! -f ".env" ]; then
  echo "[ERROR] Falta el archivo .env."
  exit 1
fi

exec waitress-serve --listen=0.0.0.0:5000 backend.app:app
