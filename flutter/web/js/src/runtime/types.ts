export type SessionMode =
  | 'remote'
  | 'file-transfer'
  | 'view-camera'
  | 'terminal'
  | 'port-forward'
  | 'rdp';

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'auth'
  | 'streaming'
  | 'closed'
  | 'error';

export type ConnectRequest = {
  id: string;
  password?: string;
  sessionId?: string;
  mode: SessionMode;
  forceRelay?: boolean;
};

export type SessionContext = {
  rendezvousServer: string;
  relayServer: string;
  apiServer: string;
  key: string;
  token: string;
  allowDirectIpAccess: boolean;
  directAccessPort: number;
  myId: string;
  myName: string;
  version: string;
  platform: string;
};
