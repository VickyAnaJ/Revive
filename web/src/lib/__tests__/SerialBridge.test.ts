import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SerialBridge } from '../SerialBridge';
import type { SerialFrame, SerialReadyFrame, SerialCeilingFrame } from '@/types/contracts';

describe('SerialBridge.parseLine (Step 5 unit test a: zod schema rejects malformed JSON)', () => {
  let bridge: SerialBridge;

  beforeEach(() => {
    bridge = new SerialBridge();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('emits a peak event for a valid SerialFrame', () => {
    const peak = vi.fn();
    bridge.addEventListener('peak', peak as EventListener);
    bridge.parseLine('{"depth":0.245,"rate":110,"ts":12345}');
    expect(peak).toHaveBeenCalledOnce();
    const detail = (peak.mock.calls[0][0] as CustomEvent<SerialFrame>).detail;
    expect(detail).toEqual({ depth: 0.245, rate: 110, ts: 12345 });
  });

  it('emits a ready event for a SerialReadyFrame', () => {
    const ready = vi.fn();
    bridge.addEventListener('ready', ready as EventListener);
    bridge.parseLine('{"type":"ready","fw":"revive-1.0"}');
    expect(ready).toHaveBeenCalledOnce();
    const detail = (ready.mock.calls[0][0] as CustomEvent<SerialReadyFrame>).detail;
    expect(detail.fw).toBe('revive-1.0');
  });

  it('emits a ceiling event for a SerialCeilingFrame', () => {
    const ceiling = vi.fn();
    bridge.addEventListener('ceiling', ceiling as EventListener);
    bridge.parseLine('{"type":"ceiling","ts":99999}');
    expect(ceiling).toHaveBeenCalledOnce();
    const detail = (ceiling.mock.calls[0][0] as CustomEvent<SerialCeilingFrame>).detail;
    expect(detail.ts).toBe(99999);
  });

  it('drops a malformed JSON line and increments parse error count', () => {
    const peak = vi.fn();
    bridge.addEventListener('peak', peak as EventListener);
    bridge.parseLine('{"depth":0.245,"rate":');
    expect(peak).not.toHaveBeenCalled();
    expect(bridge.getParseErrorCount()).toBe(1);
  });

  it('drops a peak frame with out-of-range depth', () => {
    const peak = vi.fn();
    bridge.addEventListener('peak', peak as EventListener);
    bridge.parseLine('{"depth":1.5,"rate":110,"ts":12345}');
    expect(peak).not.toHaveBeenCalled();
    expect(bridge.getParseErrorCount()).toBe(1);
  });

  it('silently ignores debug frames', () => {
    const peak = vi.fn();
    bridge.addEventListener('peak', peak as EventListener);
    bridge.parseLine('{"debug":true,"raw":234,"ewma":230}');
    expect(peak).not.toHaveBeenCalled();
    expect(bridge.getParseErrorCount()).toBe(0);
  });

  it('silently ignores diag frames', () => {
    const peak = vi.fn();
    bridge.addEventListener('peak', peak as EventListener);
    bridge.parseLine('{"diag":"peak","ewma_max":250,"interval_ms":600}');
    expect(peak).not.toHaveBeenCalled();
    expect(bridge.getParseErrorCount()).toBe(0);
  });

  it('skips empty lines without raising parse errors', () => {
    const peak = vi.fn();
    bridge.addEventListener('peak', peak as EventListener);
    bridge.parseLine('');
    expect(peak).not.toHaveBeenCalled();
    expect(bridge.getParseErrorCount()).toBe(0);
  });
});

describe('SerialBridge.processChunk (Step 5 integration test: mock stream)', () => {
  it('reassembles split lines across chunks and emits one event per complete line', () => {
    const bridge = new SerialBridge();
    const peak = vi.fn();
    bridge.addEventListener('peak', peak as EventListener);

    bridge.processChunk('{"depth":0.2,"rate":100,"ts":1}\n{"depth":0.3,"rate');
    expect(peak).toHaveBeenCalledOnce();

    bridge.processChunk('":105,"ts":2}\n');
    expect(peak).toHaveBeenCalledTimes(2);

    const second = (peak.mock.calls[1][0] as CustomEvent<SerialFrame>).detail;
    expect(second).toEqual({ depth: 0.3, rate: 105, ts: 2 });
  });

  it('emits N events for N complete lines in one chunk', () => {
    const bridge = new SerialBridge();
    const peak = vi.fn();
    bridge.addEventListener('peak', peak as EventListener);

    const chunk = [
      '{"depth":0.2,"rate":100,"ts":1}',
      '{"depth":0.25,"rate":110,"ts":2}',
      '{"depth":0.3,"rate":120,"ts":3}',
      '',
    ].join('\n');
    bridge.processChunk(chunk);
    expect(peak).toHaveBeenCalledTimes(3);
  });
});

describe('SerialBridge.isSupported (Step 5 edge case: Web Serial unavailable)', () => {
  it('returns false when navigator.serial is missing', () => {
    expect(SerialBridge.isSupported()).toBe(false);
  });
});

describe('SerialBridge contract round-trip (Step 5 contract test: real T1 firmware lines)', () => {
  it('parses recorded peak frames from the T1 hardware capture', () => {
    const bridge = new SerialBridge();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const peak = vi.fn();
    bridge.addEventListener('peak', peak as EventListener);

    const recordedLines = [
      '{"depth":0.246923,"rate":59,"ts":16453}',
      '{"depth":0.250576,"rate":105,"ts":17023}',
      '{"depth":0.243689,"rate":136,"ts":17463}',
      '{"depth":0.241317,"rate":117,"ts":18393}',
    ];
    bridge.processChunk(recordedLines.join('\n') + '\n');
    expect(peak).toHaveBeenCalledTimes(recordedLines.length);

    const detail = (peak.mock.calls[1][0] as CustomEvent<SerialFrame>).detail;
    expect(detail.rate).toBe(105);
    expect(detail.ts).toBe(17023);
  });

  it('parses recorded ready and ceiling frames from the T1 hardware capture', () => {
    const bridge = new SerialBridge();
    const ready = vi.fn();
    const ceiling = vi.fn();
    bridge.addEventListener('ready', ready as EventListener);
    bridge.addEventListener('ceiling', ceiling as EventListener);

    bridge.processChunk('{"type":"ready","fw":"revive-1.0"}\n{"type":"ceiling","ts":35038}\n');
    expect(ready).toHaveBeenCalledOnce();
    expect(ceiling).toHaveBeenCalledOnce();
  });
});
