import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_hbb/common.dart';
import 'package:flutter_hbb/common/widgets/setting_widgets.dart';
import 'package:flutter_hbb/common/widgets/login.dart';
import 'package:flutter_hbb/consts.dart';
import 'package:flutter_hbb/models/platform_model.dart';
import 'package:get/get.dart';

class WebClientSettingsPage extends StatefulWidget {
  const WebClientSettingsPage({super.key});

  @override
  State<WebClientSettingsPage> createState() => _WebClientSettingsPageState();
}

class _WebClientSettingsPageState extends State<WebClientSettingsPage> {
  late final TextEditingController _directPortController;
  late final TextEditingController _permanentPasswordController;
  final FocusNode _directPortFocusNode = FocusNode();
  bool _obscurePermanentPassword = true;
  bool _savingPermanentPassword = false;
  String _temporaryPassword = '';
  bool _hasPermanentPassword = false;

  final List<({String key, String label})> _langs = [];
  bool _langsLoaded = false;

  @override
  void initState() {
    super.initState();
    _directPortController = TextEditingController(
      text: bind.mainGetOptionSync(key: kOptionDirectAccessPort),
    );
    _permanentPasswordController = TextEditingController();
    _loadLanguages();
    _refreshPasswordState();
  }

  @override
  void dispose() {
    _directPortController.dispose();
    _permanentPasswordController.dispose();
    _directPortFocusNode.dispose();
    super.dispose();
  }

  Future<void> _refreshPasswordState() async {
    try {
      final temporary = (await bind.mainGetTemporaryPassword()).trim();
      final permanent = (await bind.mainGetPermanentPassword()).trim();
      if (!mounted) return;
      setState(() {
        _temporaryPassword = temporary;
        _hasPermanentPassword = permanent.isNotEmpty;
      });
    } catch (_) {
      // Ignore transient bridge failures.
    }
  }

  Future<void> _loadLanguages() async {
    try {
      final langsJson = await bind.mainGetLangs();
      final parsed = jsonDecode(langsJson) as List<dynamic>;
      _langs.clear();
      _langs.add((key: defaultOptionLang, label: translate('Default')));
      for (final row in parsed) {
        if (row is List && row.length >= 2) {
          final key = row[0].toString();
          final label = row[1].toString();
          _langs.add((key: key, label: label));
        }
      }
      _langsLoaded = true;
      if (mounted) {
        setState(() {});
      }
    } catch (_) {
      _langsLoaded = true;
      if (mounted) {
        setState(() {});
      }
    }
  }

  Future<void> _setBoolOption(String key, bool value) async {
    await mainSetBoolOption(key, value);
    if (mounted) {
      setState(() {});
    }
  }

  Future<void> _setOption(String key, String value) async {
    await bind.mainSetOption(key: key, value: value);
    if (mounted) {
      setState(() {});
    }
  }

  Future<void> _setUserDefaultOption(String key, String value) async {
    await bind.mainSetUserDefaultOption(key: key, value: value);
    if (mounted) {
      setState(() {});
    }
  }

  Future<void> _setUserDefaultBool(String key, bool value) async {
    final offValue = key == kOptionEnableFileCopyPaste ? 'N' : defaultOptionNo;
    await bind.mainSetUserDefaultOption(
      key: key,
      value: value ? 'Y' : offValue,
    );
    if (mounted) {
      setState(() {});
    }
  }

  Future<ServerConfig> _loadServerConfig() async {
    try {
      final options = jsonDecode(await bind.mainGetOptions()) as Map<String, dynamic>;
      return ServerConfig.fromOptions(options);
    } catch (_) {
      return ServerConfig(idServer: '', relayServer: '', apiServer: '', key: '');
    }
  }

  void _openServerSettings() async {
    final serverConfig = await _loadServerConfig();
    if (!mounted) return;

    final idCtrl = TextEditingController(text: serverConfig.idServer);
    final relayCtrl = TextEditingController(text: serverConfig.relayServer);
    final apiCtrl = TextEditingController(text: serverConfig.apiServer);
    final keyCtrl = TextEditingController(text: serverConfig.key);

    final idErr = ''.obs;
    final relayErr = ''.obs;
    final apiErr = ''.obs;
    final controllers = [idCtrl, relayCtrl, apiCtrl, keyCtrl];
    final errMsgs = [idErr, relayErr, apiErr];
    var isInProgress = false;

    try {
      await showDialog<void>(
        context: context,
        builder: (dialogContext) {
          return StatefulBuilder(
            builder: (context, setDialogState) {
              Future<void> submit() async {
                setDialogState(() {
                  isInProgress = true;
                });
                final ok = await setServerConfig(
                  controllers,
                  errMsgs,
                  ServerConfig(
                    idServer: idCtrl.text.trim(),
                    relayServer: relayCtrl.text.trim(),
                    apiServer: apiCtrl.text.trim(),
                    key: keyCtrl.text.trim(),
                  ),
                );
                if (!dialogContext.mounted) {
                  return;
                }
                setDialogState(() {
                  isInProgress = false;
                });
                if (ok) {
                  Navigator.of(dialogContext).pop();
                  showToast(translate('Successful'));
                  if (mounted) {
                    setState(() {});
                  }
                } else {
                  setDialogState(() {});
                  showToast(translate('Failed'));
                }
              }

              Widget buildField({
                required String label,
                required TextEditingController controller,
                required String error,
                String? hint,
              }) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 6),
                    TextField(
                      controller: controller,
                      decoration: InputDecoration(
                        isDense: true,
                        hintText: hint,
                        errorText: error.isEmpty ? null : error,
                        border: const OutlineInputBorder(),
                      ),
                    ),
                  ],
                );
              }

              return AlertDialog(
                title: Row(
                  children: [
                    Expanded(child: Text(translate('ID/Relay Server'))),
                    ...ServerConfigImportExportWidgets(controllers, errMsgs),
                  ],
                ),
                content: SizedBox(
                  width: 580,
                  child: SingleChildScrollView(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        buildField(
                          label: translate('ID Server'),
                          controller: idCtrl,
                          error: idErr.value,
                          hint: 'host[:port]',
                        ),
                        const SizedBox(height: 10),
                        buildField(
                          label: translate('Relay Server'),
                          controller: relayCtrl,
                          error: relayErr.value,
                          hint: 'host[:port]',
                        ),
                        const SizedBox(height: 10),
                        buildField(
                          label: translate('API Server'),
                          controller: apiCtrl,
                          error: apiErr.value,
                          hint: 'https://api.example.com',
                        ),
                        const SizedBox(height: 10),
                        buildField(
                          label: 'Key',
                          controller: keyCtrl,
                          error: '',
                        ),
                        if (isInProgress) ...[
                          const SizedBox(height: 12),
                          const LinearProgressIndicator(),
                        ],
                      ],
                    ),
                  ),
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.of(dialogContext).pop(),
                    child: Text(translate('Cancel')),
                  ),
                  FilledButton(
                    onPressed: isInProgress ? null : submit,
                    child: Text(translate('OK')),
                  ),
                ],
              );
            },
          );
        },
      );
    } finally {
      idCtrl.dispose();
      relayCtrl.dispose();
      apiCtrl.dispose();
      keyCtrl.dispose();
    }
  }

  Future<void> _applyDirectAccessPort() async {
    final value = int.tryParse(_directPortController.text.trim());
    if (value == null || value <= 0 || value > 65535) {
      showToast(translate('Invalid port'));
      return;
    }
    await bind.mainSetOption(key: kOptionDirectAccessPort, value: '$value');
    if (mounted) {
      setState(() {});
    }
  }

  Future<void> _regenerateOneTimePassword() async {
    await bind.mainUpdateTemporaryPassword();
    await _refreshPasswordState();
  }

  Future<void> _savePermanentPassword() async {
    final password = _permanentPasswordController.text;
    if (password.trim().isEmpty) {
      showToast('Password cannot be empty');
      return;
    }
    setState(() {
      _savingPermanentPassword = true;
    });
    try {
      await bind.mainSetPermanentPassword(password: password);
      await Future.delayed(const Duration(milliseconds: 350));
      final saved = (await bind.mainGetPermanentPassword()).trim();
      if (!mounted) return;
      if (saved == password) {
        _permanentPasswordController.clear();
        _hasPermanentPassword = true;
        showToast(translate('Successful'));
      } else {
        showToast(translate('Failed'));
      }
    } finally {
      if (mounted) {
        setState(() {
          _savingPermanentPassword = false;
        });
      }
    }
  }

  String _otherLabel(String raw) {
    if (raw == 'show_monitors_tip') {
      return translate('Show monitors toolbar');
    }
    return translate(raw);
  }

  Widget _sectionCard(String title, List<Widget> children) {
    return Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
            child: Text(
              translate(title),
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
          ),
          ...children,
        ],
      ),
    );
  }

  Widget _dropdownTile({
    required IconData icon,
    required String title,
    required String value,
    required List<DropdownMenuItem<String>> items,
    required ValueChanged<String?>? onChanged,
    String? subtitle,
  }) {
    return ListTile(
      leading: Icon(icon),
      title: Text(translate(title)),
      subtitle: subtitle == null ? null : Text(subtitle),
      trailing: SizedBox(
        width: 220,
        child: DropdownButtonFormField<String>(
          value: value,
          items: items,
          isDense: true,
          onChanged: onChanged,
          decoration: const InputDecoration(
            isDense: true,
            contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final directIpEnabled = mainGetBoolOptionSync(kOptionEnableDirectServer);
    final allowWebSocket = mainGetBoolOptionSync(kOptionAllowWebSocket);
    final isDirectIpFixed = isOptionFixed(kOptionEnableDirectServer);
    final isDirectPortFixed = isOptionFixed(kOptionDirectAccessPort);
    final storedDirectPort = bind.mainGetOptionSync(key: kOptionDirectAccessPort);
    if (!_directPortFocusNode.hasFocus &&
        _directPortController.text != storedDirectPort) {
      _directPortController.text = storedDirectPort;
    }

    final verificationMethodRaw =
        bind.mainGetOptionSync(key: kOptionVerificationMethod);
    final verificationMethod = const {
      'use-both-passwords',
      'use-temporary-password',
      'use-permanent-password',
    }.contains(verificationMethodRaw)
        ? verificationMethodRaw
        : 'use-both-passwords';
    final tempPasswordLengthRaw =
        bind.mainGetOptionSync(key: 'temporary-password-length');
    final tempPasswordLength = const {'6', '8', '10'}.contains(tempPasswordLengthRaw)
        ? tempPasswordLengthRaw
        : '6';
    final allowNumericOtp =
        mainGetBoolOptionSync(kOptionAllowNumericOneTimePassword);

    final viewStyleRaw = bind.mainGetUserDefaultOption(key: kOptionViewStyle);
    final viewStyle = const {
      kRemoteViewStyleOriginal,
      kRemoteViewStyleAdaptive,
      kRemoteViewStyleCustom,
    }.contains(viewStyleRaw)
        ? viewStyleRaw
        : kRemoteViewStyleOriginal;
    final imageQualityRaw = bind.mainGetUserDefaultOption(key: kOptionImageQuality);
    final imageQuality = const {
      kRemoteImageQualityBest,
      kRemoteImageQualityBalanced,
      kRemoteImageQualityLow,
      kRemoteImageQualityCustom,
    }.contains(imageQualityRaw)
        ? imageQualityRaw
        : kRemoteImageQualityBalanced;
    final codecPreferenceRaw =
        bind.mainGetUserDefaultOption(key: kOptionCodecPreference);
    final codecPreference = const {
      'auto',
      'vp8',
      'vp9',
      'av1',
      'h264',
      'h265',
    }.contains(codecPreferenceRaw)
        ? codecPreferenceRaw
        : 'auto';

    var currentLang = bind.mainGetLocalOption(key: kCommConfKeyLang);
    final langKeys = _langs.map((e) => e.key).toSet();
    if (!langKeys.contains(currentLang)) {
      currentLang = defaultOptionLang;
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(translate('Settings')),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _sectionCard('General', [
            if (_langsLoaded && _langs.isNotEmpty)
              _dropdownTile(
                icon: Icons.language,
                title: 'Language',
                value: currentLang,
                items: _langs
                    .map((e) =>
                        DropdownMenuItem(value: e.key, child: Text(e.label)))
                    .toList(),
                onChanged: isOptionFixed(kCommConfKeyLang)
                    ? null
                    : (v) async {
                        if (v == null) {
                          return;
                        }
                        await bind.mainSetLocalOption(
                          key: kCommConfKeyLang,
                          value: v,
                        );
                        reloadCurrentWindow();
                      },
              ),
          ]),
          const SizedBox(height: 12),
          _sectionCard('Account', [
            Obx(() {
              final isLogin = gFFI.userModel.userName.value.isNotEmpty;
              return ListTile(
                leading: const Icon(Icons.person_outline),
                title: Text(isLogin ? translate('Logout') : translate('Login')),
                subtitle: isLogin
                    ? Text(gFFI.userModel.userName.value)
                    : Text(translate('Not logged in')),
                onTap: () async {
                  if (isLogin) {
                    await gFFI.userModel.logOut();
                  } else {
                    await loginDialog();
                  }
                  if (mounted) {
                    setState(() {});
                  }
                },
              );
            }),
          ]),
          const SizedBox(height: 12),
          _sectionCard('Network', [
            ListTile(
              leading: const Icon(Icons.dns_outlined),
              title: Text(translate('ID/Relay Server')),
              subtitle: Text(translate('Configure server endpoints and key')),
              onTap: _openServerSettings,
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.web_asset_outlined),
              title: Text(translate('Use WebSocket')),
              subtitle: Text(
                'Web client transport is WS/WSS only (browser limitation).',
              ),
              trailing: Icon(
                allowWebSocket ? Icons.check_circle : Icons.info_outline,
                color: allowWebSocket ? Colors.green : Colors.orange,
              ),
            ),
            const Divider(height: 1),
            SwitchListTile(
              value: directIpEnabled,
              onChanged: isDirectIpFixed
                  ? null
                  : (value) => _setBoolOption(kOptionEnableDirectServer, value),
              title: Text(translate('Enable direct IP access')),
              subtitle: const Text(
                'Requires target host WS/WSS endpoint, for example ws://host:21118.',
              ),
            ),
            if (directIpEnabled)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _directPortController,
                        focusNode: _directPortFocusNode,
                        enabled: !isDirectPortFixed,
                        keyboardType: TextInputType.number,
                        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                        decoration: InputDecoration(
                          labelText: translate('Port'),
                          hintText: '21118',
                          isDense: true,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    ElevatedButton(
                      onPressed: isDirectPortFixed ? null : _applyDirectAccessPort,
                      child: Text(translate('Apply')),
                    ),
                  ],
                ),
              ),
          ]),
          const SizedBox(height: 12),
          _sectionCard('Security', [
            _dropdownTile(
              icon: Icons.verified_user_outlined,
              title: 'Verification method',
              value: verificationMethod,
              items: const [
                DropdownMenuItem(
                  value: 'use-both-passwords',
                  child: Text('Use both passwords'),
                ),
                DropdownMenuItem(
                  value: 'use-temporary-password',
                  child: Text('Use one-time password'),
                ),
                DropdownMenuItem(
                  value: 'use-permanent-password',
                  child: Text('Use permanent password'),
                ),
              ],
              onChanged: isOptionFixed(kOptionVerificationMethod)
                  ? null
                  : (v) => _setOption(kOptionVerificationMethod, v ?? ''),
            ),
            const Divider(height: 1),
            _dropdownTile(
              icon: Icons.password,
              title: 'Set one-time password length',
              value: tempPasswordLength,
              items: const [
                DropdownMenuItem(value: '6', child: Text('6')),
                DropdownMenuItem(value: '8', child: Text('8')),
                DropdownMenuItem(value: '10', child: Text('10')),
              ],
              onChanged: isOptionFixed('temporary-password-length')
                  ? null
                  : (v) async {
                      await _setOption('temporary-password-length', v ?? '6');
                      await bind.mainUpdateTemporaryPassword();
                    },
            ),
            const Divider(height: 1),
            SwitchListTile(
              value: allowNumericOtp,
              onChanged: isOptionFixed(kOptionAllowNumericOneTimePassword)
                  ? null
                  : (v) => _setBoolOption(kOptionAllowNumericOneTimePassword, v),
              title: Text(translate('Allow only one-time password')),
              subtitle: const Text(
                'When enabled, only one-time password is accepted. Useful for temporary support sessions.',
              ),
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.vpn_key_outlined),
              title: Text(translate('One-time password')),
              subtitle: Text(
                _temporaryPassword.isEmpty
                    ? translate('Generating ...')
                    : _temporaryPassword,
              ),
              trailing: IconButton(
                tooltip: translate('Refresh'),
                onPressed: _regenerateOneTimePassword,
                icon: const Icon(Icons.refresh),
              ),
            ),
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    translate('Permanent Password'),
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _hasPermanentPassword
                        ? translate('Configured')
                        : translate('Not configured'),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _permanentPasswordController,
                          obscureText: _obscurePermanentPassword,
                          maxLength: bind.mainMaxEncryptLen(),
                          decoration: InputDecoration(
                            isDense: true,
                            hintText: translate('Permanent Password'),
                            suffixIcon: IconButton(
                              onPressed: () {
                                setState(() {
                                  _obscurePermanentPassword =
                                      !_obscurePermanentPassword;
                                });
                              },
                              icon: Icon(_obscurePermanentPassword
                                  ? Icons.visibility_off
                                  : Icons.visibility),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      ElevatedButton(
                        onPressed:
                            _savingPermanentPassword ? null : _savePermanentPassword,
                        child: Text(translate('Apply')),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ]),
          const SizedBox(height: 12),
          _sectionCard('Display', [
            _dropdownTile(
              icon: Icons.desktop_windows_outlined,
              title: 'Default View Style',
              value: viewStyle,
              items: const [
                DropdownMenuItem(
                    value: kRemoteViewStyleOriginal, child: Text('Scale original')),
                DropdownMenuItem(
                    value: kRemoteViewStyleAdaptive, child: Text('Scale adaptive')),
                DropdownMenuItem(value: kRemoteViewStyleCustom, child: Text('Custom')),
              ],
              onChanged: isOptionFixed(kOptionViewStyle)
                  ? null
                  : (v) => _setUserDefaultOption(kOptionViewStyle, v ?? ''),
            ),
            const Divider(height: 1),
            _dropdownTile(
              icon: Icons.high_quality_outlined,
              title: 'Default Image Quality',
              value: imageQuality,
              items: const [
                DropdownMenuItem(
                    value: kRemoteImageQualityBest, child: Text('Good image quality')),
                DropdownMenuItem(
                    value: kRemoteImageQualityBalanced, child: Text('Balanced')),
                DropdownMenuItem(
                    value: kRemoteImageQualityLow, child: Text('Optimize reaction time')),
                DropdownMenuItem(value: kRemoteImageQualityCustom, child: Text('Custom')),
              ],
              onChanged: isOptionFixed(kOptionImageQuality)
                  ? null
                  : (v) => _setUserDefaultOption(kOptionImageQuality, v ?? ''),
            ),
            const Divider(height: 1),
            _dropdownTile(
              icon: Icons.video_settings_outlined,
              title: 'Default Codec',
              value: codecPreference,
              items: const [
                DropdownMenuItem(value: 'auto', child: Text('Auto')),
                DropdownMenuItem(value: 'vp8', child: Text('VP8')),
                DropdownMenuItem(value: 'vp9', child: Text('VP9')),
                DropdownMenuItem(value: 'av1', child: Text('AV1')),
                DropdownMenuItem(value: 'h264', child: Text('H264')),
                DropdownMenuItem(value: 'h265', child: Text('H265')),
              ],
              onChanged: isOptionFixed(kOptionCodecPreference)
                  ? null
                  : (v) => _setUserDefaultOption(kOptionCodecPreference, v ?? ''),
            ),
          ]),
          const SizedBox(height: 12),
          _sectionCard('Other Default Options', [
            ...otherDefaultSettings().map((item) {
              final key = item.$2;
              final value = bind.mainGetUserDefaultOption(key: key) == 'Y';
              return SwitchListTile(
                value: value,
                onChanged: isOptionFixed(key)
                    ? null
                    : (v) => _setUserDefaultBool(key, v),
                title: Text(_otherLabel(item.$1)),
              );
            }),
          ]),
        ],
      ),
    );
  }
}
