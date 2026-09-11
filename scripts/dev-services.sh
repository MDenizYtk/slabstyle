#!/usr/bin/env bash
# Yerel geliştirme servislerini (PostgreSQL 17 + Redis) başlatır. macOS / Homebrew.
# Not: Bu makinede brew services ile Postgres "multithreaded during startup"
# hatası verdiği için LC_ALL ayarlanarak pg_ctl ile başlatılır.
set -euo pipefail

PG_BIN=/opt/homebrew/opt/postgresql@17/bin
PG_DATA=/opt/homebrew/var/postgresql@17

if "$PG_BIN/pg_isready" -h localhost -q; then
  echo "PostgreSQL zaten çalışıyor"
else
  LC_ALL=en_US.UTF-8 "$PG_BIN/pg_ctl" -D "$PG_DATA" -l /opt/homebrew/var/log/postgresql@17.log start
fi

if /opt/homebrew/opt/redis/bin/redis-cli ping >/dev/null 2>&1; then
  echo "Redis zaten çalışıyor"
else
  mkdir -p /opt/homebrew/var/db/redis
  /opt/homebrew/opt/redis/bin/redis-server --daemonize yes --port 6379 --bind 127.0.0.1 \
    --dir /opt/homebrew/var/db/redis --logfile /opt/homebrew/var/log/redis.log
  echo "Redis başlatıldı"
fi
