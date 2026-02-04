import { Logger } from '../core/logger';
import { EventDispatcher } from '../core/events';
import { WebSocketTransport } from './transport';
import { ConnectRequest, ConnectionState, SessionContext, SessionMode } from './types';
import { decodeProtoObject, loadProtos, ProtoRoots } from './proto';
import { ConnectionRoute, RendezvousClient, RelayInfo } from './rendezvous';
import { MessageInbox } from './inbox';
import { SecretBoxCipher, createSymmetricKey, decodeBase64, signOpen } from './crypto';
import { concatBytes, sha256, utf8ToBytes } from './hash';
import { VideoPipeline } from './video';
import * as fzstd from 'fzstd';

type DecodingAbility = { vp9: boolean; av1: boolean; h264: boolean; h265: boolean };
type PeerEncoding = {
  vp8?: boolean;
  av1?: boolean;
  h264?: boolean;
  h265?: boolean;
};

type FileEntryInfo = {
  entryType: number;
  name: string;
  size: number;
  modifiedTime: number;
  isHidden?: boolean;
};

type UploadJob = {
  id: number;
  file: File;
  remotePath: string;
  fileNum: number;
  totalSize: number;
  sentBytes: number;
  started: boolean;
  cancelled: boolean;
  nextBlockId: number;
  startTime: number;
  lastProgressTime: number;
  lastProgressBytes: number;
  pendingStartTimer?: number;
  resumeOffset: number;
};

type DownloadJob = {
  id: number;
  remotePath: string;
  files: FileEntryInfo[];
  currentFileNum: number;
  chunks: Uint8Array[];
  receivedBytes: number;
  totalSize: number;
  startTime: number;
  lastProgressTime: number;
  lastProgressBytes: number;
  cancelled: boolean;
};

enum SupportedDecodingPreferCodec {
  Auto = 0,
  VP9 = 1,
  H264 = 2,
  H265 = 3,
  VP8 = 4,
  AV1 = 5
}

enum BackNotificationState {
  BlkStateUnknown = 0,
  BlkOnSucceeded = 2,
  BlkOnFailed = 3,
  BlkOffSucceeded = 4,
  BlkOffFailed = 5
}

enum BoolOption {
  NotSet = 0,
  No = 1,
  Yes = 2
}

enum ImageQuality {
  NotSet = 0,
  Low = 2,
  Balanced = 3,
  Best = 4
}

enum Chroma {
  I420 = 0,
  I444 = 1
}

const BUTTON_MASK: Record<string, number> = {
  left: 1,
  right: 2,
  wheel: 4,
  back: 8,
  forward: 16
};

function boolOption(value: boolean): BoolOption {
  return value ? BoolOption.Yes : BoolOption.No;
}

export class WebSession {
  private readonly logger: Logger;
  private readonly events: EventDispatcher;
  private readonly transport: WebSocketTransport;
  private state: ConnectionState = 'idle';
  private readonly request: ConnectRequest;
  private proto?: ProtoRoots;
  private context?: SessionContext;
  private signedIdPk: Uint8Array = new Uint8Array();
  private hash?: { salt: string; challenge: string };
  private pendingLogin?: {
    password: string;
    osUsername: string;
    osPassword: string;
    remember: boolean;
  };
  private decoding?: DecodingAbility;
  private peerEncoding: PeerEncoding = {};
  private peerVersionNumber = 0;
  private supportsMultiUi = false;
  private isSecure = false;
  private readonly video: VideoPipeline;
  private readonly uploadJobs = new Map<number, UploadJob>();
  private readonly downloadJobs = new Map<number, DownloadJob>();

  constructor(request: ConnectRequest, events: EventDispatcher) {
    this.request = request;
    this.events = events;
    this.transport = new WebSocketTransport('session');
    this.logger = new Logger(`session:${request.id}`);
    this.video = new VideoPipeline((display, rgba) => {
      if (typeof window.onRgba === 'function') {
        window.onRgba(display, rgba);
      }
    });
  }

  getState(): ConnectionState {
    return this.state;
  }

  getPeerId(): string {
    return this.request.id;
  }

  async connect(context: SessionContext): Promise<void> {
    this.context = context;
    this.state = 'connecting';
    this.events.emit({ name: 'conn_status', status: 'connecting' });
    this.proto = await loadProtos();
    this.logger.info(
      `Session context: version=${context.version || '-'}, buildDate=${context.buildDate || '-'}`
    );

    const directTarget = this.isDirectAccessTarget(this.request.id);
    const directEndpoint = this.resolveDirectAccessEndpoint(context);
    if (directEndpoint) {
      this.transport.onMessage((data) => this.handleMessage(data));
      try {
        await this.connectDirectIpAccess(directEndpoint);
      } catch {
        this.transport.close();
        throw new Error(
          directEndpoint.startsWith('wss://')
            ? 'Direct IP access failed. Ensure target WSS endpoint is reachable and certificate is trusted.'
            : 'Direct IP access failed. Web client requires a reachable WS/WSS endpoint on target host (for example ws://host:21118).'
        );
      }
      this.state = 'connected';
      this.events.emit({ name: 'conn_status', status: 'connected' });
      this.events.emit({
        name: 'connection_ready',
        secure: 'false',
        direct: 'true',
        stream_type: 'TCP'
      });
      this.logger.info('Connected in direct IP access mode (unencrypted)');
      return;
    }
    if (directTarget && !context.allowDirectIpAccess) {
      throw new Error('Direct IP access is disabled. Enable "Enable direct IP access" first.');
    }

    if (!context.rendezvousServer || !context.relayServer) {
      throw new Error('Relay server not configured');
    }

    const rendezvous = new RendezvousClient(
      {
        appName: context.myName,
        version: context.version,
        buildDate: context.buildDate,
        apiServer: context.apiServer,
        isPublicServer: true,
        rendezvousServers: [],
        relayServers: [],
        env: {},
        profile: { id: context.myId, name: context.myName },
        langs: []
      },
      this.proto,
      this.logger
    );

    const route = await rendezvous.requestConnectionRoute({
      peerId: this.request.id,
      relayServer: context.relayServer,
      rendezvousServer: context.rendezvousServer,
      apiServer: context.apiServer,
      key: context.key,
      token: context.token,
      connType: this.connTypeFromMode(this.request.mode),
      secure: true,
      forceRelay: Boolean(this.request.forceRelay),
      version: context.version
    });
    this.logger.info(
      `Route selected: ${route.kind === 'direct' ? 'direct' : 'relay'}`
    );
    const routeResult = await this.connectWithRoute(route, rendezvous, context);
    const isDirect = routeResult === 'direct';

    this.state = 'connected';
    this.events.emit({ name: 'conn_status', status: 'connected' });
    this.events.emit({
      name: 'connection_ready',
      secure: this.isSecure ? 'true' : 'false',
      direct: isDirect ? 'true' : 'false',
      stream_type: isDirect ? 'Direct' : 'Relay'
    });
    this.logger.info(
      `Connected (${isDirect ? 'direct' : 'relay'}, ${
        this.isSecure ? 'encrypted' : 'unencrypted'
      })`
    );

    this.transport.onMessage((data) => this.handleMessage(data));
  }

  private resolveDirectAccessEndpoint(context: SessionContext): string | null {
    if (!context.allowDirectIpAccess) {
      return null;
    }
    const target = this.request.id.trim();
    if (!target || /^\d+$/.test(target)) {
      return null;
    }
    if (target.startsWith('ws://') || target.startsWith('wss://')) {
      return target;
    }
    if (target.includes('/') || target.includes('?') || target.includes('#')) {
      return null;
    }
    if (target.startsWith('[')) {
      const end = target.indexOf(']');
      if (end <= 0) {
        return null;
      }
      const host = target.slice(1, end);
      const rest = target.slice(end + 1);
      if (!host || !host.includes(':')) {
        return null;
      }
      if (!rest) {
        return `ws://[${host}]:${context.directAccessPort}`;
      }
      if (!rest.startsWith(':')) {
        return null;
      }
      const port = Number.parseInt(rest.slice(1), 10);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        return null;
      }
      return `ws://[${host}]:${port}`;
    }
    const colonCount = (target.match(/:/g) ?? []).length;
    if (colonCount === 0) {
      if (isIpv4(target)) {
        return `ws://${target}:${context.directAccessPort}`;
      }
      return null;
    }
    if (colonCount === 1) {
      const lastColon = target.lastIndexOf(':');
      const host = target.slice(0, lastColon);
      const portRaw = target.slice(lastColon + 1);
      const port = Number.parseInt(portRaw, 10);
      if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
        return null;
      }
      if (!isIpv4(host) && !isDomain(host)) {
        return null;
      }
      return `ws://${host}:${port}`;
    }
    return null;
  }

  private isDirectAccessTarget(rawId: string): boolean {
    const target = rawId.trim();
    if (!target || /^\d+$/.test(target)) {
      return false;
    }
    if (target.startsWith('ws://') || target.startsWith('wss://')) {
      return true;
    }
    if (target.includes('/') || target.includes('?') || target.includes('#')) {
      return false;
    }
    if (target.startsWith('[')) {
      const end = target.indexOf(']');
      if (end <= 0) {
        return false;
      }
      const host = target.slice(1, end);
      const rest = target.slice(end + 1);
      if (!host || !host.includes(':')) {
        return false;
      }
      if (!rest) {
        return true;
      }
      if (!rest.startsWith(':')) {
        return false;
      }
      const port = Number.parseInt(rest.slice(1), 10);
      return Number.isInteger(port) && port > 0 && port <= 65535;
    }
    const colonCount = (target.match(/:/g) ?? []).length;
    if (colonCount === 0) {
      return isIpv4(target);
    }
    if (colonCount === 1) {
      const lastColon = target.lastIndexOf(':');
      const host = target.slice(0, lastColon);
      const portRaw = target.slice(lastColon + 1);
      const port = Number.parseInt(portRaw, 10);
      if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
        return false;
      }
      return isIpv4(host) || isDomain(host);
    }
    return false;
  }

  private async connectDirectIpAccess(endpoint: string): Promise<void> {
    await this.transport.connect(endpoint);
    this.isSecure = false;
    // Keep behavior aligned with native direct-IP mode (non-secure path).
    this.sendMessage({});
  }

  private async connectWithRoute(
    route: ConnectionRoute,
    rendezvous: RendezvousClient,
    context: SessionContext
  ): Promise<'direct' | 'relay'> {
    if (route.kind === 'direct') {
      try {
        await this.connectDirect(route.direct, context);
        return 'direct';
      } catch (err) {
        this.logger.warn('Direct connection failed, falling back to relay', err);
        this.transport.close();
      }
    }
    const relayInfo =
      route.kind === 'relay'
        ? route.relay
        : await rendezvous.requestRelay({
            peerId: this.request.id,
            relayServer: context.relayServer,
            rendezvousServer: context.rendezvousServer,
            apiServer: context.apiServer,
            key: context.key,
            token: context.token,
            connType: this.connTypeFromMode(this.request.mode),
            secure: true
          });
    await this.connectRelay(relayInfo, context);
    return 'relay';
  }

  private async connectDirect(
    direct: { endpoint: string; signedIdPk: Uint8Array },
    context: SessionContext
  ): Promise<void> {
    this.signedIdPk = direct.signedIdPk;
    this.logger.info(`Connecting direct via ${direct.endpoint}`);
    await this.transport.connect(direct.endpoint);
    const inbox = new MessageInbox(this.transport);
    try {
      await this.secureConnection(inbox, context);
    } finally {
      inbox.close();
    }
  }

  private async connectRelay(relayInfo: RelayInfo, context: SessionContext): Promise<void> {
    this.signedIdPk = relayInfo.signedIdPk;
    this.logger.info(`Connecting relay via ${relayInfo.relayEndpoint}`);
    await this.transport.connect(relayInfo.relayEndpoint);
    const inbox = new MessageInbox(this.transport);
    try {
      await this.sendRelayJoin(relayInfo.uuid, context);
      await this.secureConnection(inbox, context);
    } finally {
      inbox.close();
    }
  }

  close(): void {
    this.transport.close();
    this.state = 'closed';
    this.events.emit({ name: 'conn_status', status: 'closed' });
    this.video.close();
    for (const job of this.uploadJobs.values()) {
      job.cancelled = true;
    }
    this.uploadJobs.clear();
    for (const job of this.downloadJobs.values()) {
      job.cancelled = true;
    }
    this.downloadJobs.clear();
  }

  sendBinary(data: Uint8Array): void {
    this.transport.send(data);
  }

  requestDownload(
    id: number,
    path: string,
    includeHidden: boolean,
    fileNum = 0
  ): void {
    if (!this.proto) {
      return;
    }
    if (!path) {
      return;
    }
    const job: DownloadJob = {
      id,
      remotePath: path,
      files: [],
      currentFileNum: -1,
      chunks: [],
      receivedBytes: 0,
      totalSize: 0,
      startTime: Date.now(),
      lastProgressTime: Date.now(),
      lastProgressBytes: 0,
      cancelled: false
    };
    this.downloadJobs.set(id, job);
    this.sendMessage({
      fileAction: {
        send: {
          id,
          path,
          includeHidden,
          fileNum,
          fileType: 0
        }
      }
    });
  }

  startUpload(id: number, file: File, remotePath: string): void {
    if (!this.proto) {
      return;
    }
    if (!file || !remotePath) {
      return;
    }
    const modifiedTime = Math.floor((file.lastModified || Date.now()) / 1000);
    const entry: FileEntryInfo = {
      entryType: 4,
      name: '',
      size: file.size,
      modifiedTime,
      isHidden: false
    };
    const job: UploadJob = {
      id,
      file,
      remotePath,
      fileNum: 0,
      totalSize: file.size,
      sentBytes: 0,
      started: false,
      cancelled: false,
      nextBlockId: 0,
      startTime: Date.now(),
      lastProgressTime: Date.now(),
      lastProgressBytes: 0,
      resumeOffset: 0
    };
    this.uploadJobs.set(id, job);
    this.sendMessage({
      fileAction: {
        receive: {
          id,
          path: remotePath,
          files: [entry],
          fileNum: 0,
          totalSize: file.size
        }
      }
    });
    job.pendingStartTimer = window.setTimeout(() => {
      if (!job.started && !job.cancelled) {
        this.startUploadJob(job, 0);
      }
    }, 800);
  }

  login(payload: {
    password: string;
    osUsername?: string;
    osPassword?: string;
    remember?: boolean;
  }): void {
    this.pendingLogin = {
      password: payload.password ?? '',
      osUsername: payload.osUsername ?? '',
      osPassword: payload.osPassword ?? '',
      remember: payload.remember ?? false
    };
    if (this.hash) {
      void this.sendLoginWithHash();
    }
  }

  sendTwoFactor(code: string): void {
    if (!this.proto) {
      return;
    }
    const auth2Fa = { code };
    this.sendMessage({ auth2Fa });
  }

  inputString(value: string): void {
    if (!this.proto || !value) {
      return;
    }
    const keyEvent = {
      mode: 'Translate',
      press: true,
      seq: value
    };
    this.sendMessage({ keyEvent });
  }

  inputKey(payload: Record<string, unknown>): void {
    if (!this.proto) {
      return;
    }
    const name = String(payload.name ?? '');
    const modifiers = this.buildModifiers(payload);
    const down = payload.down === 'true' || payload.down === true;
    const press = payload.press === 'true' || payload.press === true;
    const controlKey = toControlKey(name);
    const keyEvent: Record<string, unknown> = {
      down,
      press,
      modifiers,
      mode: controlKey ? 'Legacy' : 'Translate'
    };
    if (controlKey) {
      keyEvent.controlKey = controlKey;
    } else if (name.length === 1) {
      keyEvent.seq = name;
    } else {
      keyEvent.seq = name;
    }
    this.sendMessage({ keyEvent });
  }

  flutterKeyEvent(payload: Record<string, unknown>): void {
    if (!this.proto) {
      return;
    }
    const name = String(payload.name ?? '');
    const usbHid = Number(payload.usb_hid ?? 0);
    const down = payload.down === 'true' || payload.down === true;
    if (!down) {
      return;
    }
    if (name && name !== 'flutter_key') {
      const keyEvent = {
        mode: 'Translate',
        seq: name,
        press: true
      };
      this.sendMessage({ keyEvent });
      return;
    }
    const controlKey = flutterSpecialKey(usbHid);
    if (controlKey) {
      const keyEvent = {
        mode: 'Legacy',
        controlKey,
        down: true
      };
      this.sendMessage({ keyEvent });
    }
  }

  sendMouse(payload: Record<string, unknown>): void {
    if (!this.proto) {
      return;
    }
    const event = this.buildMouseEvent(payload);
    if (!event) {
      return;
    }
    const { mask, x, y, modifiers } = event;
    const mouseEvent = {
      mask,
      x,
      y,
      modifiers
    };
    this.sendMessage({ mouseEvent });
  }

  sendChat(text: string): void {
    if (!this.proto || !text) {
      return;
    }
    const misc = { chatMessage: { text } };
    this.sendMessage({ misc });
  }

  sendOption(option: Record<string, unknown>): void {
    if (!this.proto) {
      return;
    }
    this.sendMessage({ misc: { option } });
  }

  setImageQuality(value: string, customQuality?: number, customFps?: number): void {
    if (!this.proto) {
      return;
    }
    const option: Record<string, unknown> = {};
    const quality = parseImageQuality(value);
    if (quality !== null) {
      option.imageQuality = quality;
    }
    if (value === 'custom' && typeof customQuality === 'number') {
      option.customImageQuality = customQuality << 8;
      if (typeof customFps === 'number') {
        option.customFps = customFps;
      }
    }
    if (Object.keys(option).length > 0) {
      this.sendOption(option);
    }
  }

  setCustomImageQuality(value: number, customFps?: number): void {
    if (!this.proto) {
      return;
    }
    const option: Record<string, unknown> = {
      customImageQuality: value << 8
    };
    if (typeof customFps === 'number') {
      option.customFps = customFps;
    }
    this.sendOption(option);
  }

  setCustomFps(fps: number): void {
    if (!this.proto) {
      return;
    }
    this.sendOption({ customFps: fps });
  }

  async changePreferCodec(preference: string, preferI444 = false): Promise<void> {
    if (!this.proto) {
      return;
    }
    const decoding = await this.ensureDecoding();
    const prefer = normalizePreferCodec(preference, decoding);
    this.sendOption({
      supportedDecoding: {
        abilityVp9: decoding.vp9 ? 1 : 0,
        abilityH264: decoding.h264 ? 1 : 0,
        abilityAv1: decoding.av1 ? 1 : 0,
        abilityVp8: 0,
        abilityH265: decoding.h265 ? 1 : 0,
        prefer,
        preferChroma: preferI444 ? Chroma.I444 : Chroma.I420
      }
    });
  }

  togglePrivacyMode(implKey: string, on: boolean): void {
    if (!this.proto) {
      return;
    }
    this.sendMessage({
      misc: {
        togglePrivacyMode: {
          implKey,
          on
        }
      }
    });
  }

  toggleVirtualDisplay(index: number, on: boolean): void {
    if (!this.proto) {
      return;
    }
    this.sendMessage({
      misc: {
        toggleVirtualDisplay: {
          display: index,
          on
        }
      }
    });
  }

  lockScreen(): void {
    if (!this.proto) {
      return;
    }
    this.sendMessage({
      keyEvent: {
        mode: 'Legacy',
        controlKey: ControlKey.LockScreen,
        press: true,
        down: true
      }
    });
  }

  ctrlAltDel(): void {
    if (!this.proto) {
      return;
    }
    this.sendMessage({
      keyEvent: {
        mode: 'Legacy',
        controlKey: ControlKey.CtrlAltDel,
        press: true,
        down: true
      }
    });
  }

  switchDisplay(displays: number[]): void {
    if (!this.proto) {
      return;
    }
    const targets = displays
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    if (targets.length === 0) {
      return;
    }
    if (targets.length === 1) {
      this.sendMessage({
        misc: {
          switchDisplay: {
            display: targets[0]
          }
        }
      });
      this.refreshVideo(targets[0]);
      return;
    }
    this.sendMessage({
      misc: {
        captureDisplays: {
          set: targets
        }
      }
    });
    for (const display of targets) {
      this.refreshVideo(display);
    }
  }

  changeResolution(display: number, width: number, height: number): void {
    if (!this.proto) {
      return;
    }
    if (this.supportsMultiUi) {
      this.sendMessage({
        misc: {
          changeDisplayResolution: {
            display,
            resolution: {
              width,
              height
            }
          }
        }
      });
    } else {
      this.sendMessage({
        misc: {
          changeResolution: {
            width,
            height
          }
        }
      });
    }
  }

  refreshVideo(display?: number): void {
    if (!this.proto) {
      return;
    }
    if (this.supportsMultiUi && typeof display === 'number') {
      this.sendMessage({
        misc: {
          refreshVideoDisplay: display
        }
      });
      return;
    }
    this.sendMessage({
      misc: {
        refreshVideo: true
      }
    });
  }

  selectSession(sid: number): void {
    if (!this.proto) {
      return;
    }
    this.sendMessage({
      misc: {
        selectedSid: sid
      }
    });
  }

  restartRemote(): void {
    if (!this.proto) {
      return;
    }
    this.sendMessage({
      misc: {
        restartRemoteDevice: true
      }
    });
  }

  elevateDirect(): void {
    if (!this.proto) {
      return;
    }
    this.sendMessage({
      misc: {
        elevationRequest: {
          direct: true
        }
      }
    });
  }

  elevateWithLogon(username: string, password: string): void {
    if (!this.proto) {
      return;
    }
    this.sendMessage({
      misc: {
        elevationRequest: {
          logon: {
            username,
            password
          }
        }
      }
    });
  }

  openTerminal(terminalId: number, rows: number, cols: number): void {
    if (!this.proto) {
      return;
    }
    this.sendMessage({
      terminalAction: {
        open: {
          terminalId,
          rows,
          cols
        }
      }
    });
  }

  sendTerminalInput(terminalId: number, data: string): void {
    if (!this.proto) {
      return;
    }
    const bytes = new TextEncoder().encode(data);
    this.sendMessage({
      terminalAction: {
        data: {
          terminalId,
          data: bytes,
          compressed: false
        }
      }
    });
  }

  resizeTerminal(terminalId: number, rows: number, cols: number): void {
    if (!this.proto) {
      return;
    }
    this.sendMessage({
      terminalAction: {
        resize: {
          terminalId,
          rows,
          cols
        }
      }
    });
  }

  closeTerminal(terminalId: number): void {
    if (!this.proto) {
      return;
    }
    this.sendMessage({
      terminalAction: {
        close: {
          terminalId
        }
      }
    });
  }

  readAllFiles(id: number, path: string, includeHidden: boolean): void {
    if (!this.proto) {
      return;
    }
    this.sendMessage({
      fileAction: {
        allFiles: {
          id,
          path,
          includeHidden
        }
      }
    });
  }

  readEmptyDirs(path: string, includeHidden: boolean): void {
    if (!this.proto) {
      return;
    }
    this.sendMessage({
      fileAction: {
        readEmptyDirs: {
          path,
          includeHidden
        }
      }
    });
  }

  cancelJob(id: number): void {
    if (!this.proto) {
      return;
    }
    const upload = this.uploadJobs.get(id);
    if (upload) {
      upload.cancelled = true;
      this.uploadJobs.delete(id);
    }
    const download = this.downloadJobs.get(id);
    if (download) {
      download.cancelled = true;
      this.downloadJobs.delete(id);
    }
    this.sendMessage({
      fileAction: {
        cancel: { id }
      }
    });
  }

  createDir(id: number, path: string): void {
    if (!this.proto) {
      return;
    }
    this.sendMessage({
      fileAction: {
        create: { id, path }
      }
    });
  }

  removeFile(id: number, path: string, fileNum: number): void {
    if (!this.proto) {
      return;
    }
    this.sendMessage({
      fileAction: {
        removeFile: {
          id,
          path,
          fileNum
        }
      }
    });
  }

  removeDir(id: number, path: string, recursive: boolean): void {
    if (!this.proto) {
      return;
    }
    this.sendMessage({
      fileAction: {
        removeDir: {
          id,
          path,
          recursive
        }
      }
    });
  }

  renameFile(id: number, path: string, newName: string): void {
    if (!this.proto) {
      return;
    }
    this.sendMessage({
      fileAction: {
        rename: {
          id,
          path,
          newName
        }
      }
    });
  }

  confirmOverrideFile(id: number, fileNum: number, needOverride: boolean): void {
    if (!this.proto) {
      return;
    }
    const skip = !needOverride;
    this.sendFileSendConfirm(id, fileNum, skip ? undefined : 0, skip);
    const job = this.uploadJobs.get(id);
    if (job && !skip) {
      this.startUploadJob(job, 0);
    }
    if (job && skip) {
      this.events.emit({
        name: 'job_error',
        id: String(id),
        file_num: String(fileNum),
        err: 'skipped'
      });
      this.uploadJobs.delete(id);
    }
  }

  getPeerEncoding(): PeerEncoding {
    return { ...this.peerEncoding };
  }

  getPeerVersionNumber(): number {
    return this.peerVersionNumber;
  }

  supportsMultiUiSession(): boolean {
    return this.supportsMultiUi;
  }

  getDecoding(): DecodingAbility | undefined {
    return this.decoding;
  }

  readRemoteDir(path: string, includeHidden: boolean): void {
    if (!this.proto) {
      return;
    }
    const fileAction = { readDir: { path, includeHidden } };
    this.sendMessage({ fileAction });
  }

  private async sendRelayJoin(uuid: string, context: SessionContext): Promise<void> {
    if (!this.proto) {
      return;
    }
    const requestRelay = {
      id: this.request.id,
      uuid,
      licenceKey: context.key ?? '',
      connType: this.connTypeFromMode(this.request.mode)
    };
    const payload = this.proto.rendezvousType.encode({ requestRelay }).finish();
    this.transport.send(payload);
  }

  private async secureConnection(inbox: MessageInbox, context: SessionContext): Promise<void> {
    if (!this.proto) {
      throw new Error('Protocol is not initialized');
    }
    this.isSecure = false;
    if (!context.key) {
      throw new Error('Missing rendezvous public key');
    }
    if (!this.signedIdPk || this.signedIdPk.length === 0) {
      throw new Error(
        'Missing signed peer identity from rendezvous. Ensure the target is online and the ID server has a private key configured (RS_PRIV_KEY) matching your RS_PUB_KEY.'
      );
    }
    const rsPk = decodeBase64(context.key);
    let signPk: Uint8Array | null = null;
    const idPkBytes = signOpen(this.signedIdPk, rsPk);
    const idPk = decodeProtoObject<{ id?: string; pk?: Uint8Array }>(
      this.proto.idPkType,
      idPkBytes,
      {
        bytes: Uint8Array,
        defaults: false
      }
    );
    if (idPk.id === this.request.id && idPk.pk) {
      signPk = idPk.pk;
    }
    if (!signPk) {
      throw new Error('Rendezvous signature verification failed');
    }
    let first: Uint8Array;
    try {
      first = await inbox.next(15000);
    } catch (err) {
      if (err instanceof Error && err.message.includes('timeout')) {
        throw new Error(
          'Handshake timed out waiting for the peer. Ensure the target is online, ' +
            'registered on the same ID server, and supports secure connections.'
        );
      }
      throw err;
    }
    const msg = decodeProtoObject<Record<string, unknown>>(
      this.proto.messageType,
      first,
      {
        longs: String,
        bytes: Uint8Array,
        defaults: false
      }
    );
    const signedId = msg.signedId as { id?: Uint8Array } | undefined;
    if (!signedId || !signedId.id) {
      throw new Error('Peer did not provide a signed identity');
    }
    const peerIdPkBytes = signOpen(signedId.id, signPk);
    const peerIdPk = decodeProtoObject<{ id?: string; pk?: Uint8Array }>(
      this.proto.idPkType,
      peerIdPkBytes,
      {
        bytes: Uint8Array,
        defaults: false
      }
    );
    if (peerIdPk.id !== this.request.id || !peerIdPk.pk) {
      throw new Error('Peer identity verification failed');
    }
    const { publicKey, symmetricKey, sealed } = createSymmetricKey(peerIdPk.pk);
    this.sendMessage({
      publicKey: {
        asymmetricValue: publicKey,
        symmetricValue: sealed
      }
    });
    this.transport.setCipher(new SecretBoxCipher(symmetricKey));
    this.isSecure = true;
  }

  private async handleMessage(data: Uint8Array): Promise<void> {
    if (!this.proto) {
      return;
    }
    let msg: Record<string, unknown>;
    try {
      msg = decodeProtoObject<Record<string, unknown>>(
        this.proto.messageType,
        data,
        {
          longs: String,
          bytes: Uint8Array,
          defaults: false
        }
      );
    } catch (err) {
      this.logger.warn('Failed to decode message', err);
      return;
    }

    if (msg.hash) {
      this.handleHash(msg.hash as { salt?: string; challenge?: string });
    }
    if (msg.loginResponse) {
      this.handleLoginResponse(msg.loginResponse as Record<string, unknown>);
    }
    if (msg.peerInfo) {
      this.emitPeerInfo(msg.peerInfo as Record<string, unknown>);
    }
    if (msg.videoFrame) {
      this.handleVideoFrame(msg.videoFrame as Record<string, unknown>);
    }
    if (msg.cursorData) {
      this.handleCursorData(msg.cursorData as Record<string, unknown>);
    }
    if (msg.cursorPosition) {
      this.handleCursorPosition(msg.cursorPosition as Record<string, unknown>);
    }
    if (msg.cursorId) {
      this.events.emit({ name: 'cursor_id', id: String(msg.cursorId) });
    }
    if (msg.clipboard) {
      this.handleClipboard(msg.clipboard as Record<string, unknown>);
    }
    if (msg.fileResponse) {
      this.handleFileResponse(msg.fileResponse as Record<string, unknown>);
    }
    if (msg.terminalResponse) {
      this.handleTerminalResponse(msg.terminalResponse as Record<string, unknown>);
    }
    if (msg.messageBox) {
      const box = msg.messageBox as Record<string, unknown>;
      this.events.emit({
        name: 'msgbox',
        type: String(box.msgtype ?? 'info'),
        title: String(box.title ?? ''),
        text: String(box.text ?? ''),
        link: String(box.link ?? '')
      });
    }
    if (msg.misc) {
      this.handleMisc(msg.misc as Record<string, unknown>);
    }
  }

  private handleHash(hash: { salt?: string; challenge?: string }): void {
    if (!hash.salt || !hash.challenge) {
      return;
    }
    this.hash = { salt: hash.salt, challenge: hash.challenge };
    if (this.pendingLogin || this.request.password) {
      void this.sendLoginWithHash();
      return;
    }
    this.events.emit({
      name: 'msgbox',
      type: 'input-password',
      title: 'Password Required',
      text: '',
      link: ''
    });
  }

  private async sendLoginWithHash(): Promise<void> {
    if (!this.proto || !this.hash || !this.context) {
      return;
    }
    const password =
      this.pendingLogin?.password ??
      this.request.password ??
      '';
    const osUsername = this.pendingLogin?.osUsername ?? '';
    const osPassword = this.pendingLogin?.osPassword ?? '';
    const passwordBytes = password
      ? await sha256(concatBytes(utf8ToBytes(password), utf8ToBytes(this.hash.salt)))
      : new Uint8Array();
    const finalHash = passwordBytes.length
      ? await sha256(concatBytes(passwordBytes, utf8ToBytes(this.hash.challenge)))
      : new Uint8Array();
    const loginRequest: Record<string, unknown> = {
      username: this.request.id,
      password: finalHash,
      myId: this.context.myId,
      myName: this.context.myName,
      myPlatform: this.context.platform,
      option: await this.buildOptionMessage(),
      sessionId: 0,
      version: this.context.version,
      osLogin: {
        username: osUsername,
        password: osPassword
      }
    };
    this.attachSessionMode(loginRequest);
    this.sendMessage({ loginRequest });
  }

  private async buildOptionMessage(): Promise<Record<string, unknown>> {
    const decoding = await this.ensureDecoding();
    const prefer = decoding.h265
      ? SupportedDecodingPreferCodec.H265
      : decoding.h264
      ? SupportedDecodingPreferCodec.H264
      : decoding.vp9
      ? SupportedDecodingPreferCodec.VP9
      : decoding.av1
      ? SupportedDecodingPreferCodec.AV1
      : SupportedDecodingPreferCodec.Auto;
    return {
      supportedDecoding: {
        abilityVp9: decoding.vp9 ? 1 : 0,
        abilityH264: decoding.h264 ? 1 : 0,
        abilityAv1: decoding.av1 ? 1 : 0,
        abilityVp8: 0,
        abilityH265: decoding.h265 ? 1 : 0,
        prefer,
        preferChroma: Chroma.I420
      }
    };
  }

  private async ensureDecoding(): Promise<DecodingAbility> {
    if (!this.decoding) {
      this.decoding = await detectDecoding();
    }
    return this.decoding;
  }

  private handleLoginResponse(resp: Record<string, unknown>): void {
    if (resp.error) {
      const text = String(resp.error);
      const type = text.toLowerCase().includes('2fa')
        ? 'input-2fa'
        : text.toLowerCase().includes('password')
        ? 're-input-password'
        : 'error';
      this.events.emit({
        name: 'msgbox',
        type,
        title: 'Login Error',
        text,
        link: ''
      });
      return;
    }
    if (resp.peerInfo) {
      this.emitPeerInfo(resp.peerInfo as Record<string, unknown>);
    }
    if (resp.enableTrustedDevices !== undefined) {
      this.events.emit({
        name: 'enable_trusted_devices',
        value: String(resp.enableTrustedDevices)
      });
    }
  }

  private emitPeerInfo(peerInfo: Record<string, unknown>): void {
    const pi = peerInfo as any;
    const version = String(pi.version ?? '');
    this.peerVersionNumber = getVersionNumber(version);
    this.supportsMultiUi = this.peerVersionNumber >= getVersionNumber('1.2.4');
    this.peerEncoding = parsePeerEncoding(pi.encoding);
    const displays = Array.isArray(pi.displays)
      ? pi.displays.map((d: any) => ({
          x: Number(d.x ?? 0),
          y: Number(d.y ?? 0),
          width: Number(d.width ?? 0),
          height: Number(d.height ?? 0),
          cursor_embedded: d.cursorEmbedded ? 1 : 0,
          original_width: Number(d.originalResolution?.width ?? -1),
          original_height: Number(d.originalResolution?.height ?? -1),
          scaled_width:
            d.scale && Number(d.scale) > 0
              ? Math.round(Number(d.width ?? 0) / Number(d.scale))
              : undefined
        }))
      : [];
    const features = pi.features ?? {};
    const resolutions = pi.resolutions ?? {};
    this.events.emit({
      name: 'peer_info',
      username: String(pi.username ?? ''),
      hostname: String(pi.hostname ?? ''),
      platform: String(pi.platform ?? ''),
      sas_enabled: pi.sasEnabled ? 'true' : 'false',
      current_display: String(pi.currentDisplay ?? 0),
      version,
      displays: JSON.stringify(displays),
      features: JSON.stringify({
        privacy_mode: features.privacyMode ?? false,
        terminal: features.terminal ?? false
      }),
      resolutions: JSON.stringify(resolutions),
      platform_additions: pi.platformAdditions
        ? JSON.stringify(pi.platformAdditions)
        : ''
    });
    if (pi.windowsSessions && Array.isArray(pi.windowsSessions.sessions)) {
      const sessions = pi.windowsSessions.sessions.map((s: any) => ({
        sid: String(s.sid ?? ''),
        name: String(s.name ?? '')
      }));
      this.events.emit({
        name: 'set_multiple_windows_session',
        windows_sessions: JSON.stringify(sessions)
      });
    }
  }

  private handleVideoFrame(frame: Record<string, unknown>): void {
    const f = frame as any;
    const display = Number(f.display ?? 0);
    if (f.vp9s) {
      const frames = (f.vp9s as any).frames as Array<Record<string, unknown>>;
      this.decodeFrames('vp9', display, frames);
      return;
    }
    if (f.av1s) {
      const frames = (f.av1s as any).frames as Array<Record<string, unknown>>;
      this.decodeFrames('av1', display, frames);
      return;
    }
    if (f.h264s) {
      const frames = (f.h264s as any).frames as Array<Record<string, unknown>>;
      this.decodeFrames('h264', display, frames);
      return;
    }
    if (f.h265s) {
      const frames = (f.h265s as any).frames as Array<Record<string, unknown>>;
      this.decodeFrames('h265', display, frames);
    }
  }

  private decodeFrames(
    codec: 'vp9' | 'av1' | 'h264' | 'h265',
    display: number,
    frames: Array<Record<string, unknown>>
  ): void {
    for (const entry of frames) {
      const data = entry.data as Uint8Array | undefined;
      if (!data) {
        continue;
      }
      void this.video.decode({
        codec,
        display,
        data,
        key: Boolean(entry.key),
        pts: entry.pts as number | string | undefined
      });
    }
  }

  private handleCursorData(data: Record<string, unknown>): void {
    const colors = data.colors as Uint8Array | undefined;
    if (!colors) {
      return;
    }
    const colorsJson = JSON.stringify(Array.from(colors));
    this.events.emit({
      name: 'cursor_data',
      id: String(data.id ?? ''),
      hotx: String(data.hotx ?? 0),
      hoty: String(data.hoty ?? 0),
      width: String(data.width ?? 0),
      height: String(data.height ?? 0),
      colors: colorsJson
    });
  }

  private handleCursorPosition(data: Record<string, unknown>): void {
    this.events.emit({
      name: 'cursor_position',
      x: String(data.x ?? 0),
      y: String(data.y ?? 0)
    });
  }

  private handleClipboard(data: Record<string, unknown>): void {
    const format = Number(data.format ?? 0);
    if (format !== 0) {
      return;
    }
    const content = data.content as Uint8Array | undefined;
    if (!content) {
      return;
    }
    const text = new TextDecoder().decode(content);
    this.events.emit({ name: 'clipboard', content: text });
  }

  private handleFileResponse(resp: Record<string, unknown>): void {
    const response = resp as any;
    if (response.dir) {
      const dir = response.dir as any;
      const entries = Array.isArray(dir.entries)
        ? dir.entries.map((entry: any) => ({
            entry_type: Number(entry.entryType ?? 4),
            name: String(entry.name ?? ''),
            is_hidden: Boolean(entry.isHidden),
            size: Number(entry.size ?? 0),
            modified_time: Number(entry.modifiedTime ?? 0)
          }))
        : [];
      const jobId = Number(dir.id ?? 0);
      if (jobId > 0 && this.downloadJobs.has(jobId)) {
        const job = this.downloadJobs.get(jobId) as DownloadJob;
        job.files = entries.map((entry: any) => ({
          entryType: Number(entry.entry_type ?? 4),
          name: String(entry.name ?? ''),
          size: Number(entry.size ?? 0),
          modifiedTime: Number(entry.modified_time ?? 0),
          isHidden: Boolean(entry.is_hidden)
        }));
        job.totalSize = job.files.reduce((sum, item) => sum + item.size, 0);
        this.events.emit({
          name: 'update_folder_files',
          info: JSON.stringify({
            id: jobId,
            num_entries: job.files.length,
            total_size: job.totalSize
          })
        });
      }
      const payload = {
        id: jobId,
        path: String(dir.path ?? ''),
        entries
      };
      this.events.emit({
        name: 'file_dir',
        value: JSON.stringify(payload),
        is_local: 'false'
      });
      return;
    }
    if (response.emptyDirs) {
      const empty = response.emptyDirs as any;
      const emptyDirs = Array.isArray(empty.emptyDirs)
        ? empty.emptyDirs.map((dir: any) => ({
            id: Number(dir.id ?? 0),
            path: String(dir.path ?? ''),
            entries: Array.isArray(dir.entries)
              ? dir.entries.map((entry: any) => ({
                  entry_type: Number(entry.entryType ?? 4),
                  name: String(entry.name ?? ''),
                  is_hidden: Boolean(entry.isHidden),
                  size: Number(entry.size ?? 0),
                  modified_time: Number(entry.modifiedTime ?? 0)
                }))
              : []
          }))
        : [];
      const payload = {
        path: String(empty.path ?? ''),
        empty_dirs: emptyDirs
      };
      this.events.emit({
        name: 'empty_dirs',
        value: JSON.stringify(payload),
        is_local: 'false'
      });
      return;
    }
    if (response.error) {
      const err = response.error as any;
      this.events.emit({
        name: 'job_error',
        id: String(err.id ?? ''),
        err: String(err.error ?? 'Unknown error')
      });
      if (err.id !== undefined) {
        const id = Number(err.id);
        const upload = this.uploadJobs.get(id);
        if (upload) {
          upload.cancelled = true;
          this.uploadJobs.delete(id);
        }
        const download = this.downloadJobs.get(id);
        if (download) {
          download.cancelled = true;
          this.downloadJobs.delete(id);
        }
      }
      return;
    }
    if (response.digest) {
      this.handleFileDigest(response.digest as Record<string, unknown>);
      return;
    }
    if (response.block) {
      this.handleFileBlock(response.block as Record<string, unknown>);
      return;
    }
    if (response.done) {
      const done = response.done as any;
      this.handleFileDone(done as Record<string, unknown>);
    }
  }

  private handleFileDigest(digest: Record<string, unknown>): void {
    const id = Number(digest.id ?? 0);
    const fileNum = Number(digest.fileNum ?? 0);
    const isUpload = Boolean(digest.isUpload);
    if (isUpload) {
      const job = this.uploadJobs.get(id);
      if (!job) {
        return;
      }
      const offset = 0;
      this.sendFileSendConfirm(id, fileNum, offset, false);
      this.startUploadJob(job, offset);
      return;
    }
    if (this.downloadJobs.has(id)) {
      this.sendFileSendConfirm(id, fileNum, 0, false);
    }
  }

  private handleFileBlock(block: Record<string, unknown>): void {
    const id = Number(block.id ?? 0);
    const job = this.downloadJobs.get(id);
    if (!job || job.cancelled) {
      return;
    }
    const fileNum = Number(block.fileNum ?? 0);
    const compressed = Boolean(block.compressed);
    let data = block.data as Uint8Array | undefined;
    if (!data) {
      return;
    }
    if (compressed) {
      try {
        data = fzstd.decompress(data);
      } catch (err) {
        this.events.emit({
          name: 'job_error',
          id: String(id),
          file_num: String(fileNum),
          err: 'decompress_failed'
        });
        this.downloadJobs.delete(id);
        return;
      }
    }
    if (job.currentFileNum !== fileNum) {
      if (job.currentFileNum >= 0) {
        this.finalizeDownloadFile(job, job.currentFileNum);
      }
      job.chunks = [];
      job.currentFileNum = fileNum;
    }
    job.chunks.push(data);
    job.receivedBytes += data.length;
    this.emitJobProgress(id, fileNum, job.receivedBytes, job.startTime);
  }

  private handleFileDone(done: Record<string, unknown>): void {
    const id = Number(done.id ?? 0);
    const fileNum = Number(done.fileNum ?? 0);
    const job = this.downloadJobs.get(id);
    if (job && !job.cancelled) {
      if (job.currentFileNum !== fileNum) {
        job.currentFileNum = fileNum;
      }
      this.finalizeDownloadFile(job, fileNum);
      this.downloadJobs.delete(id);
    }
    this.events.emit({
      name: 'job_done',
      id: String(id),
      file_num: String(fileNum),
      speed: '0'
    });
  }

  private finalizeDownloadFile(job: DownloadJob, fileNum: number): void {
    if (job.chunks.length === 0) {
      return;
    }
    const entry = job.files[fileNum];
    const baseName = entry?.name || job.remotePath;
    const name = sanitizeFileName(baseName) || `download-${job.id}-${fileNum}`;
    const blob = new Blob(job.chunks, { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    job.chunks = [];
  }

  private emitJobProgress(
    id: number,
    fileNum: number,
    finishedSize: number,
    startTime: number
  ): void {
    const now = Date.now();
    const elapsed = Math.max((now - startTime) / 1000, 0.001);
    const speed = Math.floor(finishedSize / elapsed);
    this.events.emit({
      name: 'job_progress',
      id: String(id),
      file_num: String(fileNum),
      finished_size: String(Math.floor(finishedSize)),
      speed: String(speed)
    });
  }

  private sendFileSendConfirm(
    id: number,
    fileNum: number,
    offsetBlk?: number,
    skip?: boolean
  ): void {
    if (!this.proto) {
      return;
    }
    const payload: Record<string, unknown> = { id, fileNum };
    if (skip) {
      payload.skip = true;
    } else if (typeof offsetBlk === 'number') {
      payload.offsetBlk = offsetBlk;
    }
    this.sendMessage({
      fileAction: {
        sendConfirm: payload
      }
    });
  }

  private startUploadJob(job: UploadJob, offset: number): void {
    if (job.started || job.cancelled) {
      return;
    }
    if (job.pendingStartTimer) {
      window.clearTimeout(job.pendingStartTimer);
      job.pendingStartTimer = undefined;
    }
    job.started = true;
    job.resumeOffset = offset;
    job.sentBytes = offset;
    job.startTime = Date.now();
    job.lastProgressTime = job.startTime;
    job.lastProgressBytes = job.sentBytes;
    void this.sendUploadBlocks(job);
  }

  private async sendUploadBlocks(job: UploadJob): Promise<void> {
    const chunkSize = 128 * 1024;
    let offset = Math.max(0, job.resumeOffset);
    if (offset >= job.file.size) {
      this.sendMessage({
        fileResponse: {
          done: {
            id: job.id,
            fileNum: job.fileNum
          }
        }
      });
      this.events.emit({
        name: 'job_done',
        id: String(job.id),
        file_num: String(job.fileNum),
        speed: '0'
      });
      this.uploadJobs.delete(job.id);
      return;
    }
    while (offset < job.file.size) {
      if (job.cancelled) {
        return;
      }
      const slice = job.file.slice(offset, offset + chunkSize);
      const buffer = await slice.arrayBuffer();
      if (job.cancelled) {
        return;
      }
      const data = new Uint8Array(buffer);
      this.sendMessage({
        fileResponse: {
          block: {
            id: job.id,
            fileNum: job.fileNum,
            data,
            compressed: false,
            blkId: job.nextBlockId++
          }
        }
      });
      offset += data.length;
      job.sentBytes = offset;
      this.emitJobProgress(job.id, job.fileNum, job.sentBytes, job.startTime);
    }
    this.sendMessage({
      fileResponse: {
        done: {
          id: job.id,
          fileNum: job.fileNum
        }
      }
    });
    this.events.emit({
      name: 'job_done',
      id: String(job.id),
      file_num: String(job.fileNum),
      speed: '0'
    });
    this.uploadJobs.delete(job.id);
  }

  private handleTerminalResponse(resp: Record<string, unknown>): void {
    const response = resp as any;
    let type = '';
    let payload: Record<string, unknown> = {};
    if (response.opened) {
      const opened = response.opened as any;
      type = 'opened';
      payload = {
        terminal_id: Number(opened.terminalId ?? 0),
        success: Boolean(opened.success),
        message: String(opened.message ?? ''),
        pid: Number(opened.pid ?? 0),
        service_id: String(opened.serviceId ?? ''),
        persistent_sessions: opened.persistentSessions ?? []
      };
    } else if (response.data) {
      const data = response.data as any;
      type = 'data';
      const raw = data.data as Uint8Array | undefined;
      payload = {
        terminal_id: Number(data.terminalId ?? 0),
        data: raw ? btoa(String.fromCharCode(...raw)) : ''
      };
    } else if (response.closed) {
      const closed = response.closed as any;
      type = 'closed';
      payload = {
        terminal_id: Number(closed.terminalId ?? 0),
        exit_code: Number(closed.exitCode ?? 0)
      };
    } else if (response.error) {
      const err = response.error as any;
      type = 'error';
      payload = {
        terminal_id: Number(err.terminalId ?? 0),
        message: String(err.message ?? '')
      };
    }
    if (type) {
      this.events.emit({ name: 'terminal_response', type, ...payload });
    }
  }

  private handleMisc(misc: Record<string, unknown>): void {
    const payload = misc as any;
    if (payload.switchDisplay) {
      const sw = payload.switchDisplay as any;
      this.events.emit({
        name: 'switch_display',
        display: String(sw.display ?? 0),
        x: String(sw.x ?? 0),
        y: String(sw.y ?? 0),
        width: String(sw.width ?? 0),
        height: String(sw.height ?? 0),
        cursor_embedded: sw.cursorEmbedded ? '1' : '0',
        original_width: String(sw.originalResolution?.width ?? -1),
        original_height: String(sw.originalResolution?.height ?? -1),
        resolutions: JSON.stringify(sw.resolutions ?? {})
      });
    }
    if (payload.permissionInfo) {
      const info = payload.permissionInfo as any;
      const name = permissionName(info.permission);
      if (name) {
        this.events.emit({
          name: 'permission',
          [name]: info.enabled ? 'true' : 'false'
        });
      }
    }
    if (payload.backNotification) {
      const back = payload.backNotification as any;
      if (back.privacyModeState !== undefined) {
        this.events.emit({ name: 'update_privacy_mode' });
        if (back.details) {
          this.events.emit({ name: 'toast', text: String(back.details) });
        }
      }
      if (back.blockInputState !== undefined) {
        const state = Number(back.blockInputState);
        const on = state === BackNotificationState.BlkOnSucceeded;
        const off = state === BackNotificationState.BlkOffSucceeded;
        if (on || off) {
          this.events.emit({
            name: 'update_block_input_state',
            input_state: on ? 'on' : 'off'
          });
        }
      }
    }
    if (payload.followCurrentDisplay !== undefined) {
      this.events.emit({
        name: 'follow_current_display',
        display_idx: String(payload.followCurrentDisplay ?? 0)
      });
    }
    if (payload.portableServiceRunning !== undefined) {
      this.events.emit({
        name: 'portable_service_running',
        running: payload.portableServiceRunning ? 'true' : 'false'
      });
    }
    if (payload.clientRecordStatus !== undefined) {
      this.events.emit({
        name: 'record_status',
        start: payload.clientRecordStatus ? 'true' : 'false'
      });
    }
    if (payload.supportedEncoding) {
      this.peerEncoding = parsePeerEncoding(payload.supportedEncoding);
    }
    if (payload.closeReason) {
      this.events.emit({
        name: 'msgbox',
        type: 'error',
        title: 'Connection Error',
        text: String(payload.closeReason ?? ''),
        link: ''
      });
    }
  }

  private sendMessage(payload: Record<string, unknown>): void {
    if (!this.proto) {
      return;
    }
    const bytes = this.proto.messageType.encode(payload).finish();
    this.transport.send(bytes);
  }

  private connTypeFromMode(mode: SessionMode): number {
    switch (mode) {
      case 'file-transfer':
        return 1;
      case 'port-forward':
        return 2;
      case 'rdp':
        return 3;
      case 'view-camera':
        return 4;
      case 'terminal':
        return 5;
      default:
        return 0;
    }
  }

  private attachSessionMode(loginRequest: Record<string, unknown>): void {
    switch (this.request.mode) {
      case 'file-transfer':
        loginRequest.fileTransfer = { dir: '', showHidden: false };
        break;
      case 'view-camera':
        loginRequest.viewCamera = {};
        break;
      case 'terminal':
        loginRequest.terminal = {};
        break;
      default:
        break;
    }
  }

  private buildModifiers(payload: Record<string, unknown>): number[] {
    const modifiers: number[] = [];
    if (payload.alt === 'true' || payload.alt === true) {
      modifiers.push(ControlKey.Alt);
    }
    if (payload.ctrl === 'true' || payload.ctrl === true) {
      modifiers.push(ControlKey.Control);
    }
    if (payload.shift === 'true' || payload.shift === true) {
      modifiers.push(ControlKey.Shift);
    }
    if (payload.command === 'true' || payload.command === true) {
      modifiers.push(ControlKey.Meta);
    }
    return modifiers;
  }

  private buildMouseEvent(payload: Record<string, unknown>): {
    mask: number;
    x: number;
    y: number;
    modifiers: number[];
  } | null {
    const type = typeof payload.type === 'string' ? payload.type : 'move';
    const x = Number(payload.x ?? 0);
    const y = Number(payload.y ?? 0);
    const relativeMarker = payload.relative_mouse_mode;
    if (relativeMarker !== undefined && relativeMarker !== null) {
      const active = ['1', 'Y', 'on', 'true'].includes(String(relativeMarker));
      if (!active) {
        return null;
      }
      if (type !== 'move_relative') {
        return null;
      }
      if (x !== 0 || y !== 0) {
        return null;
      }
      if (
        payload.buttons !== undefined ||
        payload.alt !== undefined ||
        payload.ctrl !== undefined ||
        payload.shift !== undefined ||
        payload.command !== undefined
      ) {
        return null;
      }
    }
    const typeValue = mouseTypeValue(type);
    const buttons = normalizeButtons(payload.buttons);
    const mask = typeValue | (buttons << 3);
    return { mask, x, y, modifiers: this.buildModifiers(payload) };
  }
}

async function detectCodecSupport(candidates: string[]): Promise<boolean> {
  for (const codec of candidates) {
    try {
      const supported = await VideoDecoder.isConfigSupported({ codec });
      if (supported.supported) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

async function detectDecoding(): Promise<DecodingAbility> {
  if (typeof VideoDecoder === 'undefined') {
    return { vp9: false, av1: false, h264: false, h265: false };
  }
  const vp9 = await detectCodecSupport(['vp09.00.10.08']);
  const av1 = await detectCodecSupport(['av01.0.08M.08', 'av01.0.04M.08']);
  const h264 = await detectCodecSupport(['avc1.42E01E', 'avc1.4D401E', 'avc1.64001F']);
  const h265 = await detectCodecSupport([
    'hvc1.1.6.L93.B0',
    'hvc1.1.6.L120.B0',
    'hev1.1.6.L93.B0',
    'hev1.1.6.L120.B0'
  ]);
  return { vp9, av1, h264, h265 };
}

const ControlKey = {
  Alt: 1,
  Backspace: 2,
  CapsLock: 3,
  Control: 4,
  Delete: 5,
  DownArrow: 6,
  End: 7,
  Escape: 8,
  F1: 9,
  F10: 10,
  F11: 11,
  F12: 12,
  F2: 13,
  F3: 14,
  F4: 15,
  F5: 16,
  F6: 17,
  F7: 18,
  F8: 19,
  F9: 20,
  Home: 21,
  LeftArrow: 22,
  Meta: 23,
  PageDown: 25,
  PageUp: 26,
  Return: 27,
  RightArrow: 28,
  Shift: 29,
  Space: 30,
  Tab: 31,
  UpArrow: 32,
  Insert: 58,
  VolumeMute: 76,
  VolumeUp: 77,
  VolumeDown: 78,
  Power: 79,
  CtrlAltDel: 100,
  LockScreen: 101
};

const NAME_TO_CONTROL_KEY: Record<string, number> = {
  enter: ControlKey.Return,
  return: ControlKey.Return,
  tab: ControlKey.Tab,
  escape: ControlKey.Escape,
  esc: ControlKey.Escape,
  backspace: ControlKey.Backspace,
  delete: ControlKey.Delete,
  del: ControlKey.Delete,
  home: ControlKey.Home,
  end: ControlKey.End,
  pageup: ControlKey.PageUp,
  pagedown: ControlKey.PageDown,
  left: ControlKey.LeftArrow,
  arrowleft: ControlKey.LeftArrow,
  right: ControlKey.RightArrow,
  arrowright: ControlKey.RightArrow,
  up: ControlKey.UpArrow,
  arrowup: ControlKey.UpArrow,
  down: ControlKey.DownArrow,
  arrowdown: ControlKey.DownArrow,
  space: ControlKey.Space,
  capslock: ControlKey.CapsLock,
  shift: ControlKey.Shift,
  ctrl: ControlKey.Control,
  control: ControlKey.Control,
  alt: ControlKey.Alt,
  meta: ControlKey.Meta,
  command: ControlKey.Meta,
  insert: ControlKey.Insert,
  f1: ControlKey.F1,
  f2: ControlKey.F2,
  f3: ControlKey.F3,
  f4: ControlKey.F4,
  f5: ControlKey.F5,
  f6: ControlKey.F6,
  f7: ControlKey.F7,
  f8: ControlKey.F8,
  f9: ControlKey.F9,
  f10: ControlKey.F10,
  f11: ControlKey.F11,
  f12: ControlKey.F12
};

function toControlKey(name: string): number | null {
  const normalized = name.toLowerCase().replace(/\s+/g, '');
  const key = NAME_TO_CONTROL_KEY[normalized];
  return key ?? null;
}

function flutterSpecialKey(usbHid: number): number | null {
  switch (usbHid) {
    case 0x007f:
      return ControlKey.VolumeMute;
    case 0x0080:
      return ControlKey.VolumeUp;
    case 0x0081:
      return ControlKey.VolumeDown;
    case 0x0066:
      return ControlKey.Power;
    default:
      return null;
  }
}

function mouseTypeValue(type: string): number {
  switch (type) {
    case 'down':
      return 1;
    case 'up':
      return 2;
    case 'wheel':
      return 3;
    case 'trackpad':
      return 4;
    case 'move_relative':
      return 5;
    default:
      return 0;
  }
}

function normalizeButtons(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed in BUTTON_MASK) {
      return BUTTON_MASK[trimmed];
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function parseImageQuality(value: string): ImageQuality | null {
  switch (value) {
    case 'low':
      return ImageQuality.Low;
    case 'balanced':
      return ImageQuality.Balanced;
    case 'best':
      return ImageQuality.Best;
    default:
      return null;
  }
}

function normalizePreferCodec(
  value: string,
  decoding: DecodingAbility
): SupportedDecodingPreferCodec {
  switch (value) {
    case 'vp9':
      return decoding.vp9 ? SupportedDecodingPreferCodec.VP9 : SupportedDecodingPreferCodec.Auto;
    case 'h264':
      return decoding.h264 ? SupportedDecodingPreferCodec.H264 : SupportedDecodingPreferCodec.Auto;
    case 'av1':
      return decoding.av1 ? SupportedDecodingPreferCodec.AV1 : SupportedDecodingPreferCodec.Auto;
    case 'vp8':
      return SupportedDecodingPreferCodec.Auto;
    case 'h265':
      return decoding.h265 ? SupportedDecodingPreferCodec.H265 : SupportedDecodingPreferCodec.Auto;
    default:
      return SupportedDecodingPreferCodec.Auto;
  }
}

function parsePeerEncoding(value: unknown): PeerEncoding {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const enc = value as Record<string, unknown>;
  return {
    vp8: Boolean(enc.vp8),
    av1: Boolean(enc.av1),
    h264: Boolean(enc.h264),
    h265: Boolean(enc.h265)
  };
}

function isIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return false;
    }
    const num = Number.parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
}

function isDomain(value: string): boolean {
  if (!value || value.length > 253) {
    return false;
  }
  if (value.includes('..') || value.startsWith('-') || value.endsWith('-')) {
    return false;
  }
  return /^[A-Za-z0-9.-]+$/.test(value);
}

function permissionName(value: unknown): string | null {
  const code = Number(value ?? -1);
  switch (code) {
    case 0:
      return 'keyboard';
    case 2:
      return 'clipboard';
    case 3:
      return 'audio';
    case 4:
      return 'file';
    case 5:
      return 'restart';
    case 6:
      return 'recording';
    case 7:
      return 'block_input';
    default:
      return null;
  }
}

function getVersionNumber(v: string): number {
  const [base, patch] = v.split('-', 2);
  let n = 0;
  let last = 0;
  for (const part of base.split('.')) {
    last = Number(part) || 0;
    n = n * 1000 + last;
  }
  n = n - last + last * 10;
  if (patch) {
    n += Number(patch) || 0;
  }
  return n;
}

function sanitizeFileName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'download.bin';
  }
  const normalized = trimmed.replace(/^[\\/]+/, '');
  const safe = normalized.replace(/[\\/]/g, '_');
  const cleaned = safe.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
  return cleaned || 'download.bin';
}
