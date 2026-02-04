import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';

import 'package:flutter/foundation.dart';
import 'package:flutter_hbb/common.dart';
import 'package:flutter_hbb/common/widgets/login.dart';
import 'package:flutter_hbb/models/state_model.dart';
import 'package:flutter_hbb/web/bridge.dart';
import 'package:flutter_hbb/web/js_interop_bridge.dart' as js;
import 'package:uuid/uuid.dart';
import 'package:web/web.dart' as web;

typedef _DomListener = ({String type, web.EventListener callback});

final List<_DomListener> mouseListeners = [];
final List<_DomListener> keyListeners = [];
const String _buildApiServer =
    String.fromEnvironment('API_SERVER', defaultValue: '');
const String _buildRendezvousServers =
    String.fromEnvironment('RENDEZVOUS_SERVERS', defaultValue: '');
const String _buildRsPubKey =
    String.fromEnvironment('RS_PUB_KEY', defaultValue: '');

typedef HandleEvent = Future<void> Function(Map<String, dynamic> evt);

class PlatformFFI {
  final _eventHandlers = <String, Map<String, HandleEvent>>{};
  final RustdeskImpl _ffiBind = RustdeskImpl();

  static String getByName(String name, [String arg = '']) {
    return js.context.callMethod('getByName', [name, arg]) as String;
  }

  static void setByName(String name, [String value = '']) {
    js.context.callMethod('setByName', [name, value]);
  }

  PlatformFFI._() {
    final visibilityListener = ((web.Event _) {
      stateGlobal.isWebVisible = !web.document.hidden;
    }).toJS;
    web.document.addEventListener('visibilitychange', visibilityListener);
  }

  static final PlatformFFI instance = PlatformFFI._();

  static String get localeName => web.window.navigator.language;
  RustdeskImpl get ffiBind => _ffiBind;

  static Future<String> getVersion() async {
    throw UnimplementedError();
  }

  bool registerEventHandler(
      String eventName, String handlerName, HandleEvent handler,
      {bool replace = false}) {
    debugPrint('registerEventHandler $eventName $handlerName');
    var handlers = _eventHandlers[eventName];
    if (handlers == null) {
      _eventHandlers[eventName] = {handlerName: handler};
      return true;
    } else {
      if (!replace && handlers.containsKey(handlerName)) {
        return false;
      } else {
        handlers[handlerName] = handler;
        return true;
      }
    }
  }

  void unregisterEventHandler(String eventName, String handlerName) {
    debugPrint('unregisterEventHandler $eventName $handlerName');
    var handlers = _eventHandlers[eventName];
    if (handlers != null) {
      handlers.remove(handlerName);
    }
  }

  Future<bool> tryHandle(Map<String, dynamic> evt) async {
    final name = evt['name'];
    if (name != null) {
      final handlers = _eventHandlers[name];
      if (handlers != null) {
        if (handlers.isNotEmpty) {
          for (var handler in handlers.values) {
            await handler(evt);
          }
          return true;
        }
      }
    }
    return false;
  }

  String translate(String name, String locale) =>
      _ffiBind.translate(name: name, locale: locale);

  Uint8List? getRgba(SessionID sessionId, int display, int bufSize) {
    throw UnimplementedError();
  }

  int getRgbaSize(SessionID sessionId, int display) =>
      _ffiBind.sessionGetRgbaSize(sessionId: sessionId, display: display);
  void nextRgba(SessionID sessionId, int display) =>
      _ffiBind.sessionNextRgba(sessionId: sessionId, display: display);
  void registerPixelbufferTexture(SessionID sessionId, int display, int ptr) =>
      _ffiBind.sessionRegisterPixelbufferTexture(
          sessionId: sessionId, display: display, ptr: ptr);
  void registerGpuTexture(SessionID sessionId, int display, int ptr) =>
      _ffiBind.sessionRegisterGpuTexture(
          sessionId: sessionId, display: display, ptr: ptr);

  Future<void> init(String appType) async {
    final completer = Completer<void>();
    _applyBuildBootstrapConfig();
    js.context["onInitFinished"] = (() {
      completer.complete();
    }).toJS;
    js.context['dialog'] = ((JSAny? type, JSAny? title, JSAny? text) {
      final uuid = Uuid();
      msgBox(
        SessionID(uuid.v4()),
        (type?.dartify() ?? '').toString(),
        (title?.dartify() ?? '').toString(),
        (text?.dartify() ?? '').toString(),
        '',
        gFFI.dialogManager,
      );
    }).toJS;
    js.context['loginDialog'] = (() {
      loginDialog();
    }).toJS;
    js.context['closeConnection'] = (() {
      gFFI.dialogManager.dismissAll();
      closeConnection();
    }).toJS;
    js.context.callMethod('init');
    version = getByName('version');
    final contextMenuListener = ((web.Event event) {
      event.preventDefault();
    }).toJS;
    web.document.addEventListener('contextmenu', contextMenuListener);
    mouseListeners.add((type: 'contextmenu', callback: contextMenuListener));

    js.context['onRegisteredEvent'] = ((JSAny? message) {
      final raw = (message?.dartify() ?? '').toString();
      try {
        final event = json.decode(raw) as Map<String, dynamic>;
        tryHandle(event);
      } catch (e) {
        debugPrint('json.decode fail(): $e');
      }
    }).toJS;
    return completer.future;
  }

  void _applyBuildBootstrapConfig() {
    final apiServer = _buildApiServer.trim();
    final rsPubKey = _buildRsPubKey.trim();
    final rendezvousServers = _buildRendezvousServers
        .split(',')
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toList(growable: false);

    if (apiServer.isEmpty && rsPubKey.isEmpty && rendezvousServers.isEmpty) {
      return;
    }

    final payload = <String, dynamic>{
      if (apiServer.isNotEmpty) 'apiServer': apiServer,
      if (rsPubKey.isNotEmpty) 'rsPubKey': rsPubKey,
      if (rendezvousServers.isNotEmpty) 'rendezvousServers': rendezvousServers,
      'env': {
        if (apiServer.isNotEmpty) 'API_SERVER': apiServer,
        if (rsPubKey.isNotEmpty) 'RS_PUB_KEY': rsPubKey,
        if (rendezvousServers.isNotEmpty)
          'RENDEZVOUS_SERVERS': rendezvousServers.join(','),
      }
    };

    js.context
        .callMethod('setByName', ['bootstrap_config', jsonEncode(payload)]);
  }

  void setEventCallback(void Function(Map<String, dynamic>) fun) {
    js.context["onGlobalEvent"] = ((JSAny? message) {
      final raw = (message?.dartify() ?? '').toString();
      try {
        final event = json.decode(raw) as Map<String, dynamic>;
        fun(event);
      } catch (e) {
        debugPrint('json.decode fail(): $e');
      }
    }).toJS;
  }

  void setRgbaCallback(void Function(int, Uint8List) fun) {
    js.context["onRgba"] = ((JSAny? display, JSAny? rgba) {
      final displayNumber = (display?.dartify() as num?)?.toInt() ?? 0;
      final rgbaData = rgba?.dartify();
      if (rgbaData is Uint8List) {
        fun(displayNumber, rgbaData);
      }
    }).toJS;
  }

  void startDesktopWebListener() {
    final contextMenuListener = ((web.Event evt) {
      evt.preventDefault();
    }).toJS;
    web.document.addEventListener('contextmenu', contextMenuListener);
    mouseListeners.add((type: 'contextmenu', callback: contextMenuListener));
  }

  void stopDesktopWebListener() {
    for (final listener in mouseListeners) {
      web.document.removeEventListener(listener.type, listener.callback);
    }
    mouseListeners.clear();
    for (final listener in keyListeners) {
      web.document.removeEventListener(listener.type, listener.callback);
    }
    keyListeners.clear();
  }

  void setMethodCallHandler(FMethod callback) {}

  invokeMethod(String method, [dynamic arguments]) async {
    return true;
  }

  // just for compilation
  void syncAndroidServiceAppDirConfigPath() {}

  void setFullscreenCallback(void Function(bool) fun) {
    js.context["onFullscreenChanged"] = ((JSAny? v) {
      fun(v?.dartify() == true);
    }).toJS;
  }
}
