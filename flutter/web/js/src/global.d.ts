import type { CamelliaConfig } from './core/config';

declare global {
  interface Window {
    __CAMELLIA_WEB__?: CamelliaConfig;
    __CAMELLIA_WEB_BRIDGE__?: Record<string, unknown>;
    setByName?: (name: string, arg0?: unknown, arg1?: unknown) => string | void;
    getByName?: (name: string, arg0?: unknown) => string;
    init?: () => void;
    isMobile?: () => boolean;
    onInitFinished?: () => void;
    onGlobalEvent?: (payload: string) => void;
    onRegisteredEvent?: (payload: string) => void;
    onFullscreenChanged?: (value: boolean) => void;
    onRgba?: (display: number, rgba: Uint8Array) => void;
    onLoadAbFinished?: (payload: string) => void;
    onLoadGroupFinished?: (payload: string) => void;
    dialog?: (type: string, title: string, text: string) => void;
    loginDialog?: () => void;
    closeConnection?: () => void;
  }
}

export {};
