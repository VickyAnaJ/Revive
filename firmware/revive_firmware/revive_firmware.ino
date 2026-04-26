// Revive C1 ArduinoFirmware (FR1)
// Target: Arduino Uno R4 Minima (ABX00080)
// Per design §6d C1 plus §6f Arduino → Browser contract.
//
// Behavior:
//   - Sample FSR on A0 at 200 Hz
//   - EWMA smooth with alpha = 0.3
//   - Local-maxima peak detection: track running max while ewma rises;
//     fire one peak frame when ewma drops by kPeakDropThreshold from the running max
//   - Emit JSON line per peak: {"depth": float, "rate": int, "ts": int}
//   - Emit one ready frame on boot: {"type":"ready","fw":"revive-1.0"}
//   - 250 ms safety timeout: zero output if no valid peak for 250 ms (Shepherd pattern)
//
// Wiring per docs/hardware-bom.md:
//   FSR Pin 1 -> Arduino 5V
//   FSR Pin 2 -> Arduino A0 + 10k resistor -> GND
//
// Library: ArduinoJson 7.4.x via Library Manager.

#include <ArduinoJson.h>

// Firmware thresholds are deliberately permissive: emit a peak frame for almost any
// blip above noise. Per-user calibration (start, target, max, ceiling) lives in the
// browser via C10 Calibrator + C4 CompressionScorer per design §6d.
//
// kStartThreshold just needs to clear the noise floor (~30-50 with foam).
// kPeakDropThreshold is the rise-then-fall delta that confirms a real compression.
// kCeilingThreshold is conservative; browser side classifies force_ceiling per user max.
constexpr int kStartThreshold = 80;             // running max must clear this for a peak to count
constexpr int kPeakDropThreshold = 30;          // ewma must fall this far from running max to fire a peak
constexpr int kRearmRiseThreshold = 30;         // ewma must rise this far from a local min to arm next peak
constexpr int kCeilingThreshold = 200;          // raw FSR; browser ceiling is per-user via C10
constexpr unsigned long kSafetyTimeoutMs = 250; // Shepherd pattern; zero output if silent
constexpr unsigned long kSampleIntervalUs = 5000;  // 200 Hz
constexpr unsigned long kPeakDebounceMs = 150;  // suppress double-fire from hand wobble within one compression
constexpr float kEwmaAlpha = 0.3f;
constexpr float kFsrMaxNormalize = 1023.0f;

// State.
float ewma = 0.0f;
float maxSinceLastPeak = 0.0f;
float minSinceLastPeak = 1024.0f;
unsigned long maxTimeMs = 0;
unsigned long lastPeakTimeMs = 0;
unsigned long peakIntervalMs = 0;
unsigned long lastSampleUs = 0;
unsigned long ceilingHoldStartMs = 0;
bool armed = true;                              // armed = ready to detect next peak
bool zeroEmitted = false;

// Reusable JSON document; heap allocated once per ArduinoJson 7 model.
JsonDocument doc;

void emitFrame(float normalizedDepth, int rateBpm, unsigned long ts) {
  doc.clear();
  doc["depth"] = normalizedDepth;
  doc["rate"] = rateBpm;
  doc["ts"] = ts;
  serializeJson(doc, Serial);
  Serial.println();
}

void emitReady() {
  doc.clear();
  doc["type"] = "ready";
  doc["fw"] = "revive-1.0";
  serializeJson(doc, Serial);
  Serial.println();
}

void emitCeilingEvent(unsigned long ts) {
  doc.clear();
  doc["type"] = "ceiling";
  doc["ts"] = ts;
  serializeJson(doc, Serial);
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  while (!Serial) {
    delay(10);
  }
  emitReady();
  lastSampleUs = micros();
}

int rateFromInterval(unsigned long intervalMs) {
  if (intervalMs == 0) return 0;
  return (int)(60000UL / intervalMs);
}

void loop() {
  const unsigned long nowUs = micros();
  if (nowUs - lastSampleUs < kSampleIntervalUs) return;
  lastSampleUs = nowUs;
  const unsigned long nowMs = millis();

  // Sample + EWMA smooth.
  const int raw = analogRead(A0);
  ewma = kEwmaAlpha * (float)raw + (1.0f - kEwmaAlpha) * ewma;

  // TEMPORARY DEBUG: print raw + ewma when above noise floor.
  // Remove once thresholds are calibrated.
  static unsigned long lastDebugMs = 0;
  if (raw > 30 && nowMs - lastDebugMs > 100) {
    lastDebugMs = nowMs;
    Serial.print("{\"debug\":true,\"raw\":");
    Serial.print(raw);
    Serial.print(",\"ewma\":");
    Serial.print((int)ewma);
    Serial.println("}");
  }

  // Force ceiling detection (sustained 250 ms above kCeilingThreshold).
  // Latch: once fired, do not fire again until ewma drops below the threshold.
  static bool ceilingLatched = false;
  if (ewma > kCeilingThreshold) {
    if (!ceilingLatched) {
      if (ceilingHoldStartMs == 0) {
        ceilingHoldStartMs = nowMs;
      } else if (nowMs - ceilingHoldStartMs > 250) {
        emitCeilingEvent(nowMs);
        ceilingLatched = true;
        ceilingHoldStartMs = 0;
      }
    }
  } else {
    ceilingHoldStartMs = 0;
    ceilingLatched = false;
  }

  // Local-maxima peak detection with armed state machine.
  //
  // Armed phase: track running max as ewma rises. Fire a peak when ewma drops
  // by kPeakDropThreshold from the running max. After firing, disarm.
  //
  // Disarmed phase: track running min as ewma falls (recoil). Re-arm when
  // ewma rises by kRearmRiseThreshold above the running min, indicating the
  // start of a new compression. This blocks phantom peaks during recoil and
  // distinguishes held pressure (no rise above min) from real CPR cadence.
  if (armed) {
    if (ewma > maxSinceLastPeak) {
      maxSinceLastPeak = ewma;
      maxTimeMs = nowMs;
    }

    const bool inDebounce = (lastPeakTimeMs != 0) && (nowMs - lastPeakTimeMs < kPeakDebounceMs);
    const bool peakFired = (maxSinceLastPeak > kStartThreshold) &&
                           ((maxSinceLastPeak - ewma) > kPeakDropThreshold) &&
                           !inDebounce;

    if (peakFired) {
      if (lastPeakTimeMs != 0) {
        peakIntervalMs = maxTimeMs - lastPeakTimeMs;
      }
      lastPeakTimeMs = maxTimeMs;
      const int rate = peakIntervalMs > 0 ? rateFromInterval(peakIntervalMs) : 0;
      const float normalizedDepth = maxSinceLastPeak / kFsrMaxNormalize;

      Serial.print("{\"diag\":\"peak\",\"ewma_max\":");
      Serial.print((int)maxSinceLastPeak);
      Serial.print(",\"interval_ms\":");
      Serial.print(peakIntervalMs);
      Serial.println("}");

      emitFrame(normalizedDepth, rate, maxTimeMs);

      armed = false;
      minSinceLastPeak = ewma;
      zeroEmitted = false;
    }
  } else {
    if (ewma < minSinceLastPeak) {
      minSinceLastPeak = ewma;
    }

    if ((ewma - minSinceLastPeak) > kRearmRiseThreshold) {
      armed = true;
      maxSinceLastPeak = ewma;
      maxTimeMs = nowMs;
    }
  }

  // Safety timeout: emit a single zero frame if no peak for kSafetyTimeoutMs.
  if (lastPeakTimeMs != 0 && (nowMs - lastPeakTimeMs) > kSafetyTimeoutMs && !zeroEmitted) {
    emitFrame(0.0f, 0, nowMs);
    zeroEmitted = true;
  }
}
