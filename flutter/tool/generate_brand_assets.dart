import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:image/image.dart' as image;

const _plate = (27, 29, 35);
const _plateBorder = (57, 60, 69);
const _indigo = (115, 120, 242);
const _blue = (91, 148, 232);
const _cyan = (67, 184, 209);
const _ivory = (247, 248, 250);
const _petalColors = [_indigo, _blue, _cyan];

image.ColorRgba8 _color((int, int, int) value, [int alpha = 255]) =>
    image.ColorRgba8(value.$1, value.$2, value.$3, alpha);

double _cubic(double a, double b, double c, double d, double t) {
  final mt = 1 - t;
  return mt * mt * mt * a +
      3 * mt * mt * t * b +
      3 * mt * t * t * c +
      t * t * t * d;
}

List<(double, double)> _petal(double radius) {
  const segments = 24;
  final points = <(double, double)>[];
  for (var index = 0; index <= segments; index++) {
    final t = index / segments;
    points.add((
      _cubic(-0.12, -0.48, -0.45, 0, t) * radius,
      _cubic(-0.08, -0.28, -0.70, -0.96, t) * radius,
    ));
  }
  for (var index = 1; index <= segments; index++) {
    final t = index / segments;
    points.add((
      _cubic(0, 0.45, 0.48, 0.12, t) * radius,
      _cubic(-0.96, -0.70, -0.28, -0.08, t) * radius,
    ));
  }
  for (var index = 1; index <= 8; index++) {
    final t = index / 8;
    points.add((
      (0.12 * (1 - t) - 0.12 * t) * radius,
      (-0.08 * (1 - t) + (-0.08 + 0.10 * math.sin(math.pi * t)) * t) * radius,
    ));
  }
  return points;
}

List<image.Point> _rotatePoints(
  List<(double, double)> points, {
  required double angle,
  required double cx,
  required double cy,
}) {
  final cosine = math.cos(angle);
  final sine = math.sin(angle);
  return [
    for (final (x, y) in points)
      image.Point(cx + x * cosine - y * sine, cy + x * sine + y * cosine),
  ];
}

void _drawMark(
  image.Image target, {
  required double cx,
  required double cy,
  required double radius,
  bool monochrome = false,
  bool white = false,
}) {
  final mono = white ? (255, 255, 255) : (0, 0, 0);
  final petal = _petal(radius);
  for (var index = 0; index < 6; index++) {
    image.fillPolygon(
      target,
      vertices: _rotatePoints(
        petal,
        angle: index * math.pi / 3,
        cx: cx,
        cy: cy,
      ),
      color: _color(monochrome ? mono : _petalColors[index % 3]),
    );
  }
  final hub = (radius * 0.245).round();
  final aperture = (hub * 0.54).round();
  if (monochrome) {
    image.fillCircle(
      target,
      x: cx.round(),
      y: cy.round(),
      radius: hub,
      color: _color(mono),
      antialias: true,
    );
    _clearCircle(target, cx.round(), cy.round(), aperture);
  } else {
    image.fillCircle(
      target,
      x: cx.round(),
      y: cy.round(),
      radius: hub,
      color: _color(_plate),
      antialias: true,
    );
    image.fillCircle(
      target,
      x: cx.round(),
      y: cy.round(),
      radius: aperture,
      color: _color(_ivory),
      antialias: true,
    );
  }
}

void _clearCircle(image.Image target, int cx, int cy, int radius) {
  final radiusSquared = radius * radius;
  for (var y = -radius; y <= radius; y++) {
    for (var x = -radius; x <= radius; x++) {
      if (x * x + y * y <= radiusSquared) {
        target.setPixelRgba(cx + x, cy + y, 0, 0, 0, 0);
      }
    }
  }
}

image.Image _renderAppIcon(int size, {bool transparentCorners = false}) {
  final renderSize = size * 2;
  final icon = image.Image(
    width: renderSize,
    height: renderSize,
    numChannels: 4,
  );
  final scale = renderSize / 1024;
  final margin = transparentCorners ? (30 * scale).round() : 0;
  image.fillRect(
    icon,
    x1: margin,
    y1: margin,
    x2: renderSize - margin - 1,
    y2: renderSize - margin - 1,
    radius: (224 * scale).round(),
    color: _color(_plate),
  );
  image.drawRect(
    icon,
    x1: margin + (10 * scale).round(),
    y1: margin + (10 * scale).round(),
    x2: renderSize - margin - 1 - (10 * scale).round(),
    y2: renderSize - margin - 1 - (10 * scale).round(),
    radius: (214 * scale).round(),
    color: _color(_plateBorder, 210),
    thickness: math.max(2, (4 * scale).round()),
  );
  _drawMark(icon, cx: renderSize / 2, cy: renderSize / 2, radius: 372 * scale);
  return image.copyResize(
    icon,
    width: size,
    height: size,
    interpolation: image.Interpolation.cubic,
  );
}

image.Image _renderMark(
  int size, {
  bool monochrome = false,
  bool white = false,
  bool colored = true,
}) {
  final renderSize = size * 4;
  final icon = image.Image(
    width: renderSize,
    height: renderSize,
    numChannels: 4,
  );
  _drawMark(
    icon,
    cx: renderSize / 2,
    cy: renderSize / 2,
    radius: renderSize * 0.49,
    monochrome: monochrome || !colored,
    white: white,
  );
  return image.copyResize(
    icon,
    width: size,
    height: size,
    interpolation: image.Interpolation.cubic,
  );
}

void _writePng(String path, image.Image value) {
  final file = File(path);
  file.parent.createSync(recursive: true);
  file.writeAsBytesSync(image.encodePng(value));
}

void _writeIco(String path, image.Image source, List<int> sizes) {
  final document = image.copyResize(
    source,
    width: sizes.first,
    height: sizes.first,
    interpolation: image.Interpolation.cubic,
  );
  for (final size in sizes.skip(1)) {
    document.addFrame(
      image.copyResize(
        source,
        width: size,
        height: size,
        interpolation: image.Interpolation.cubic,
      ),
    );
  }
  final file = File(path);
  file.parent.createSync(recursive: true);
  file.writeAsBytesSync(image.encodeIco(document));
}

Uint8List _uint32(int value) {
  final data = ByteData(4)..setUint32(0, value, Endian.big);
  return data.buffer.asUint8List();
}

void _writeIcns(String path, image.Image source) {
  final chunks = <(String, int)>[
    ('icp4', 16),
    ('icp5', 32),
    ('icp6', 64),
    ('ic07', 128),
    ('ic08', 256),
    ('ic09', 512),
    ('ic10', 1024),
    ('ic11', 32),
    ('ic12', 64),
    ('ic13', 256),
    ('ic14', 512),
  ];
  final encoded = <(String, Uint8List)>[
    for (final (type, size) in chunks)
      (
        type,
        Uint8List.fromList(
          image.encodePng(
            image.copyResize(
              source,
              width: size,
              height: size,
              interpolation: image.Interpolation.cubic,
            ),
          ),
        ),
      ),
  ];
  final totalLength =
      8 + encoded.fold<int>(0, (sum, entry) => sum + 8 + entry.$2.length);
  final output = BytesBuilder(copy: false)
    ..add('icns'.codeUnits)
    ..add(_uint32(totalLength));
  for (final (type, bytes) in encoded) {
    output
      ..add(type.codeUnits)
      ..add(_uint32(bytes.length + 8))
      ..add(bytes);
  }
  final file = File(path);
  file.parent.createSync(recursive: true);
  file.writeAsBytesSync(output.takeBytes());
}

const _markSvg =
    '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="224" fill="#1b1d23"/>
  <rect x="18" y="18" width="988" height="988" rx="206" fill="none" stroke="#393c45" stroke-width="12"/>
  <defs><path id="petal" d="M467 482C332 405 343 247 512 154C681 247 692 405 557 482Q512 522 467 482Z"/></defs>
  <use href="#petal" fill="#7378f2"/><use href="#petal" fill="#5b94e8" transform="rotate(60 512 512)"/><use href="#petal" fill="#43b8d1" transform="rotate(120 512 512)"/><use href="#petal" fill="#7378f2" transform="rotate(180 512 512)"/><use href="#petal" fill="#5b94e8" transform="rotate(240 512 512)"/><use href="#petal" fill="#43b8d1" transform="rotate(300 512 512)"/>
  <circle cx="512" cy="512" r="91" fill="#1b1d23"/><circle cx="512" cy="512" r="49" fill="#f7f8fa"/>
</svg>
''';

const _faviconSvg =
    '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#1b1d23"/>
  <g transform="scale(.125)"><defs><path id="p" d="M467 482C332 405 343 247 512 154C681 247 692 405 557 482Q512 522 467 482Z"/></defs><use href="#p" fill="#7378f2"/><use href="#p" fill="#5b94e8" transform="rotate(60 512 512)"/><use href="#p" fill="#43b8d1" transform="rotate(120 512 512)"/><use href="#p" fill="#7378f2" transform="rotate(180 512 512)"/><use href="#p" fill="#5b94e8" transform="rotate(240 512 512)"/><use href="#p" fill="#43b8d1" transform="rotate(300 512 512)"/></g>
  <circle cx="64" cy="64" r="11.4" fill="#1b1d23"/><circle cx="64" cy="64" r="6.1" fill="#f7f8fa"/>
</svg>
''';

void _writeVectorAssets() {
  for (final path in [
    '../res/camellia-mark.svg',
    '../res/scalable.svg',
    'assets/icon.svg',
  ]) {
    File(path).writeAsStringSync(_markSvg);
  }
  File('web/favicon.svg').writeAsStringSync(_faviconSvg);
}

void main() {
  final app = _renderAppIcon(1024);
  final mac = _renderAppIcon(1024, transparentCorners: true);
  _writePng('../res/icon.png', app);
  _writePng('../res/mac-icon.png', mac);
  _writePng('../res/android-foreground.png', _renderMark(1024));
  _writePng(
    '../res/android-monochrome.png',
    _renderMark(1024, monochrome: true, white: true),
  );
  _writeIco('../res/icon.ico', app, [16, 20, 24, 32, 40, 48, 64, 128, 256]);
  _writeIcns('macos/Runner/AppIcon.icns', mac);

  for (final size in [32, 64, 128]) {
    _writePng(
      '../res/${size}x$size.png',
      image.copyResize(app, width: size, height: size),
    );
  }
  _writePng('../res/128x128@2x.png', image.copyResize(app, width: 256));

  final tray = _renderMark(256);
  _writeIco('../res/tray-icon.ico', tray, [
    16,
    20,
    24,
    32,
    40,
    48,
    64,
    128,
    256,
  ]);
  _writePng('../res/mac-tray-dark-x2.png', _renderMark(36, monochrome: true));
  _writePng(
    '../res/mac-tray-light-x2.png',
    _renderMark(36, monochrome: true, white: true),
  );
  const androidDensities = {
    'mdpi': 24,
    'hdpi': 36,
    'xhdpi': 48,
    'xxhdpi': 72,
    'xxxhdpi': 96,
  };
  for (final entry in androidDensities.entries) {
    _writePng(
      'android/app/src/main/res/mipmap-${entry.key}/ic_stat_logo.png',
      _renderMark(entry.value, monochrome: true, white: true),
    );
  }
  const androidLauncherDensities = {
    'mdpi': 108,
    'hdpi': 162,
    'xhdpi': 216,
    'xxhdpi': 324,
    'xxxhdpi': 432,
  };
  for (final entry in androidLauncherDensities.entries) {
    final directory = 'android/app/src/main/res/drawable-${entry.key}';
    _writePng(
      '$directory/ic_launcher_foreground.png',
      _renderMark(entry.value),
    );
    _writePng(
      '$directory/ic_launcher_monochrome.png',
      _renderMark(entry.value, monochrome: true, white: true),
    );
  }
  _writePng('assets/brand-mark.png', app);
  _writeVectorAssets();
}
