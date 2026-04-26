// Arduino -> Browser serial frame schema (FR1).
// Per design §6f Contract Registry "Arduino → Browser (C1 → C2)".
// Mirror of contracts/serial.py.
import { z } from 'zod';

export const SerialFrameSchema = z.object({
  // Compression depth in normalized 0.0 to 1.0 range (1.0 ≈ AHA target).
  depth: z.number().min(0).max(1),
  // Rolling compression rate in BPM.
  rate: z.number().int().min(0).max(220),
  // Arduino millis() timestamp.
  ts: z.number().int().nonnegative(),
});

export type SerialFrame = z.infer<typeof SerialFrameSchema>;

// Arduino -> Browser ready frame, sent once on boot.
export const SerialReadyFrameSchema = z.object({
  type: z.literal('ready'),
  fw: z.string(),
});

export type SerialReadyFrame = z.infer<typeof SerialReadyFrameSchema>;

// Arduino -> Browser ceiling event, emitted when sustained force above the firmware
// ceiling threshold for ≥ 250 ms (force_ceiling per design §6c FR1). One event per
// breach; the firmware latches until ewma drops below the ceiling threshold.
export const SerialCeilingFrameSchema = z.object({
  type: z.literal('ceiling'),
  ts: z.number().int().nonnegative(),
});

export type SerialCeilingFrame = z.infer<typeof SerialCeilingFrameSchema>;
