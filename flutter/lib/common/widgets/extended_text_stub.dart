import 'package:flutter/widgets.dart';

enum TextOverflowPosition { start, middle, end }

class TextOverflowWidget {
  const TextOverflowWidget({
    required this.child,
    this.position = TextOverflowPosition.end,
  });

  final Widget child;
  final TextOverflowPosition position;
}

class ExtendedText extends StatelessWidget {
  const ExtendedText(
    this.data, {
    super.key,
    this.style,
    this.textAlign,
    this.textDirection,
    this.locale,
    this.softWrap,
    this.overflow,
    this.maxLines,
    this.textScaleFactor,
    this.overflowWidget,
  });

  final String data;
  final TextStyle? style;
  final TextAlign? textAlign;
  final TextDirection? textDirection;
  final Locale? locale;
  final bool? softWrap;
  final TextOverflow? overflow;
  final int? maxLines;
  final double? textScaleFactor;
  final TextOverflowWidget? overflowWidget;

  @override
  Widget build(BuildContext context) {
    return Text(
      data,
      style: style,
      textAlign: textAlign,
      textDirection: textDirection,
      locale: locale,
      softWrap: softWrap,
      overflow: overflow,
      maxLines: maxLines,
      textScaleFactor: textScaleFactor,
    );
  }
}
