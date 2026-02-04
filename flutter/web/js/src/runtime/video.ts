import { Logger } from '../core/logger';

export type CodecType = 'vp9' | 'av1' | 'h264' | 'h265';

type DecodeInput = {
  codec: CodecType;
  display: number;
  data: Uint8Array;
  key: boolean;
  pts?: number | string;
};

type RgbaSink = (display: number, rgba: Uint8Array) => void;

const CODEC_CONFIG: Record<CodecType, string[]> = {
  vp9: ['vp09.00.10.08'],
  av1: ['av01.0.08M.08', 'av01.0.04M.08'],
  h264: ['avc1.42E01E', 'avc1.4D401E', 'avc1.64001F'],
  h265: [
    'hvc1.1.6.L93.B0',
    'hvc1.1.6.L120.B0',
    'hev1.1.6.L93.B0',
    'hev1.1.6.L120.B0'
  ]
};

export class VideoPipeline {
  private readonly logger = new Logger('video');
  private readonly decoders = new Map<string, VideoDecoder>();
  private readonly canvases = new Map<number, OffscreenCanvas | HTMLCanvasElement>();
  private readonly sink: RgbaSink;

  constructor(sink: RgbaSink) {
    this.sink = sink;
  }

  async decode(input: DecodeInput): Promise<void> {
    if (typeof VideoDecoder === 'undefined') {
      this.logger.error('WebCodecs VideoDecoder is not available');
      return;
    }
    const decoder = await this.ensureDecoder(input.codec, input.display);
    if (!decoder) {
      return;
    }
    const timestamp =
      typeof input.pts === 'string' ? Number(input.pts) : input.pts ?? 0;
    const chunk = new EncodedVideoChunk({
      type: input.key ? 'key' : 'delta',
      timestamp,
      data: input.data
    });
    try {
      decoder.decode(chunk);
    } catch (err) {
      this.logger.error('Video decode failed', err);
    }
  }

  close(): void {
    for (const decoder of this.decoders.values()) {
      decoder.close();
    }
    this.decoders.clear();
    this.canvases.clear();
  }

  private async ensureDecoder(codec: CodecType, display: number): Promise<VideoDecoder | null> {
    const key = `${display}:${codec}`;
    const existing = this.decoders.get(key);
    if (existing) {
      return existing;
    }
    const config = await this.pickConfig(codec);
    if (!config) {
      return null;
    }
    const decoder = new VideoDecoder({
      output: (frame) => this.handleFrame(display, frame),
      error: (err) => this.logger.error('VideoDecoder error', err)
    });
    decoder.configure({ codec: config, optimizeForLatency: true });
    this.decoders.set(key, decoder);
    return decoder;
  }

  private async pickConfig(codec: CodecType): Promise<string | null> {
    for (const candidate of CODEC_CONFIG[codec]) {
      try {
        const supported = await VideoDecoder.isConfigSupported({ codec: candidate });
        if (supported.supported) {
          return candidate;
        }
      } catch (err) {
        this.logger.warn(`Codec probe failed: ${candidate}`, err);
      }
    }
    this.logger.warn(`No supported codec found for ${codec}`);
    return null;
  }

  private handleFrame(display: number, frame: VideoFrame): void {
    try {
      const width = frame.displayWidth;
      const height = frame.displayHeight;
      if (width === 0 || height === 0) {
        frame.close();
        return;
      }
      const canvas = this.ensureCanvas(display, width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        frame.close();
        return;
      }
      ctx.drawImage(frame, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      const rgba = new Uint8Array(imageData.data.length);
      rgba.set(imageData.data);
      this.sink(display, rgba);
    } catch (err) {
      this.logger.error('Failed to render video frame', err);
    } finally {
      frame.close();
    }
  }

  private ensureCanvas(
    display: number,
    width: number,
    height: number
  ): OffscreenCanvas | HTMLCanvasElement {
    const existing = this.canvases.get(display);
    if (existing) {
      if (existing.width !== width || existing.height !== height) {
        existing.width = width;
        existing.height = height;
      }
      return existing;
    }
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(width, height);
    } else {
      const element = document.createElement('canvas');
      element.width = width;
      element.height = height;
      canvas = element;
    }
    this.canvases.set(display, canvas);
    return canvas;
  }
}
