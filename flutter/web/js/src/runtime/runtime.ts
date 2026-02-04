import { loadConfig, RuntimeConfig } from '../core/config';
import { StorageStore } from '../core/storage';
import { detectOs, screenInfo } from '../core/platform';
import { generateUuid } from '../core/uuid';
import { EventDispatcher } from '../core/events';
import { Logger } from '../core/logger';
import { ConnectRequest, SessionContext, SessionMode } from './types';
import { WebSession } from './session';
import { loadProtos, ProtoRoots } from './proto';
import { MessageInbox } from './inbox';
import { WebSocketTransport } from './transport';
import { checkWsEndpoint } from './rendezvous';

type OptionPayload = { name?: string; value?: unknown };
type AccountAuthPayload = { op?: string; remember?: boolean };
type AccountAuthResult = {
  state_msg: string;
  failed_msg: string;
  url?: string;
  url_launched?: boolean;
  auth_body?: unknown;
};
type OidcAuthUrlResponse = { code?: string; url?: string; error?: string };
type OidcAuthQueryResponse = {
  error?: string;
  access_token?: string;
  type?: string;
  user?: { name?: string; status?: unknown };
  [key: string]: unknown;
};
type BootstrapConfigPayload = {
  appName?: string;
  apiServer?: string;
  rendezvousServers?: string[] | string;
  relayServers?: string[] | string;
  rsPubKey?: string;
  isPublicServer?: boolean;
  env?: Record<string, unknown>;
};

export class WebRuntime {
  private readonly config: RuntimeConfig;
  private readonly store: StorageStore;
  private readonly events: EventDispatcher;
  private readonly logger: Logger;
  private readonly optionDefaults = new Map<string, string>();
  private readonly localOptionDefaults = new Map<string, string>();
  private readonly flutterLocalOptionDefaults = new Map<string, string>();
  private readonly userDefaultOptionDefaults = new Map<string, string>();
  private currentSession?: WebSession;
  private initialized = false;
  private nextFileHandle = 1;
  private readonly fileHandles = new Map<number, File[]>();
  private protoPromise?: Promise<ProtoRoots>;
  private accountAuthNonce = 0;
  private accountAuthAbort?: AbortController;
  private connectStatusTimer?: number;
  private connectStatusDebounceTimer?: number;

  constructor() {
    this.config = loadConfig();
    this.store = new StorageStore('camellia.web.');
    this.events = new EventDispatcher();
    this.logger = new Logger('runtime', this.isDebug());
    this.refreshDefaultOptions();
  }

  init(): void {
    if (this.initialized) {
      if (typeof window.onInitFinished === 'function') {
        window.onInitFinished();
      }
      return;
    }
    this.initialized = true;
    this.logger.info('Initializing web runtime');
    this.bindEventSinks();
    this.store.ensure('uuid', generateUuid);
    this.store.ensure('my_name', () => this.config.profile.name);
    this.store.ensure('my_id', () => this.ensureMyId());
    this.store.ensure('permanent_password', () => '');
    this.ensureTemporaryPassword();
    this.startConnectStatusProbe();
    if (typeof window.onInitFinished === 'function') {
      window.onInitFinished();
    }
  }

  setByName(name: string, arg0?: unknown, arg1?: unknown): string {
    switch (name) {
      case 'session_add_sync':
        return this.handleSessionAdd(arg0);
      case 'session_start':
        this.handleSessionStart(arg0);
        return '';
      case 'session_close':
      case 'close':
        this.currentSession?.close();
        return '';
      case 'reconnect':
        this.reconnect();
        return '';
      case 'refresh':
        if (this.currentSession) {
          this.currentSession.refreshVideo();
        }
        return '';
      case 'option:toggle':
        return this.toggleOption(String(arg0 ?? ''));
      case 'option:session':
      case 'option:local':
      case 'option:flutter:peer':
      case 'option:flutter:local':
      case 'option:user:default':
        this.setOptionPayload(name, arg0, arg1);
        return '';
      case 'option':
        this.setOptionPayload('option', arg0, arg1);
        return '';
      case 'common':
        this.setCommonPayload(arg0);
        return '';
      case 'options':
        this.setOptionsPayload(arg0);
        return '';
      case 'bootstrap_config':
        this.applyBootstrapConfig(arg0);
        return '';
      case 'fav':
        this.store.set('fav', arg0 ?? '');
        return '';
      case 'save_ab':
        this.store.set('address_book', arg0 ?? '');
        return '';
      case 'clear_ab':
        this.store.set('address_book', '');
        return '';
      case 'save_group':
        this.store.set('groups', arg0 ?? '');
        return '';
      case 'clear_group':
        this.store.set('groups', '');
        return '';
      case 'remember':
        this.store.set('remember', arg0 ?? 'false');
        return '';
      case 'envvar':
        if (typeof arg0 === 'string' && arg0.trim().startsWith('{')) {
          const payload = this.safeJson(arg0) as OptionPayload;
          if (typeof payload.name === 'string') {
            this.setEnvValue(payload.name, payload.value ?? '');
          }
        } else if (typeof arg0 === 'string') {
          this.setEnvValue(arg0, arg1 ?? '');
        }
        return '';
      case 'cursor':
        if (typeof arg0 === 'string') {
          const trimmed = arg0.trim();
          if (trimmed.startsWith('{')) {
            const payload = this.safeJson(arg0);
            const url = String(payload.url ?? '');
            const hotx = Number(payload.hotx ?? 0);
            const hoty = Number(payload.hoty ?? 0);
            if (url) {
              document.body.style.cursor = `url(${url}) ${hotx} ${hoty}, auto`;
            } else {
              document.body.style.cursor = 'auto';
            }
          } else {
            document.body.style.cursor = arg0;
          }
        }
        return '';
      case 'flutter_key_event':
        if (this.currentSession && typeof arg0 === 'string') {
          this.currentSession.flutterKeyEvent(this.safeJson(arg0));
        }
        return '';
      case 'send_mouse':
        if (this.currentSession && typeof arg0 === 'string') {
          this.currentSession.sendMouse(this.safeJson(arg0));
        }
        return '';
      case 'input_string':
        if (this.currentSession && typeof arg0 === 'string') {
          this.currentSession.inputString(arg0);
        }
        return '';
      case 'input_key':
        if (this.currentSession && typeof arg0 === 'string') {
          this.currentSession.inputKey(this.safeJson(arg0));
        }
        return '';
      case 'login':
        if (this.currentSession && typeof arg0 === 'string') {
          const payload = this.safeJson(arg0) as {
            password?: string;
            os_username?: string;
            os_password?: string;
            remember?: boolean;
          };
          this.currentSession.login({
            password: payload.password ?? '',
            osUsername: payload.os_username ?? '',
            osPassword: payload.os_password ?? '',
            remember: payload.remember ?? false
          });
        }
        return '';
      case 'send_2fa':
        if (this.currentSession && typeof arg0 === 'string') {
          const payload = this.safeJson(arg0) as { code?: string };
          if (payload.code) {
            this.currentSession.sendTwoFactor(payload.code);
          }
        }
        return '';
      case 'input_os_password':
        if (this.currentSession && typeof arg0 === 'string') {
          this.currentSession.login({
            password: '',
            osPassword: arg0
          });
        }
        return '';
      case 'send_chat':
        if (this.currentSession && typeof arg0 === 'string') {
          this.currentSession.sendChat(arg0);
        }
        return '';
      case 'toggle_privacy_mode':
        if (this.currentSession && typeof arg0 === 'string') {
          const payload = this.safeJson(arg0) as {
            impl_key?: string;
            on?: boolean;
          };
          this.currentSession.togglePrivacyMode(
            String(payload.impl_key ?? ''),
            Boolean(payload.on)
          );
          const enabled = Boolean(payload.on);
          this.store.set('option:toggle:privacy-mode', enabled.toString());
          if (enabled) {
            const implKey = String(payload.impl_key ?? '');
            const fallback =
              this.store.get('option:session:privacy-mode-impl-key') ||
              'privacy_mode_impl_mag';
            this.store.set(
              'option:session:privacy-mode-impl-key',
              implKey || fallback
            );
          } else {
            this.store.set('option:session:privacy-mode-impl-key', '');
          }
        }
        return '';
      case 'toggle_virtual_display':
        if (this.currentSession && typeof arg0 === 'string') {
          const payload = this.safeJson(arg0) as { index?: number; on?: boolean };
          this.currentSession.toggleVirtualDisplay(
            Number(payload.index ?? 0),
            Boolean(payload.on)
          );
        }
        return '';
      case 'lock_screen':
        this.currentSession?.lockScreen();
        return '';
      case 'ctrl_alt_del':
        this.currentSession?.ctrlAltDel();
        return '';
      case 'switch_display':
        if (this.currentSession && typeof arg0 === 'string') {
          const payload = this.safeJson(arg0) as { value?: number[] };
          const displays = Array.isArray(payload.value) ? payload.value : [];
          this.currentSession.switchDisplay(displays);
        }
        return '';
      case 'change_resolution':
        if (this.currentSession && typeof arg0 === 'string') {
          const payload = this.safeJson(arg0) as {
            display?: number;
            width?: number;
            height?: number;
          };
          this.currentSession.changeResolution(
            Number(payload.display ?? 0),
            Number(payload.width ?? 0),
            Number(payload.height ?? 0)
          );
        }
        return '';
      case 'selected_sid':
        if (this.currentSession) {
          const sid = Number(arg0 ?? 0);
          this.currentSession.selectSession(sid);
        }
        return '';
      case 'image_quality':
        if (this.currentSession && typeof arg0 === 'string') {
          const customQuality = Number(
            this.store.get('custom_image_quality', '0')
          );
          const customFps = Number(this.store.get('custom-fps', '0'));
          this.store.set('image_quality', arg0);
          this.currentSession.setImageQuality(
            arg0,
            Number.isFinite(customQuality) ? customQuality : undefined,
            Number.isFinite(customFps) ? customFps : undefined
          );
        }
        return '';
      case 'custom_image_quality':
        if (this.currentSession) {
          const value = Number(arg0 ?? 0);
          this.store.set('custom_image_quality', value);
          const fps = Number(this.store.get('custom-fps', '0'));
          this.currentSession.setCustomImageQuality(
            value,
            Number.isFinite(fps) ? fps : undefined
          );
          if (this.store.get('image_quality') === 'custom') {
            this.currentSession.setImageQuality('custom', value, fps);
          }
        }
        return '';
      case 'custom-fps':
        if (this.currentSession) {
          const fps = Number(arg0 ?? 0);
          this.store.set('custom-fps', fps);
          this.currentSession.setCustomFps(fps);
        }
        return '';
      case 'change_prefer_codec':
        if (this.currentSession) {
          const preference = this.store.get('option:session:codec-preference', 'auto');
          const preferI444 =
            this.store.get('option:toggle:i444', 'false') === 'true';
          void this.currentSession.changePreferCodec(preference, preferI444);
        }
        return '';
      case 'restart':
        this.currentSession?.restartRemote();
        return '';
      case 'elevate_direct':
        this.currentSession?.elevateDirect();
        return '';
      case 'elevate_with_logon':
        if (this.currentSession && typeof arg0 === 'string') {
          const payload = this.safeJson(arg0) as { username?: string; password?: string };
          this.currentSession.elevateWithLogon(
            String(payload.username ?? ''),
            String(payload.password ?? '')
          );
        }
        return '';
      case 'open_terminal':
        if (this.currentSession && typeof arg0 === 'string') {
          const payload = this.safeJson(arg0) as {
            terminal_id?: number;
            rows?: number;
            cols?: number;
          };
          this.currentSession.openTerminal(
            Number(payload.terminal_id ?? 0),
            Number(payload.rows ?? 0),
            Number(payload.cols ?? 0)
          );
        }
        return '';
      case 'send_terminal_input':
        if (this.currentSession && typeof arg0 === 'string') {
          const payload = this.safeJson(arg0) as { terminal_id?: number; data?: string };
          this.currentSession.sendTerminalInput(
            Number(payload.terminal_id ?? 0),
            String(payload.data ?? '')
          );
        }
        return '';
      case 'resize_terminal':
        if (this.currentSession && typeof arg0 === 'string') {
          const payload = this.safeJson(arg0) as {
            terminal_id?: number;
            rows?: number;
            cols?: number;
          };
          this.currentSession.resizeTerminal(
            Number(payload.terminal_id ?? 0),
            Number(payload.rows ?? 0),
            Number(payload.cols ?? 0)
          );
        }
        return '';
      case 'close_terminal':
        if (this.currentSession && typeof arg0 === 'string') {
          const payload = this.safeJson(arg0) as { terminal_id?: number };
          this.currentSession.closeTerminal(Number(payload.terminal_id ?? 0));
        }
        return '';
      case 'send_files':
        this.handleSendFiles(arg0);
        return '';
      case 'send_local_files':
        this.handleSendLocalFiles(arg0);
        return '';
      case 'select_files':
        this.handleSelectFiles(Boolean(arg0));
        return '';
      case 'create_dir':
        if (this.currentSession && typeof arg0 === 'string') {
          const payload = this.safeJson(arg0) as {
            id?: number;
            path?: string;
            is_remote?: boolean;
          };
          if (payload.is_remote) {
            this.currentSession.createDir(
              Number(payload.id ?? 0),
              String(payload.path ?? '')
            );
          } else {
            this.emitJobError(payload.id, 'one-way-file-transfer-tip');
          }
        }
        return '';
      case 'remove_file':
        if (this.currentSession && typeof arg0 === 'string') {
          const payload = this.safeJson(arg0) as {
            id?: number;
            path?: string;
            file_num?: number;
            is_remote?: boolean;
          };
          if (payload.is_remote) {
            this.currentSession.removeFile(
              Number(payload.id ?? 0),
              String(payload.path ?? ''),
              Number(payload.file_num ?? 0)
            );
          } else {
            this.emitJobError(payload.id, 'one-way-file-transfer-tip');
          }
        }
        return '';
      case 'read_dir_to_remove_recursive':
        if (this.currentSession && typeof arg0 === 'string') {
          const payload = this.safeJson(arg0) as {
            id?: number;
            path?: string;
            is_remote?: boolean;
            show_hidden?: boolean;
          };
          if (payload.is_remote) {
            this.currentSession.readAllFiles(
              Number(payload.id ?? 0),
              String(payload.path ?? ''),
              Boolean(payload.show_hidden)
            );
          } else {
            this.emitJobError(payload.id, 'one-way-file-transfer-tip');
          }
        }
        return '';
      case 'remove_all_empty_dirs':
        if (this.currentSession && typeof arg0 === 'string') {
          const payload = this.safeJson(arg0) as {
            id?: number;
            path?: string;
            is_remote?: boolean;
          };
          if (payload.is_remote) {
            this.currentSession.removeDir(
              Number(payload.id ?? 0),
              String(payload.path ?? ''),
              true
            );
          } else {
            this.emitJobError(payload.id, 'one-way-file-transfer-tip');
          }
        }
        return '';
      case 'cancel_job':
        if (this.currentSession) {
          this.currentSession.cancelJob(Number(arg0 ?? 0));
        }
        return '';
      case 'confirm_override_file':
        if (this.currentSession && typeof arg0 === 'string') {
          const payload = this.safeJson(arg0) as {
            id?: number;
            file_num?: number;
            need_override?: boolean;
          };
          this.currentSession.confirmOverrideFile(
            Number(payload.id ?? 0),
            Number(payload.file_num ?? 0),
            Boolean(payload.need_override)
          );
        }
        return '';
      case 'rename_file':
        if (this.currentSession && typeof arg0 === 'string') {
          const payload = this.safeJson(arg0) as {
            id?: number;
            path?: string;
            new_name?: string;
            is_remote?: boolean;
          };
          if (payload.is_remote) {
            this.currentSession.renameFile(
              Number(payload.id ?? 0),
              String(payload.path ?? ''),
              String(payload.new_name ?? '')
            );
          } else {
            this.emitJobError(payload.id, 'one-way-file-transfer-tip');
          }
        }
        return '';
      case 'send_note':
        if (typeof arg0 === 'string') {
          this.store.set('last_audit_note', arg0);
        }
        return '';
      case 'load_ab':
        if (typeof window.onLoadAbFinished === 'function') {
          window.onLoadAbFinished(this.store.get('address_book', '[]'));
        }
        return '';
      case 'load_group':
        if (typeof window.onLoadGroupFinished === 'function') {
          window.onLoadGroupFinished(this.store.get('groups', '[]'));
        }
        return '';
      case 'query_onlines':
        this.handleQueryOnlines(arg0);
        return '';
      case 'check_connect_status':
        this.startConnectStatusProbe();
        return '';
      case 'account_auth':
        this.startAccountAuth(arg0);
        return '';
      case 'account_auth_cancel':
        this.cancelAccountAuth();
        return '';
      case 'update_temporary_password':
        this.ensureTemporaryPassword(true);
        return '';
      case 'permanent_password':
        if (typeof arg0 === 'string') {
          this.store.set('permanent_password', arg0);
        }
        return '';
      case 'read_remote_dir':
        if (this.currentSession && typeof arg0 === 'string') {
          const payload = this.safeJson(arg0) as {
            path?: string;
            include_hidden?: boolean;
          };
          this.currentSession.readRemoteDir(
            payload.path ?? '',
            Boolean(payload.include_hidden)
          );
        }
        return '';
      default:
        if (arg1 !== undefined) {
          this.store.set(`${name}:${String(arg0)}`, arg1);
        } else if (arg0 !== undefined) {
          this.store.set(name, arg0);
        }
        return '';
    }
  }

  getByName(name: string, arg0?: unknown): string {
    switch (name) {
      case 'app-name':
        return this.config.appName;
      case 'version':
        return this.config.version;
      case 'build_date':
        return this.config.buildDate;
      case 'api_server':
        return this.resolveApiServer();
      case 'is_using_public_server':
        return this.isUsingPublicServer() ? 'true' : 'false';
      case 'platform':
        return 'WebDesktop';
      case 'local_os':
        return detectOs();
      case 'screen_info':
        return screenInfo();
      case 'remember':
        return this.store.get('remember', 'false');
      case 'my_id':
        return this.store.get('my_id', this.config.profile.id ?? '');
      case 'my_name':
        return this.store.get('my_name', this.config.profile.name ?? 'Web User');
      case 'uuid':
        return this.store.ensure('uuid', generateUuid);
      case 'envvar':
        if (typeof arg0 === 'string') {
          return this.config.env[arg0] ?? this.store.get(`envvar:${arg0}`, '');
        }
        return '';
      case 'option:toggle':
        return this.store.get(`option:toggle:${String(arg0 ?? '')}`, 'false');
      case 'option:session':
      case 'option:local':
      case 'option:flutter:peer':
      case 'option:flutter:local':
      case 'option:user:default':
        return this.getScopedOption(name, String(arg0 ?? ''));
      case 'option':
        return this.getOption(String(arg0 ?? ''));
      case 'common':
        return this.store.get(`common:${String(arg0 ?? '')}`, '');
      case 'options':
        return JSON.stringify(this.getOptionsSnapshot());
      case 'fav':
        return this.store.get('fav', '[]');
      case 'load_recent_peers':
      case 'load_recent_peers_sync':
        return this.store.get('recent_peers', '[]');
      case 'load_fav_peers':
        return this.store.get('fav', '[]');
      case 'load_ab':
        return this.store.get('address_book', '[]');
      case 'load_group':
        return this.store.get('groups', '[]');
      case 'langs':
        return typeof this.config.langs === 'string'
          ? this.config.langs
          : JSON.stringify(this.config.langs ?? []);
      case 'alternative_codecs':
        return this.computeAlternativeCodecs();
      case 'get_version_number':
        return String(this.getVersionNumber(String(arg0 ?? '')));
      case 'translate':
        return this.handleTranslate(arg0);
      case 'get_conn_status':
        return this.store.get('service_status', 'disconnected');
      case 'temporary_password':
        return this.ensureTemporaryPassword();
      case 'permanent_password':
        return this.store.get('permanent_password', '');
      case 'main_display':
        return this.store.get('main_display', '0');
      case 'custom_image_quality':
        return this.store.get('custom_image_quality', '0');
      case 'image_quality':
        return this.store.get('image_quality', '0');
      case 'peer_has_password':
      case 'peer_exists':
        return 'false';
      case 'enable_trusted_devices':
        return this.store.get('enable_trusted_devices', '');
      case 'conn_session_id':
        return this.store.get('conn_session_id', '');
      case 'last_audit_note':
        return this.store.get('last_audit_note', '');
      case 'audit_guid':
        return this.store.get('audit_guid', '');
      case 'audit_server':
        if (typeof arg0 === 'string') {
          return this.store.get(`audit_server:${arg0}`, '');
        }
        return '';
      case 'account_auth_result':
        return this.store.get('account_auth_result', '');
      default:
        if (arg0 !== undefined) {
          return this.store.get(`${name}:${String(arg0)}`, '');
        }
        return this.store.get(name, '');
    }
  }

  private bindEventSinks(): void {
    this.events.onEmit((event) => {
      switch (event.name) {
        case 'conn_status':
          if (event.status !== undefined) {
            const status = String(event.status);
            this.store.set('session_conn_status', status);
            if (status === 'connecting') {
              this.setServiceStatus('connecting');
            } else if (status === 'connected') {
              this.setServiceStatus('connected');
            } else if (status === 'error') {
              this.setServiceStatus('error');
            }
          }
          break;
        case 'peer_info':
          if (event.current_display !== undefined) {
            this.store.set('main_display', String(event.current_display));
          }
          break;
        case 'switch_display':
          if (event.display !== undefined) {
            this.store.set('main_display', String(event.display));
          }
          break;
        case 'enable_trusted_devices': {
          const raw = String(event.value ?? '').toLowerCase();
          const enabled = raw === 'true' || raw === '1' || raw === 'y';
          this.store.set('enable_trusted_devices', enabled ? 'Y' : '');
          break;
        }
        case 'update_block_input_state': {
          const on = String(event.input_state ?? '') === 'on';
          this.store.set('option:toggle:block-input', on.toString());
          break;
        }
        case 'sync_peer_option':
          if (typeof event.k === 'string') {
            const v = event.v === true || event.v === 'true';
            this.store.set(`option:toggle:${event.k}`, v.toString());
          }
          break;
        default:
          break;
      }
    });
    this.events.bindGlobalSink((payload) => {
      if (typeof window.onGlobalEvent === 'function') {
        window.onGlobalEvent(payload);
      }
    });
    this.events.bindRegisteredSink((payload) => {
      if (typeof window.onRegisteredEvent === 'function') {
        window.onRegisteredEvent(payload);
      }
    });
  }

  private setOptionPayload(prefix: string, arg0?: unknown, arg1?: unknown): void {
    if (arg1 !== undefined) {
      if (arg0 !== undefined) {
        this.setScopedOption(prefix, String(arg0), arg1);
      }
      return;
    }
    if (typeof arg0 !== 'string') {
      return;
    }
    try {
      const parsed = JSON.parse(arg0) as OptionPayload;
      if (!parsed || typeof parsed.name !== 'string') {
        return;
      }
      this.setScopedOption(prefix, parsed.name, parsed.value ?? '');
    } catch {
      // Ignore invalid JSON.
    }
  }

  private setScopedOption(prefix: string, key: string, value: unknown): void {
    if (prefix === 'option') {
      this.setOptionValue(key, value);
      return;
    }
    this.store.set(`${prefix}:${key}`, value ?? '');
  }

  private setOptionValue(key: string, value: unknown): void {
    const normalized = String(value ?? '');
    this.store.set(`option:${key}`, normalized);
    const options = this.store.getJson<Record<string, string>>('options', {});
    if (normalized) {
      options[key] = normalized;
    } else {
      delete options[key];
    }
    this.store.setJson('options', options);
    if (
      key === 'custom-rendezvous-server' ||
      key === 'relay-server' ||
      key === 'api-server'
    ) {
      this.scheduleConnectStatusProbe();
    } else if (
      key === 'temporary-password-length' ||
      key === 'allow-numeric-one-time-password'
    ) {
      this.ensureTemporaryPassword(true);
    }
  }

  private setOptionsPayload(arg0?: unknown): void {
    if (typeof arg0 === 'string') {
      const raw = arg0.trim();
      if (!raw) {
        this.replaceOptionsFromObject({});
        return;
      }
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        this.replaceOptionsFromObject(parsed);
        return;
      } catch {
        this.store.set('options', arg0);
        return;
      }
    }
    if (arg0 && typeof arg0 === 'object') {
      this.replaceOptionsFromObject(arg0 as Record<string, unknown>);
    }
  }

  private setCommonPayload(arg0?: unknown): void {
    if (typeof arg0 !== 'string') {
      return;
    }
    try {
      const parsed = JSON.parse(arg0) as { key?: unknown; value?: unknown };
      if (typeof parsed.key !== 'string') {
        return;
      }
      this.store.set(`common:${parsed.key}`, String(parsed.value ?? ''));
    } catch {
      // Ignore invalid payloads.
    }
  }

  private replaceOptionsFromObject(parsed: Record<string, unknown>): void {
    const current = this.store.getJson<Record<string, string>>('options', {});
    for (const key of Object.keys(current)) {
      if (!(key in parsed)) {
        this.setOptionValue(key, '');
      }
    }
    for (const [key, value] of Object.entries(parsed)) {
      this.setOptionValue(key, value ?? '');
    }
  }

  private getScopedOption(prefix: string, key: string): string {
    const scopedKey = `${prefix}:${key}`;
    const stored = this.store.get(scopedKey, '');
    if (stored) {
      return stored;
    }
    if (prefix === 'option:local') {
      return this.localOptionDefaults.get(key) ?? '';
    }
    if (prefix === 'option:flutter:local') {
      return this.flutterLocalOptionDefaults.get(key) ?? '';
    }
    if (prefix === 'option:user:default') {
      return this.userDefaultOptionDefaults.get(key) ?? '';
    }
    return '';
  }

  private getOptionsSnapshot(): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const [key, value] of this.optionDefaults.entries()) {
      if (value) {
        merged[key] = value;
      }
    }
    const stored = this.store.getJson<Record<string, string>>('options', {});
    for (const [key, value] of Object.entries(stored)) {
      if (value) {
        merged[key] = value;
      } else {
        delete merged[key];
      }
    }
    const coreKeys = ['custom-rendezvous-server', 'relay-server', 'api-server', 'key'];
    for (const key of coreKeys) {
      const value = this.getOption(key);
      if (value) {
        merged[key] = value;
      } else {
        delete merged[key];
      }
    }
    return merged;
  }

  private toggleOption(optionName: string): string {
    if (!optionName) {
      return 'false';
    }
    let normalized = optionName;
    let forced: boolean | null = null;
    if (optionName === 'unblock-input') {
      normalized = 'block-input';
      forced = false;
    } else if (optionName === 'block-input') {
      forced = true;
    }
    const key = `option:toggle:${normalized}`;
    const current = this.store.get(key, 'false') === 'true';
    const next = forced ?? !current;
    this.store.set(key, next.toString());
    this.applyToggleOption(normalized, next);
    return next.toString();
  }

  private applyToggleOption(name: string, value: boolean): void {
    if (name === 'view-only' || name === 'show-my-cursor') {
      this.events.emit({
        name: 'sync_peer_option',
        k: name,
        v: value
      });
      if (name === 'show-my-cursor' && value) {
        this.store.set('option:toggle:view-only', 'true');
      }
    }
    if (name === 'privacy-mode') {
      if (value) {
        const fallback =
          this.store.get('option:session:privacy-mode-impl-key') ||
          'privacy_mode_impl_mag';
        this.store.set('option:session:privacy-mode-impl-key', fallback);
      } else {
        this.store.set('option:session:privacy-mode-impl-key', '');
      }
    }
    if (!this.currentSession) {
      return;
    }
    const field = this.toggleOptionField(name);
    if (!field) {
      return;
    }
    this.currentSession.sendOption({ [field]: this.boolOption(value) });
  }

  private toggleOptionField(name: string): string | null {
    switch (name) {
      case 'lock-after-session-end':
        return 'lockAfterSessionEnd';
      case 'show-remote-cursor':
        return 'showRemoteCursor';
      case 'privacy-mode':
        return 'privacyMode';
      case 'block-input':
        return 'blockInput';
      case 'disable-audio':
        return 'disableAudio';
      case 'disable-clipboard':
        return 'disableClipboard';
      case 'enable-file-transfer':
        return 'enableFileTransfer';
      case 'disable-keyboard':
        return 'disableKeyboard';
      case 'disable-camera':
        return 'disableCamera';
      case 'follow-remote-cursor':
        return 'followRemoteCursor';
      case 'follow-remote-window':
        return 'followRemoteWindow';
      case 'terminal-persistent':
        return 'terminalPersistent';
      case 'show-my-cursor':
        return 'showMyCursor';
      default:
        return null;
    }
  }

  private boolOption(value: boolean): number {
    return value ? 2 : 1;
  }

  private handleSendFiles(arg0?: unknown): void {
    if (!this.currentSession || typeof arg0 !== 'string') {
      return;
    }
    const payload = this.safeJson(arg0) as {
      id?: number;
      path?: string;
      include_hidden?: boolean;
      is_remote?: boolean;
      file_num?: number;
    };
    if (!payload.is_remote) {
      this.emitJobError(payload.id, 'one-way-file-transfer-tip');
      return;
    }
    this.currentSession.requestDownload(
      Number(payload.id ?? 0),
      String(payload.path ?? ''),
      Boolean(payload.include_hidden),
      Number(payload.file_num ?? 0)
    );
  }

  private handleSendLocalFiles(arg0?: unknown): void {
    if (!this.currentSession || typeof arg0 !== 'string') {
      return;
    }
    const payload = this.safeJson(arg0) as {
      id?: number;
      handle_index?: number;
      path?: string;
      to?: string;
    };
    const handleIndex = Number(payload.handle_index ?? 0);
    const files = this.fileHandles.get(handleIndex);
    if (!files || files.length === 0) {
      this.emitJobError(payload.id, 'file-not-found');
      return;
    }
    const desired = String(payload.path ?? '');
    const file =
      files.find((item) => {
        const relative = (item as File & { webkitRelativePath?: string })
          .webkitRelativePath;
        if (relative && relative.length > 0) {
          return relative === desired;
        }
        return item.name === desired;
      }) ?? files[0];
    if (!file) {
      this.emitJobError(payload.id, 'file-not-found');
      return;
    }
    const idx = files.indexOf(file);
    if (idx >= 0) {
      files.splice(idx, 1);
      if (files.length === 0) {
        this.fileHandles.delete(handleIndex);
      }
    }
    const remotePath =
      payload.to !== undefined && payload.to !== null && payload.to !== ''
        ? String(payload.to)
        : desired || file.name;
    this.currentSession.startUpload(Number(payload.id ?? 0), file, remotePath);
  }

  private handleSelectFiles(isFolder: boolean): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (isFolder) {
      (input as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true;
      input.setAttribute('webkitdirectory', '');
    }
    input.addEventListener(
      'change',
      () => {
        const files = input.files ? Array.from(input.files) : [];
        if (files.length === 0) {
          return;
        }
        const handleIndex = this.nextFileHandle++;
        this.fileHandles.set(handleIndex, files);
        for (const file of files) {
          const relative = (file as File & { webkitRelativePath?: string })
            .webkitRelativePath;
          const name = relative && relative.length > 0 ? relative : file.name;
          const entry = {
            entry_type: 4,
            name,
            size: file.size ?? 0,
            modified_time: Math.floor((file.lastModified || Date.now()) / 1000)
          };
          this.events.emit({
            name: 'selected_files',
            handleIndex: String(handleIndex),
            file: JSON.stringify(entry)
          });
        }
      },
      { once: true }
    );
    input.click();
  }

  private handleQueryOnlines(arg0?: unknown): void {
    const ids = this.parseIdList(arg0);
    if (ids.length === 0) {
      this.emitQueryOnlines([], []);
      return;
    }
    void this.queryOnlineStates(ids);
  }

  private parseIdList(arg0?: unknown): string[] {
    if (typeof arg0 === 'string') {
      try {
        const parsed = JSON.parse(arg0) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.map((id) => String(id));
        }
      } catch {
        return [];
      }
    }
    if (Array.isArray(arg0)) {
      return arg0.map((id) => String(id));
    }
    return [];
  }

  private emitQueryOnlines(onlines: string[], offlines: string[]): void {
    this.events.emit({
      name: 'callback_query_onlines',
      onlines: onlines.join(','),
      offlines: offlines.join(',')
    });
  }

  private async queryOnlineStates(ids: string[]): Promise<void> {
    const context = this.buildSessionContext();
    const rendezvousServer =
      this.resolveRendezvousServer() || context.rendezvousServer;
    if (!rendezvousServer) {
      this.emitQueryOnlines([], ids);
      return;
    }
    const onlineServer = this.deriveOnlineServer(rendezvousServer);
    const endpoint = checkWsEndpoint(
      onlineServer,
      context.relayServer,
      context.apiServer,
      'auto',
      rendezvousServer
    );
    if (!endpoint) {
      this.emitQueryOnlines([], ids);
      return;
    }

    let transport: WebSocketTransport | undefined;
    let inbox: MessageInbox | undefined;
    try {
      const proto = await this.ensureProto();
      transport = new WebSocketTransport('online');
      inbox = new MessageInbox(transport);
      await transport.connect(endpoint);

      const request = {
        onlineRequest: {
          id: context.myId,
          peers: ids
        }
      };
      transport.send(proto.rendezvousType.encode(request).finish());

      for (let attempt = 0; attempt < 2; attempt++) {
        let data: Uint8Array;
        try {
          data = await inbox.next(3000);
        } catch {
          continue;
        }
        const msg = proto.rendezvousType
          .decode(data)
          .toObject({
            longs: String,
            bytes: Uint8Array,
            defaults: false
          }) as Record<string, unknown>;
        if (msg.keyExchange) {
          continue;
        }
        const onlineResponse = msg.onlineResponse as
          | { states?: Uint8Array }
          | undefined;
        if (!onlineResponse) {
          continue;
        }
        const [onlines, offlines] = this.decodeOnlineStates(
          onlineResponse.states,
          ids
        );
        this.emitQueryOnlines(onlines, offlines);
        return;
      }
    } catch (err) {
      this.logger.warn('query_onlines failed', err);
    } finally {
      inbox?.close();
      transport?.close();
    }

    this.emitQueryOnlines([], ids);
  }

  private decodeOnlineStates(
    states: Uint8Array | undefined,
    ids: string[]
  ): [string[], string[]] {
    if (!states || states.length === 0) {
      return [[], ids.slice()];
    }
    const onlines: string[] = [];
    const offlines: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const byteIndex = Math.floor(i / 8);
      const bitValue = 0x01 << (7 - (i % 8));
      if ((states[byteIndex] & bitValue) === bitValue) {
        onlines.push(ids[i]);
      } else {
        offlines.push(ids[i]);
      }
    }
    return [onlines, offlines];
  }

  private deriveOnlineServer(endpoint: string): string {
    if (!endpoint || endpoint.startsWith('ws://') || endpoint.startsWith('wss://')) {
      return endpoint;
    }
    const normalized = endpoint.includes('://')
      ? this.stripSchemeAndPath(endpoint)
      : endpoint;
    const parsed = this.splitHostPort(normalized);
    if (!parsed) {
      if (!normalized) {
        return normalized;
      }
      if (normalized.startsWith('[') && normalized.endsWith(']')) {
        return `${normalized}:21115`;
      }
      if (normalized.includes(':')) {
        return `[${normalized}]:21115`;
      }
      return `${normalized}:21115`;
    }
    const port = parsed.port > 0 ? parsed.port - 1 : parsed.port;
    return parsed.isIpv6
      ? `[${parsed.host}]:${port}`
      : `${parsed.host}:${port}`;
  }

  private startAccountAuth(arg0?: unknown): void {
    const payload =
      typeof arg0 === 'string'
        ? (this.safeJson(arg0) as AccountAuthPayload)
        : (arg0 as AccountAuthPayload | undefined) ?? {};
    const op = String(payload.op ?? '').trim();
    const remember = Boolean(payload.remember);
    if (!op) {
      this.updateAccountAuthResult({
        state_msg: 'Requesting account auth',
        failed_msg: 'Invalid auth op',
        url: '',
        url_launched: false
      });
      return;
    }

    const apiServer = this.resolveApiServer();
    if (!apiServer) {
      this.updateAccountAuthResult({
        state_msg: 'Requesting account auth',
        failed_msg: 'API server not configured',
        url: '',
        url_launched: false
      });
      return;
    }

    this.cancelAccountAuth(false);
    const nonce = ++this.accountAuthNonce;
    const controller = new AbortController();
    this.accountAuthAbort = controller;

    this.updateAccountAuthResult({
      state_msg: 'Requesting account auth',
      failed_msg: '',
      url: '',
      url_launched: false
    });

    const id = this.store.get('my_id', this.config.profile.id ?? '');
    const uuid = this.store.ensure('uuid', generateUuid);
    const deviceInfo = this.buildDeviceInfo();

    void this.performAccountAuth({
      nonce,
      apiServer,
      op,
      remember,
      id,
      uuid,
      deviceInfo,
      signal: controller.signal
    });
  }

  private cancelAccountAuth(clearResult = true): void {
    this.accountAuthNonce++;
    if (this.accountAuthAbort) {
      this.accountAuthAbort.abort();
      this.accountAuthAbort = undefined;
    }
    if (clearResult) {
      this.store.set('account_auth_result', '');
    }
  }

  private async performAccountAuth(args: {
    nonce: number;
    apiServer: string;
    op: string;
    remember: boolean;
    id: string;
    uuid: string;
    deviceInfo: { os: string; type: string; name: string };
    signal: AbortSignal;
  }): Promise<void> {
    const { nonce, apiServer, op, remember, id, uuid, deviceInfo, signal } = args;
    let authUrl = '';
    try {
      const authResponse = (await this.fetchJson(
        `${apiServer}/api/oidc/auth`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            op,
            id,
            uuid,
            deviceInfo
          }),
          signal
        }
      )) as OidcAuthUrlResponse;

      if (!this.isAccountAuthActive(nonce)) {
        return;
      }
      if (authResponse.error) {
        this.updateAccountAuthResult({
          state_msg: 'Requesting account auth',
          failed_msg: authResponse.error,
          url: '',
          url_launched: false
        });
        return;
      }
      if (!authResponse.code || !authResponse.url) {
        this.updateAccountAuthResult({
          state_msg: 'Requesting account auth',
          failed_msg: 'Invalid auth response',
          url: '',
          url_launched: false
        });
        return;
      }

      authUrl = authResponse.url;
      this.updateAccountAuthResult({
        state_msg: 'Waiting account auth',
        failed_msg: '',
        url: authUrl,
        url_launched: false
      });

      const queryUrl = new URL(`${apiServer}/api/oidc/auth-query`);
      queryUrl.searchParams.set('code', authResponse.code);
      queryUrl.searchParams.set('id', id);
      queryUrl.searchParams.set('uuid', uuid);

      const start = Date.now();
      const timeoutMs = 3 * 60 * 1000;
      while (this.isAccountAuthActive(nonce) && Date.now() - start < timeoutMs) {
        let queryResponse: OidcAuthQueryResponse | null = null;
        try {
          queryResponse = (await this.fetchJson(queryUrl.toString(), {
            method: 'GET',
            signal
          })) as OidcAuthQueryResponse;
        } catch (err) {
          if (signal.aborted || !this.isAccountAuthActive(nonce)) {
            return;
          }
          await this.sleep(1000);
          continue;
        }

        if (!this.isAccountAuthActive(nonce)) {
          return;
        }

        if (queryResponse?.error) {
          const errText = String(queryResponse.error);
          if (!errText.includes('No authed oidc is found')) {
            this.updateAccountAuthResult({
              state_msg: 'Waiting account auth',
              failed_msg: errText,
              url: authUrl,
              url_launched: false
            });
            return;
          }
        } else if (queryResponse?.type) {
          if (remember && queryResponse.type === 'access_token') {
            this.storeAuthToken(queryResponse);
          }
          this.updateAccountAuthResult({
            state_msg: 'Login account auth',
            failed_msg: '',
            url: authUrl,
            url_launched: false,
            auth_body: queryResponse
          });
          return;
        }

        await this.sleep(1000);
      }

      if (this.isAccountAuthActive(nonce)) {
        this.updateAccountAuthResult({
          state_msg: 'Waiting account auth',
          failed_msg: 'timeout',
          url: authUrl,
          url_launched: false
        });
      }
    } catch (err) {
      if (!this.isAccountAuthActive(nonce)) {
        return;
      }
      const message =
        err instanceof Error ? err.message : 'Failed to request auth';
      this.updateAccountAuthResult({
        state_msg: 'Requesting account auth',
        failed_msg: message,
        url: authUrl,
        url_launched: false
      });
    }
  }

  private updateAccountAuthResult(result: AccountAuthResult): void {
    this.store.set('account_auth_result', JSON.stringify(result));
  }

  private isAccountAuthActive(nonce: number): boolean {
    return nonce === this.accountAuthNonce;
  }

  private storeAuthToken(auth: OidcAuthQueryResponse): void {
    if (!auth.access_token) {
      return;
    }
    const token = String(auth.access_token);
    this.store.set('option:local:access_token', token);
    this.store.set('option:access_token', token);
    if (auth.user) {
      this.store.set('option:local:user_info', JSON.stringify(auth.user));
    }
  }

  private applyBootstrapConfig(arg0?: unknown): void {
    let payload: BootstrapConfigPayload | null = null;
    if (typeof arg0 === 'string') {
      payload = this.safeJson(arg0) as BootstrapConfigPayload;
    } else if (arg0 && typeof arg0 === 'object') {
      payload = arg0 as BootstrapConfigPayload;
    }
    if (!payload) {
      return;
    }
    if (typeof payload.appName === 'string' && payload.appName.trim()) {
      this.config.appName = payload.appName.trim();
    }
    if (typeof payload.apiServer === 'string' && payload.apiServer.trim()) {
      this.config.apiServer = this.normalizeApiServer(payload.apiServer.trim());
    }
    const rendezvousServers = this.parseServerList(payload.rendezvousServers);
    if (rendezvousServers.length > 0) {
      this.config.rendezvousServers = rendezvousServers;
    }
    const relayServers = this.parseServerList(payload.relayServers);
    if (relayServers.length > 0) {
      this.config.relayServers = relayServers;
    }
    if (typeof payload.rsPubKey === 'string') {
      this.setEnvValue('RS_PUB_KEY', payload.rsPubKey);
    }
    if (payload.env && typeof payload.env === 'object') {
      for (const [key, value] of Object.entries(payload.env)) {
        this.setEnvValue(key, value ?? '');
      }
    }
    if (typeof payload.isPublicServer === 'boolean') {
      this.config.isPublicServer = payload.isPublicServer;
    }
    this.refreshDefaultOptions();
    this.startConnectStatusProbe();
  }

  private refreshDefaultOptions(): void {
    const rendezvousServers = this.getConfiguredRendezvousServers();
    const relayServers = this.getConfiguredRelayServers(rendezvousServers);
    const primaryRendezvous = rendezvousServers[0] ?? '';
    const primaryRelay = relayServers[0] ?? this.deriveRelayServer(primaryRendezvous);
    const apiServer = this.resolveApiServerFromConfig(primaryRendezvous);
    const key = this.getEnv('RS_PUB_KEY', 'rs_pub_key');

    this.config.rendezvousServers = rendezvousServers;
    this.config.relayServers = relayServers;
    this.config.apiServer = apiServer;

    this.optionDefaults.clear();
    this.optionDefaults.set('custom-rendezvous-server', primaryRendezvous);
    this.optionDefaults.set('relay-server', primaryRelay);
    this.optionDefaults.set('api-server', apiServer);
    this.optionDefaults.set('key', key);
    this.optionDefaults.set('verification-method', 'use-both-passwords');
    this.optionDefaults.set('approve-mode', 'password');
    this.optionDefaults.set('temporary-password-length', '6');
    this.optionDefaults.set('allow-numeric-one-time-password', 'N');
    this.optionDefaults.set('enable-direct-server', 'N');
    this.optionDefaults.set('direct-access-port', '21118');
    this.optionDefaults.set('allow-websocket', 'Y');
    this.optionDefaults.set('enable-trusted-devices', 'Y');
    this.optionDefaults.set('disable-udp', 'Y');

    this.localOptionDefaults.clear();
    this.localOptionDefaults.set('disable-group-panel', 'N');
    this.localOptionDefaults.set('disable-discovery-panel', 'Y');
    this.localOptionDefaults.set('input-source', 'Input source 1');

    this.flutterLocalOptionDefaults.clear();
    this.flutterLocalOptionDefaults.set('peer-tab-index', '0');
    this.flutterLocalOptionDefaults.set('peer-tab-order', '[0,1,2,3,4]');
    this.flutterLocalOptionDefaults.set(
      'peer-tab-visible',
      '[true,true,false,true,true]'
    );

    this.userDefaultOptionDefaults.clear();
    this.userDefaultOptionDefaults.set('view_style', 'original');
    this.userDefaultOptionDefaults.set('scroll_style', 'scrollauto');
    this.userDefaultOptionDefaults.set('image_quality', 'balanced');
    this.userDefaultOptionDefaults.set('codec-preference', 'auto');
    this.userDefaultOptionDefaults.set('custom_image_quality', '100');
    this.userDefaultOptionDefaults.set('custom-fps', '60');
    this.userDefaultOptionDefaults.set('show_remote_cursor', 'Y');
    this.userDefaultOptionDefaults.set('enable-file-copy-paste', 'Y');
    this.userDefaultOptionDefaults.set('edge-scroll-edge-thickness', '100');
    this.userDefaultOptionDefaults.set('trackpad-speed', '100');

    this.ensureTemporaryPassword();
  }

  private getConfiguredRendezvousServers(): string[] {
    const fromConfig = this.normalizeServerList(this.config.rendezvousServers);
    if (fromConfig.length > 0) {
      return fromConfig;
    }
    return this.parseServerList(this.getEnv('RENDEZVOUS_SERVERS', 'rendezvous_servers'));
  }

  private getConfiguredRelayServers(rendezvousServers: string[]): string[] {
    const fromConfig = this.normalizeServerList(this.config.relayServers);
    if (fromConfig.length > 0) {
      return fromConfig;
    }
    const derived = rendezvousServers
      .map((server) => this.deriveRelayServer(server))
      .filter((server) => server.length > 0);
    if (derived.length > 0) {
      return derived;
    }
    const single = this.deriveRelayServer(rendezvousServers[0] ?? '');
    return single ? [single] : [];
  }

  private parseServerList(input?: string[] | string): string[] {
    if (Array.isArray(input)) {
      return this.normalizeServerList(input);
    }
    if (typeof input !== 'string') {
      return [];
    }
    return this.normalizeServerList(input.split(','));
  }

  private normalizeServerList(list: string[]): string[] {
    const out: string[] = [];
    for (const item of list) {
      const normalized = String(item ?? '').trim();
      if (normalized && !out.includes(normalized)) {
        out.push(normalized);
      }
    }
    return out;
  }

  private getEnv(...keys: string[]): string {
    for (const key of keys) {
      const values = [
        this.config.env[key],
        this.config.env[key.toUpperCase()],
        this.config.env[key.toLowerCase()]
      ];
      for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
          return value.trim();
        }
      }
    }
    return '';
  }

  private setEnvValue(key: string, value: unknown): void {
    const normalized = String(value ?? '').trim();
    this.config.env[key] = normalized;
    this.store.set(`envvar:${key}`, normalized);
    const lower = key.toLowerCase();
    if (
      lower === 'rs_pub_key' ||
      lower === 'rendezvous_servers' ||
      lower === 'api_server'
    ) {
      this.refreshDefaultOptions();
      this.startConnectStatusProbe();
    }
  }

  private resolveApiServerFromConfig(rendezvousServer = ''): string {
    const direct = this.normalizeApiServer(
      this.config.apiServer || this.getEnv('API_SERVER', 'api_server')
    );
    if (direct) {
      return direct;
    }
    const source = rendezvousServer || this.config.rendezvousServers[0] || '';
    if (!source) {
      return '';
    }
    const stripped = this.stripSchemeAndPath(source);
    const adjusted = this.increasePort(stripped, -2);
    if (adjusted === stripped) {
      return this.normalizeApiServer(this.appendPort(stripped, 21114));
    }
    return this.normalizeApiServer(adjusted);
  }

  private resolveApiServer(): string {
    const direct = this.getOption('api-server');
    if (direct) {
      return this.normalizeApiServer(direct);
    }
    const custom = this.getOption('custom-rendezvous-server');
    if (custom) {
      const stripped = this.stripSchemeAndPath(custom);
      const adjusted = this.increasePort(stripped, -2);
      if (adjusted === stripped) {
        return this.normalizeApiServer(this.appendPort(stripped, 21114));
      }
      return this.normalizeApiServer(adjusted);
    }
    return this.resolveApiServerFromConfig();
  }

  private resolveRendezvousServer(): string {
    const custom = this.getOption('custom-rendezvous-server');
    if (custom) {
      return custom;
    }
    const apiServer = this.resolveApiServer();
    if (!apiServer) {
      return '';
    }
    const stripped = this.stripSchemeAndPath(apiServer);
    const adjusted = this.increasePort(stripped, 2);
    if (adjusted === stripped) {
      return this.appendPort(stripped, 21116);
    }
    return adjusted;
  }

  private resolveRelayServer(rendezvousServer: string): string {
    const relay = this.getOption('relay-server');
    if (relay) {
      return relay;
    }
    return this.deriveRelayServer(rendezvousServer);
  }

  private deriveRelayServer(rendezvousServer: string): string {
    if (!rendezvousServer) {
      return '';
    }
    const stripped = this.stripSchemeAndPath(rendezvousServer);
    const adjusted = this.increasePort(stripped, 1);
    if (adjusted === stripped) {
      return this.appendPort(stripped, 21117);
    }
    return adjusted;
  }

  private isUsingPublicServer(): boolean {
    const apiServer = this.resolveApiServer();
    if (!apiServer) {
      return this.config.isPublicServer;
    }
    try {
      const host = new URL(this.normalizeApiServer(apiServer)).hostname.toLowerCase();
      return host === 'camellia.aimmv.com' || host.endsWith('.camellia.aimmv.com');
    } catch {
      const value = apiServer.toLowerCase();
      return value.includes('camellia.aimmv.com');
    }
  }

  private normalizeApiServer(endpoint: string): string {
    let value = endpoint.trim();
    value = value.replace(/\/+$/, '');
    if (!value) {
      return '';
    }
    if (value.includes('://')) {
      return value;
    }
    const protocol = window.location.protocol === 'https:' ? 'https://' : 'http://';
    return `${protocol}${value}`;
  }

  private stripSchemeAndPath(endpoint: string): string {
    const value = endpoint.trim();
    if (!value) {
      return '';
    }
    if (value.includes('://')) {
      try {
        const url = new URL(value);
        return url.host;
      } catch {
        // fall through
      }
    }
    return value.split('/')[0];
  }

  private increasePort(endpoint: string, offset: number): string {
    const parsed = this.splitHostPort(endpoint);
    if (!parsed) {
      return endpoint;
    }
    const next = parsed.port + offset;
    if (!Number.isFinite(next) || next <= 0) {
      return endpoint;
    }
    return parsed.isIpv6 ? `[${parsed.host}]:${next}` : `${parsed.host}:${next}`;
  }

  private appendPort(host: string, port: number): string {
    if (!host) {
      return '';
    }
    if (host.startsWith('[')) {
      return `${host}:${port}`;
    }
    if (host.includes(':')) {
      return `[${host}]:${port}`;
    }
    return `${host}:${port}`;
  }

  private splitHostPort(
    endpoint: string
  ): { host: string; port: number; isIpv6: boolean } | null {
    if (!endpoint) {
      return null;
    }
    if (endpoint.startsWith('[')) {
      const end = endpoint.indexOf(']');
      if (end === -1) {
        return null;
      }
      const host = endpoint.slice(1, end);
      const rest = endpoint.slice(end + 1);
      if (!rest.startsWith(':')) {
        return null;
      }
      const port = Number(rest.slice(1));
      if (!Number.isFinite(port)) {
        return null;
      }
      return { host, port, isIpv6: true };
    }
    const lastColon = endpoint.lastIndexOf(':');
    if (lastColon === -1) {
      return null;
    }
    const host = endpoint.slice(0, lastColon);
    const port = Number(endpoint.slice(lastColon + 1));
    if (!Number.isFinite(port)) {
      return null;
    }
    return { host, port, isIpv6: false };
  }

  private buildDeviceInfo(): { os: string; type: string; name: string } {
    const os = detectOs() || 'Web';
    const name = navigator.userAgent || navigator.platform || 'Web';
    return {
      os,
      type: 'browser',
      name
    };
  }

  private async fetchJson(
    url: string,
    init: RequestInit
  ): Promise<Record<string, unknown>> {
    const response = await fetch(url, init);
    const text = await response.text();
    if (!text) {
      if (!response.ok) {
        return { error: `HTTP ${response.status}` };
      }
      return {};
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      if (!response.ok) {
        return { error: `HTTP ${response.status}` };
      }
      throw new Error('Invalid JSON response');
    }
    if (!response.ok && !('error' in parsed)) {
      parsed.error = `HTTP ${response.status}`;
    }
    return parsed;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  private async ensureProto(): Promise<ProtoRoots> {
    if (!this.protoPromise) {
      this.protoPromise = loadProtos();
    }
    return this.protoPromise;
  }

  private emitJobError(id: number | undefined, err: string): void {
    this.events.emit({
      name: 'job_error',
      id: String(id ?? 0),
      err
    });
  }

  private computeAlternativeCodecs(): string {
    const peer = this.currentSession?.getPeerEncoding() ?? {};
    const decoding = this.currentSession?.getDecoding();
    const result = {
      vp8: false,
      av1: Boolean(peer.av1 && decoding?.av1),
      h264: Boolean(peer.h264 && decoding?.h264),
      h265: Boolean(peer.h265 && decoding?.h265)
    };
    return JSON.stringify(result);
  }

  private getVersionNumber(v: string): number {
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

  private handleTranslate(arg0?: unknown): string {
    if (typeof arg0 !== 'string') {
      return '';
    }
    try {
      const parsed = JSON.parse(arg0) as { text?: string };
      const text = (parsed.text ?? '').trim();
      if (!text) {
        return '';
      }
      const fallback: Record<string, string> = {
        empty_recent_tip: 'No recent sessions yet.',
        empty_favorite_tip: 'No favorite devices yet.',
        empty_lan_tip: 'No LAN devices discovered yet.',
        empty_address_book_tip: 'Address book is empty.'
      };
      return fallback[text] ?? text;
    } catch {
      return '';
    }
  }

  private handleSessionAdd(arg0?: unknown): string {
    if (typeof arg0 !== 'string') {
      return 'invalid_payload';
    }
    try {
      const parsed = JSON.parse(arg0) as {
        id: string;
        password?: string;
        isFileTransfer?: boolean;
        isViewCamera?: boolean;
        isTerminal?: boolean;
        forceRelay?: boolean;
      };
      const mode: SessionMode = parsed.isFileTransfer
        ? 'file-transfer'
        : parsed.isViewCamera
        ? 'view-camera'
        : parsed.isTerminal
        ? 'terminal'
        : 'remote';
      const request: ConnectRequest = {
        id: parsed.id,
        password: parsed.password,
        mode,
        forceRelay: Boolean(parsed.forceRelay)
      };
      this.currentSession = new WebSession(request, this.events);
      this.store.set('conn_session_id', generateUuid());
      return '';
    } catch (err) {
      this.logger.error('session_add_sync failed', err);
      return 'invalid_payload';
    }
  }

  private async handleSessionStart(arg0?: unknown): Promise<void> {
    if (!this.currentSession) {
      return;
    }
    if (typeof arg0 !== 'string') {
      return;
    }
    const context = this.buildSessionContext();
    this.store.set('session_conn_status', 'connecting');
    this.setServiceStatus('connecting');
    try {
      await this.currentSession.connect(context);
      this.store.set('session_conn_status', 'connected');
      this.setServiceStatus('connected');
    } catch (err) {
      this.store.set('session_conn_status', 'error');
      this.setServiceStatus('error');
      this.logger.error('Session connect failed', err);
      const reason =
        err instanceof Error && err.message
          ? err.message
          : 'Connection failed';
      this.events.emit({
        name: 'toast',
        text: reason
      });
    }
  }

  private reconnect(): void {
    if (!this.currentSession) {
      return;
    }
    this.logger.info('Reconnect requested');
  }

  private scheduleConnectStatusProbe(delayMs = 400): void {
    if (this.connectStatusDebounceTimer !== undefined) {
      window.clearTimeout(this.connectStatusDebounceTimer);
    }
    this.connectStatusDebounceTimer = window.setTimeout(() => {
      this.connectStatusDebounceTimer = undefined;
      this.startConnectStatusProbe();
    }, delayMs);
  }

  private startConnectStatusProbe(): void {
    if (this.connectStatusDebounceTimer !== undefined) {
      window.clearTimeout(this.connectStatusDebounceTimer);
      this.connectStatusDebounceTimer = undefined;
    }
    if (this.connectStatusTimer !== undefined) {
      window.clearInterval(this.connectStatusTimer);
    }
    void this.refreshConnectStatus();
    this.connectStatusTimer = window.setInterval(() => {
      void this.refreshConnectStatus();
    }, 15000);
  }

  private async refreshConnectStatus(): Promise<void> {
    const context = this.buildSessionContext();
    const rendezvousServer =
      this.resolveRendezvousServer() || context.rendezvousServer;
    if (!rendezvousServer) {
      this.setServiceStatus('disconnected');
      return;
    }
    const endpoint = checkWsEndpoint(
      rendezvousServer,
      this.resolveRelayServer(rendezvousServer),
      context.apiServer,
      'rendezvous',
      rendezvousServer
    );
    if (!endpoint) {
      this.setServiceStatus('disconnected');
      return;
    }
    this.setServiceStatus('connecting');
    const reachable = await this.probeWsEndpoint(endpoint, 5000);
    this.setServiceStatus(reachable ? 'connected' : 'error');
  }

  private async probeWsEndpoint(
    endpoint: string,
    timeoutMs: number
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      let socket: WebSocket;
      try {
        socket = new WebSocket(endpoint);
      } catch {
        resolve(false);
        return;
      }
      const closeAndResolve = (ok: boolean) => {
        if (done) {
          return;
        }
        done = true;
        window.clearTimeout(timer);
        socket.onopen = null;
        socket.onerror = null;
        socket.onclose = null;
        try {
          socket.close();
        } catch {
          // noop
        }
        resolve(ok);
      };
      const timer = window.setTimeout(() => closeAndResolve(false), timeoutMs);
      socket.onopen = () => closeAndResolve(true);
      socket.onerror = () => closeAndResolve(false);
      socket.onclose = () => closeAndResolve(false);
    });
  }

  private setServiceStatus(status: string): void {
    this.store.set('service_status', status);
  }

  private ensureMyId(): string {
    const configured = (this.config.profile.id || '').trim();
    if (configured) {
      return configured;
    }
    return this.generateNumericId();
  }

  private ensureTemporaryPassword(force = false): string {
    const length = this.resolveTemporaryPasswordLength();
    const numericOnly = this.isNumericTemporaryPasswordEnabled();
    const current = this.store.get('temporary_password', '');
    if (!force && this.matchesTemporaryPasswordRule(current, length, numericOnly)) {
      return current;
    }
    const next = this.generateTemporaryPassword(length, numericOnly);
    this.store.set('temporary_password', next);
    return next;
  }

  private matchesTemporaryPasswordRule(
    value: string,
    length: number,
    numericOnly: boolean
  ): boolean {
    if (!value || value.length !== length) {
      return false;
    }
    if (numericOnly) {
      return /^\d+$/.test(value);
    }
    return true;
  }

  private resolveTemporaryPasswordLength(): number {
    const raw = Number.parseInt(this.getOption('temporary-password-length') || '6', 10);
    if (raw === 6 || raw === 8 || raw === 10) {
      return raw;
    }
    return 6;
  }

  private isNumericTemporaryPasswordEnabled(): boolean {
    const value = this.getOption('allow-numeric-one-time-password');
    const normalized = value.trim().toLowerCase();
    return normalized === 'y' || normalized === 'yes' || normalized === '1' || normalized === 'true';
  }

  private generateTemporaryPassword(length: number, numericOnly: boolean): string {
    const alphabet = numericOnly
      ? '0123456789'
      : '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    return this.randomFromAlphabet(alphabet, length);
  }

  private generateNumericId(): string {
    const head = this.randomFromAlphabet('123456789', 1);
    const tail = this.randomFromAlphabet('0123456789', 8);
    return `${head}${tail}`;
  }

  private randomFromAlphabet(alphabet: string, length: number): string {
    if (length <= 0 || alphabet.length === 0) {
      return '';
    }
    const bytes = new Uint8Array(length);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    let output = '';
    for (let i = 0; i < length; i++) {
      output += alphabet[bytes[i] % alphabet.length];
    }
    return output;
  }

  private buildSessionContext(): SessionContext {
    const rendezvousServer = this.resolveRendezvousServer();
    const relayServer = this.resolveRelayServer(rendezvousServer);
    const apiServer = this.resolveApiServer();
    const key = this.getOption('key') || this.getEnv('RS_PUB_KEY', 'rs_pub_key');
    const token = this.getOption('access_token') || '';
    const allowDirectIpAccess = this.isOptionEnabled('enable-direct-server');
    const directAccessPort = this.resolveDirectAccessPort();
    return {
      rendezvousServer,
      relayServer,
      apiServer,
      key,
      token,
      allowDirectIpAccess,
      directAccessPort,
      myId: this.store.get('my_id', this.config.profile.id ?? ''),
      myName: this.store.get('my_name', this.config.profile.name ?? 'Web User'),
      version: this.config.version ?? '',
      platform: 'Web'
    };
  }

  private isOptionEnabled(key: string): boolean {
    const value = this.getOption(key).trim().toLowerCase();
    return value === 'y' || value === 'yes' || value === '1' || value === 'true';
  }

  private resolveDirectAccessPort(): number {
    const raw = Number.parseInt(this.getOption('direct-access-port') || '', 10);
    if (Number.isInteger(raw) && raw > 0 && raw <= 65535) {
      return raw;
    }
    return 21118;
  }

  private getOption(key: string): string {
    const stored = this.store.get(`option:${key}`, '');
    if (stored) {
      return stored;
    }
    return this.optionDefaults.get(key) ?? '';
  }

  private isDebug(): boolean {
    return this.config.env['debug'] === 'true';
  }

  private safeJson(payload: string): Record<string, unknown> {
    try {
      return JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}
