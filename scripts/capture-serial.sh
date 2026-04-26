#!/usr/bin/env bash
# Capture serial output from the Arduino into a file for offline analysis.
#
# Usage:
#   bash revive/scripts/capture-serial.sh                  # 10 second window
#   bash revive/scripts/capture-serial.sh 20               # 20 second window
#
# IMPORTANT: close the Arduino IDE Serial Monitor before running, or this will
# fail to open the port (only one process at a time can hold a serial port).
set -euo pipefail

DURATION="${1:-10}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/data/local/serial-capture.log"
mkdir -p "$(dirname "$OUT")"

# Find the Arduino port. Look for cu.usbmodem* (macOS naming).
PORT=""
for p in /dev/cu.usbmodem*; do
  if [ -e "$p" ]; then
    PORT="$p"
    break
  fi
done
if [ -z "$PORT" ]; then
  echo "error: no /dev/cu.usbmodem* port found. Is the Arduino plugged in?" >&2
  exit 1
fi

echo "port: $PORT"
echo "duration: ${DURATION}s"
echo "output: $OUT"
echo

# Configure the port at 115200 baud, 8N1, no flow control.
stty -f "$PORT" 115200 cs8 -cstopb -parenb -ixon -ixoff || {
  echo "error: stty failed. Is Arduino IDE Serial Monitor open? Close it and retry." >&2
  exit 1
}

echo "press the FSR pad now. capture will stop in ${DURATION}s."
echo

# Capture. timeout(1) is from coreutils on macOS; if missing, install via brew install coreutils.
if command -v timeout >/dev/null 2>&1; then
  timeout "${DURATION}s" cat "$PORT" > "$OUT" || true
elif command -v gtimeout >/dev/null 2>&1; then
  gtimeout "${DURATION}s" cat "$PORT" > "$OUT" || true
else
  # Fallback: spawn cat, sleep, then kill.
  cat "$PORT" > "$OUT" &
  CAT_PID=$!
  sleep "${DURATION}"
  kill "$CAT_PID" 2>/dev/null || true
  wait "$CAT_PID" 2>/dev/null || true
fi

LINES=$(wc -l < "$OUT" | tr -d ' ')
BYTES=$(wc -c < "$OUT" | tr -d ' ')
echo
echo "captured ${LINES} lines, ${BYTES} bytes"
echo "file: $OUT"
echo
echo "tell Claude: 'capture done at revive/data/local/serial-capture.log'"
