import { Logger } from '../core/logger';
import { RuntimeConfig } from '../core/config';
import { generateUuid } from '../core/uuid';
import { SecretBoxCipher, createSymmetricKey, decodeBase64, signOpen } from './crypto';
import { MessageInbox } from './inbox';
import { ProtoRoots } from './proto';
import { WebSocketTransport } from './transport';

export type RelayInfo = {
  relayServer: string;
  relayEndpoint: string;
  uuid: string;
  signedIdPk: Uint8Array;
};

export type DirectInfo = {
  endpoint: string;
  signedIdPk: Uint8Array;
};

export type ConnectionRoute =
  | { kind: 'direct'; direct: DirectInfo }
  | { kind: 'relay'; relay: RelayInfo };

export type RendezvousOptions = {
  peerId: string;
  relayServer: string;
  rendezvousServer: string;
  apiServer: string;
  token?: string;
  key?: string;
  connType: number;
  secure: boolean;
  forceRelay?: boolean;
  version?: string;
};

const DEFAULT_RENDEZVOUS_PORT = 21116;
const DEFAULT_RELAY_PORT = 21117;
type RouteKind = 'auto' | 'rendezvous' | 'relay';

export class RendezvousClient {
  private readonly logger: Logger;
  private readonly config: RuntimeConfig;
  private readonly proto: ProtoRoots;

  constructor(config: RuntimeConfig, proto: ProtoRoots, logger?: Logger) {
    this.config = config;
    this.proto = proto;
    this.logger = logger ?? new Logger('rendezvous');
  }

  async requestConnectionRoute(options: RendezvousOptions): Promise<ConnectionRoute> {
    if (options.forceRelay) {
      const relay = await this.requestRelay(options);
      return { kind: 'relay', relay };
    }
    const directProbe = await this.requestDirect(options);
    if (directProbe?.direct) {
      return { kind: 'direct', direct: directProbe.direct };
    }
    if (directProbe?.relay) {
      return { kind: 'relay', relay: directProbe.relay };
    }
    const relay = await this.requestRelay(options);
    return { kind: 'relay', relay };
  }

  async requestRelay(options: RendezvousOptions): Promise<RelayInfo> {
    const endpoint = checkWsEndpoint(
      options.rendezvousServer,
      options.relayServer,
      options.apiServer,
      'rendezvous',
      options.rendezvousServer
    );
    const transport = new WebSocketTransport('rendezvous');
    await transport.connect(endpoint);
    const inbox = new MessageInbox(transport);

    await this.secureIfNeeded(transport, inbox, options.key ?? '', endpoint);

    const uuid = generateUuid();
    const requestRelay = {
      id: options.peerId,
      uuid,
      relayServer: options.relayServer ?? '',
      secure: options.secure,
      connType: options.connType,
      token: options.token ?? ''
    };
    const payload = this.proto.rendezvousType.encode({ requestRelay }).finish();
    transport.send(payload);

    for (;;) {
      const data = await inbox.next(15000);
      const msg = this.proto.rendezvousType
        .decode(data)
        .toObject({
          longs: String,
          bytes: Uint8Array,
          defaults: false
        }) as Record<string, unknown>;
      const relayResponse = msg.relayResponse as
        | {
            relayServer?: string;
            uuid?: string;
            pk?: Uint8Array;
            refuseReason?: string;
          }
        | undefined;
      if (relayResponse) {
        if (relayResponse.refuseReason) {
          throw new Error(relayResponse.refuseReason);
        }
        const relayServer = relayResponse.relayServer || options.relayServer;
        const relayEndpoint = checkWsEndpoint(
          relayServer,
          relayServer,
          options.apiServer,
          'relay',
          options.rendezvousServer
        );
        inbox.close();
        transport.close();
        return {
          relayServer,
          relayEndpoint,
          uuid: relayResponse.uuid ?? uuid,
          signedIdPk: relayResponse.pk ?? new Uint8Array()
        };
      }
    }
  }

  private async requestDirect(
    options: RendezvousOptions
  ): Promise<{ direct?: DirectInfo; relay?: RelayInfo } | null> {
    const endpoint = checkWsEndpoint(
      options.rendezvousServer,
      options.relayServer,
      options.apiServer,
      'rendezvous',
      options.rendezvousServer
    );
    if (!endpoint) {
      return null;
    }
    const transport = new WebSocketTransport('rendezvous:direct');
    const inbox = new MessageInbox(transport);
    try {
      await transport.connect(endpoint);
      await this.secureIfNeeded(transport, inbox, options.key ?? '', endpoint);
      for (let attempt = 1; attempt <= 3; attempt++) {
        const punchHoleRequest = {
          id: options.peerId,
          natType: 0,
          licenceKey: options.key ?? '',
          connType: options.connType,
          token: options.token ?? '',
          version: options.version ?? '',
          udpPort: 0,
          forceRelay: Boolean(options.forceRelay)
        };
        const request = this.proto.rendezvousType
          .encode({ punchHoleRequest })
          .finish();
        transport.send(request);
        let data: Uint8Array;
        try {
          data = await inbox.next(attempt * 3000);
        } catch {
          continue;
        }
        const msg = this.decodeRendezvousMessage(data);
        const relay = this.parseRelayResponse(msg, options);
        if (relay) {
          return { relay };
        }
        const punch = msg.punchHoleResponse as
          | {
              socketAddr?: Uint8Array;
              pk?: Uint8Array;
              relayServer?: string;
              isUdp?: boolean;
              failure?: number | string;
              otherFailure?: string;
            }
          | undefined;
        if (!punch) {
          continue;
        }
        if (punch.isUdp) {
          continue;
        }
        if (punch.otherFailure) {
          throw new Error(punch.otherFailure);
        }
        const socketAddr = punch.socketAddr;
        if (!socketAddr || socketAddr.length === 0) {
          throw new Error(this.parsePunchHoleFailure(punch.failure));
        }
        const peerAddress = decodeAddrMangle(socketAddr);
        if (!peerAddress) {
          continue;
        }
        const relayServer = punch.relayServer || options.relayServer;
        const endpoint = checkWsEndpoint(
          peerAddress,
          relayServer,
          options.apiServer,
          'auto',
          options.rendezvousServer
        );
        if (!endpoint) {
          continue;
        }
        return {
          direct: {
            endpoint,
            signedIdPk: punch.pk ?? new Uint8Array()
          }
        };
      }
      return null;
    } finally {
      inbox.close();
      transport.close();
    }
  }

  private decodeRendezvousMessage(data: Uint8Array): Record<string, unknown> {
    return this.proto.rendezvousType
      .decode(data)
      .toObject({
        longs: String,
        bytes: Uint8Array,
        defaults: false
      }) as Record<string, unknown>;
  }

  private parseRelayResponse(
    msg: Record<string, unknown>,
    options: RendezvousOptions
  ): RelayInfo | null {
    const relayResponse = msg.relayResponse as
      | {
          relayServer?: string;
          uuid?: string;
          pk?: Uint8Array;
          refuseReason?: string;
        }
      | undefined;
    if (!relayResponse) {
      return null;
    }
    if (relayResponse.refuseReason) {
      throw new Error(relayResponse.refuseReason);
    }
    const relayServer = relayResponse.relayServer || options.relayServer;
    return {
      relayServer,
      relayEndpoint: checkWsEndpoint(
        relayServer,
        relayServer,
        options.apiServer,
        'relay',
        options.rendezvousServer
      ),
      uuid: relayResponse.uuid ?? generateUuid(),
      signedIdPk: relayResponse.pk ?? new Uint8Array()
    };
  }

  private parsePunchHoleFailure(failure: number | string | undefined): string {
    if (typeof failure === 'string' && failure.length > 0) {
      return failure;
    }
    switch (failure) {
      case 0:
        return 'ID does not exist';
      case 2:
        return 'Remote desktop is offline';
      case 3:
        return 'Key mismatch';
      case 4:
        return 'Key overuse';
      default:
        return 'Punch hole failed';
    }
  }

  private async secureIfNeeded(
    transport: WebSocketTransport,
    inbox: MessageInbox,
    key: string,
    endpoint: string
  ): Promise<void> {
    if (endpoint.startsWith('wss://')) {
      return;
    }
    if (!key) {
      this.logger.warn('No rendezvous public key configured; skipping secure handshake');
      return;
    }
    const rsPk = decodeBase64(key);
    try {
      const data = await inbox.next(8000);
      const msg = this.proto.rendezvousType
        .decode(data)
        .toObject({
          longs: String,
          bytes: Uint8Array,
          defaults: false
        }) as Record<string, unknown>;
      const keyExchange = msg.keyExchange as { keys?: Uint8Array[] } | undefined;
      if (!keyExchange || !keyExchange.keys || keyExchange.keys.length !== 1) {
        inbox.pushFront(data);
        return;
      }
      const signedKey = keyExchange.keys[0];
      const theirPk = signOpen(signedKey, rsPk);
      const { publicKey, symmetricKey, sealed } = createSymmetricKey(theirPk);
      const reply = this.proto.rendezvousType.encode({
        keyExchange: { keys: [publicKey, sealed] }
      }).finish();
      transport.send(reply);
      transport.setCipher(new SecretBoxCipher(symmetricKey));
      this.logger.info('Rendezvous secure channel established');
    } catch (err) {
      this.logger.warn('Secure rendezvous handshake failed', err);
    }
  }
}

export function checkWsEndpoint(
  endpoint: string,
  relayServer: string,
  apiServer: string,
  routeKind: RouteKind = 'auto',
  rendezvousServer = ''
): string {
  if (!endpoint) {
    return '';
  }
  const raw = endpoint.trim();
  if (!raw) {
    return '';
  }
  if (raw.startsWith('ws://') || raw.startsWith('wss://')) {
    return raw;
  }

  const parsed = parseServerEndpoint(raw);
  if (!parsed) {
    return raw;
  }

  const relayParsed = parseServerEndpoint(relayServer.trim());
  const rendezvousParsed = parseServerEndpoint(rendezvousServer.trim());
  const rendezvousPort = rendezvousParsed?.port ?? DEFAULT_RENDEZVOUS_PORT;
  const relayPort = relayParsed?.port ?? DEFAULT_RELAY_PORT;
  const endpointPort =
    parsed.port ?? (routeKind === 'relay' ? relayPort : rendezvousPort);

  let relay = routeKind === 'relay';
  if (routeKind === 'auto') {
    if (endpointPort === rendezvousPort) {
      relay = false;
    } else if (endpointPort === rendezvousPort - 1) {
      relay = false;
    } else if (endpointPort === relayPort || endpointPort === rendezvousPort + 1) {
      relay = true;
    } else {
      relay = true;
    }
  }

  let dstPort = endpointPort + 2;
  if (!relay && endpointPort === rendezvousPort - 1) {
    dstPort = endpointPort + 3;
  }

  if (parsed.isIp) {
    return `ws://${formatHostForUrl(parsed.host, parsed.isIpv6)}:${dstPort}`;
  }

  const protocol = resolveDomainProtocol(apiServer);
  const path = relay ? '/ws/relay' : '/ws/id';
  return `${protocol}://${parsed.host}${path}`;
}

type ParsedServerEndpoint = {
  host: string;
  port: number | null;
  isIpv6: boolean;
  isIp: boolean;
};

function parseServerEndpoint(endpoint: string): ParsedServerEndpoint | null {
  if (!endpoint) {
    return null;
  }
  const trimmed = endpoint.trim();
  if (!trimmed) {
    return null;
  }
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('ws://') ||
    trimmed.startsWith('wss://')
  ) {
    try {
      const url = new URL(trimmed);
      const host = url.hostname;
      if (!host) {
        return null;
      }
      const isIpv6 = host.includes(':');
      const port = url.port ? Number(url.port) : null;
      if (url.port && (!Number.isInteger(port) || port <= 0 || port > 65535)) {
        return null;
      }
      return {
        host,
        port,
        isIpv6,
        isIp: isIpv4Address(host) || isIpv6
      };
    } catch {
      return null;
    }
  }

  let hostPart = trimmed;
  const pathStart = hostPart.search(/[/?#]/);
  if (pathStart >= 0) {
    hostPart = hostPart.slice(0, pathStart);
  }
  hostPart = hostPart.trim();
  if (!hostPart) {
    return null;
  }

  if (hostPart.startsWith('[')) {
    const end = hostPart.indexOf(']');
    if (end === -1) {
      return null;
    }
    const host = hostPart.slice(1, end);
    const rest = hostPart.slice(end + 1);
    if (!rest) {
      return { host, port: null, isIpv6: true, isIp: true };
    }
    if (!rest.startsWith(':')) {
      return null;
    }
    const port = Number.parseInt(rest.slice(1), 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      return null;
    }
    return { host, port, isIpv6: true, isIp: true };
  }

  const firstColon = hostPart.indexOf(':');
  const lastColon = hostPart.lastIndexOf(':');
  if (firstColon !== -1 && firstColon === lastColon) {
    const host = hostPart.slice(0, firstColon);
    const port = Number.parseInt(hostPart.slice(firstColon + 1), 10);
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
      return null;
    }
    return { host, port, isIpv6: false, isIp: isIpv4Address(host) };
  }
  if (firstColon === -1) {
    return {
      host: hostPart,
      port: null,
      isIpv6: false,
      isIp: isIpv4Address(hostPart)
    };
  }
  return { host: hostPart, port: null, isIpv6: true, isIp: true };
}

function resolveDomainProtocol(apiServer: string): 'ws' | 'wss' {
  if (apiServer.trim().toLowerCase().startsWith('https')) {
    return 'wss';
  }
  return 'ws';
}

function formatHostForUrl(host: string, isIpv6: boolean): string {
  return isIpv6 ? `[${host}]` : host;
}

function isIpv4Address(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return false;
    }
    const number = Number.parseInt(part, 10);
    return number >= 0 && number <= 255;
  });
}

function decodeAddrMangle(bytes: Uint8Array): string | null {
  if (!bytes || bytes.length === 0) {
    return null;
  }
  if (bytes.length > 16) {
    if (bytes.length !== 18) {
      return null;
    }
    const port = Number(bytes[16]) | (Number(bytes[17]) << 8);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      return null;
    }
    const host = ipv6BytesToString(bytes.subarray(0, 16));
    return `[${host}]:${port}`;
  }
  const padded = new Uint8Array(16);
  padded.set(bytes);
  let value = BigInt(0);
  const shift8 = BigInt(8);
  const shift17 = BigInt(17);
  const shift49 = BigInt(49);
  const maskTm = BigInt('0xffffffff');
  const maskIp = BigInt('0xffffffff');
  const maskPortWide = BigInt('0xffffff');
  const maskPortNarrow = BigInt('0xffff');
  const maskByte = BigInt('0xff');
  const maxPort = BigInt(65535);
  for (let i = 15; i >= 0; i--) {
    value = (value << shift8) | BigInt(padded[i]);
  }
  const tm = (value >> shift17) & maskTm;
  const ipRaw = ((value >> shift49) - tm) & maskIp;
  const portRaw = (value & maskPortWide) - (tm & maskPortNarrow);
  if (portRaw <= BigInt(0) || portRaw > maxPort) {
    return null;
  }
  const b0 = Number(ipRaw & maskByte);
  const b1 = Number((ipRaw >> shift8) & maskByte);
  const b2 = Number((ipRaw >> BigInt(16)) & maskByte);
  const b3 = Number((ipRaw >> BigInt(24)) & maskByte);
  return `${b0}.${b1}.${b2}.${b3}:${Number(portRaw)}`;
}

function ipv6BytesToString(bytes: Uint8Array): string {
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    const value = (Number(bytes[i]) << 8) | Number(bytes[i + 1]);
    groups.push(value.toString(16));
  }
  return groups.join(':');
}
