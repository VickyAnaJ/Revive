import {
  SerialFrameSchema,
  SerialReadyFrameSchema,
  SerialCeilingFrameSchema,
  type SerialFrame,
  type SerialReadyFrame,
  type SerialCeilingFrame,
} from '@/types/contracts';

type SerialPortLike = {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  readable: ReadableStream<BufferSource> | null;
};

type SerialNavigator = {
  serial: {
    requestPort: () => Promise<SerialPortLike>;
  };
};

export type PeakEvent = CustomEvent<SerialFrame>;
export type ReadyEvent = CustomEvent<SerialReadyFrame>;
export type CeilingEvent = CustomEvent<SerialCeilingFrame>;
export type DisconnectEvent = Event;

export class SerialBridge extends EventTarget {
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private buffer = '';
  private parseErrorCount = 0;

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  async connect(): Promise<void> {
    if (!SerialBridge.isSupported()) {
      throw new Error(
        'Web Serial API not available in this browser. Use alt+shift+space to enable keyboard mode.',
      );
    }
    const nav = navigator as unknown as SerialNavigator;
    const port = await nav.serial.requestPort();
    await port.open({ baudRate: 115200 });
    this.port = port;
    if (!port.readable) {
      throw new Error('Serial port opened without a readable stream.');
    }
    const decoder = new TextDecoderStream();
    port.readable.pipeTo(decoder.writable).catch(() => {
      this.handleDisconnect();
    });
    this.reader = decoder.readable.getReader();
    void this.readLoop();
    console.info('[C2] serial connected');
  }

  async disconnect(): Promise<void> {
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        /* swallow; we are tearing down */
      }
      this.reader = null;
    }
    if (this.port) {
      try {
        await this.port.close();
      } catch {
        /* swallow; we are tearing down */
      }
      this.port = null;
    }
    console.info('[C2] serial disconnected');
  }

  private async readLoop(): Promise<void> {
    while (this.reader) {
      try {
        const { value, done } = await this.reader.read();
        if (done) {
          this.handleDisconnect();
          return;
        }
        if (value) this.processChunk(value);
      } catch (err) {
        console.warn('[C2] read error', err);
        this.handleDisconnect();
        return;
      }
    }
  }

  processChunk(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) this.parseLine(line.trim());
  }

  parseLine(line: string): void {
    if (!line) return;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      this.parseErrorCount += 1;
      console.warn('[C2] non-JSON line dropped', line);
      return;
    }

    if (typeof obj === 'object' && obj !== null) {
      const tagged = obj as Record<string, unknown>;
      if (tagged.debug === true || typeof tagged.diag === 'string') {
        return;
      }
    }

    const ceiling = SerialCeilingFrameSchema.safeParse(obj);
    if (ceiling.success) {
      this.dispatchEvent(new CustomEvent<SerialCeilingFrame>('ceiling', { detail: ceiling.data }));
      return;
    }

    const ready = SerialReadyFrameSchema.safeParse(obj);
    if (ready.success) {
      this.dispatchEvent(new CustomEvent<SerialReadyFrame>('ready', { detail: ready.data }));
      return;
    }

    const peak = SerialFrameSchema.safeParse(obj);
    if (peak.success) {
      this.dispatchEvent(new CustomEvent<SerialFrame>('peak', { detail: peak.data }));
      return;
    }

    this.parseErrorCount += 1;
    console.warn('[C2] schema validation failed', line);
  }

  private handleDisconnect(): void {
    this.dispatchEvent(new Event('disconnect'));
    console.info('[C2] disconnect detected');
  }

  getParseErrorCount(): number {
    return this.parseErrorCount;
  }
}
