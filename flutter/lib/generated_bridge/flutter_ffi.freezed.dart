// Minimal generated-compatible union implementations for EventToUI.
// This file is overwritten by flutter_rust_bridge/freezed generation.

part of 'flutter_ffi.dart';

mixin _$EventToUI {
  Object get field0 => throw UnsupportedError('EventToUI has no shared field0');
}

final class EventToUI_Event extends EventToUI {
  const EventToUI_Event(this.field0) : super._();

  @override
  final String field0;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is EventToUI_Event && other.field0 == field0;

  @override
  int get hashCode => Object.hash(runtimeType, field0);

  @override
  String toString() => 'EventToUI.event(field0: $field0)';
}

final class EventToUI_Rgba extends EventToUI {
  const EventToUI_Rgba(this.field0) : super._();

  @override
  final int field0;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is EventToUI_Rgba && other.field0 == field0;

  @override
  int get hashCode => Object.hash(runtimeType, field0);

  @override
  String toString() => 'EventToUI.rgba(field0: $field0)';
}

final class EventToUI_Texture extends EventToUI {
  const EventToUI_Texture(this.field0, this.field1) : super._();

  @override
  final int field0;
  final bool field1;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is EventToUI_Texture &&
          other.field0 == field0 &&
          other.field1 == field1;

  @override
  int get hashCode => Object.hash(runtimeType, field0, field1);

  @override
  String toString() => 'EventToUI.texture(field0: $field0, field1: $field1)';
}
