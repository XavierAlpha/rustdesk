import { Logger } from '../core/logger';
import { SecretBoxCipher } from './crypto';

export type TransportState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

type MessageHandler = (data: Uint8Array) => void;

export class WebSocketTransport {
  private socket?: WebSocket;
  private state: TransportState = 'idle';
  private readonly logger: Logger;
  private readonly handlers: MessageHandler[] = [];
  private cipher?: SecretBoxCipher;

  constructor(scope = 'transport') {
    this.logger = new Logger(scope);
  }

  getState(): TransportState {
    return this.state;
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const index = this.handlers.indexOf(handler);
      if (index >= 0) {
        this.handlers.splice(index, 1);
      }
    };
  }

  setCipher(cipher?: SecretBoxCipher): void {
    this.cipher = cipher;
  }

  async connect(url: string): Promise<void> {
    if (this.socket && this.state === 'open') {
      return;
    }
    this.state = 'connecting';
    return new Promise((resolve, reject) => {
      try {
        const socket = new WebSocket(url);
        socket.binaryType = 'arraybuffer';
        socket.onopen = () => {
          this.socket = socket;
          this.state = 'open';
          this.logger.info(`WebSocket connected: ${url}`);
          resolve();
        };
        socket.onerror = (event) => {
          this.state = 'error';
          this.logger.error(`WebSocket error: ${url}`);
          reject(event);
        };
        socket.onclose = () => {
          this.state = 'closed';
          this.logger.warn(`WebSocket closed: ${url}`);
        };
        socket.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            let payload = new Uint8Array(event.data);
            if (this.cipher) {
              try {
                payload = this.cipher.decrypt(payload);
              } catch (err) {
                this.logger.error('Failed to decrypt WebSocket payload', err);
                return;
              }
            }
            for (const handler of this.handlers) {
              handler(payload);
            }
          }
        };
      } catch (err) {
        this.state = 'error';
        reject(err);
      }
    });
  }

  send(data: Uint8Array): void {
    if (!this.socket || this.state !== 'open') {
      this.logger.warn('send() ignored because socket not open');
      return;
    }
    const payload = this.cipher ? this.cipher.encrypt(data) : data;
    this.socket.send(payload);
  }

  close(): void {
    if (this.socket) {
      this.socket.close();
    }
    this.state = 'closed';
  }
}
