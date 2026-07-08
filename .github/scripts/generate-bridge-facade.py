#!/usr/bin/env python3
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FFI = ROOT / "flutter/lib/generated_bridge/flutter_ffi.dart"
OUT = ROOT / "flutter/lib/generated_bridge.dart"


FUNCTION_RE = re.compile(
    r"""
    ^\s*
    (?P<return_type>[A-Za-z_][A-Za-z0-9_<>,?. \t]*?)
    \s+
    (?P<name>[A-Za-z_][A-Za-z0-9_]*)
    \s*
    \(
      (?P<params>.*?)
    \)
    \s*=>\s*
    RustLib\s*\.\s*instance\s*\.\s*api\s*\.\s*[A-Za-z_][A-Za-z0-9_]*
    \(
      .*?
    \)
    \s*;
    """,
    re.DOTALL | re.MULTILINE | re.VERBOSE,
)


def normalize_space(value: str) -> str:
    return " ".join(value.split())


def split_top_level(value: str) -> list[str]:
    parts = []
    start = 0
    angle_depth = 0
    for index, char in enumerate(value):
        if char == "<":
            angle_depth += 1
        elif char == ">":
            angle_depth = max(angle_depth - 1, 0)
        elif char == "," and angle_depth == 0:
            part = value[start:index].strip()
            if part:
                parts.append(part)
            start = index + 1

    tail = value[start:].strip()
    if tail:
        parts.append(tail)
    return parts


def parameter_name(parameter: str) -> str:
    match = re.search(r"([A-Za-z_][A-Za-z0-9_]*)\s*(?:=.*)?$", parameter)
    if not match:
        raise ValueError(f"Unsupported named parameter: {parameter}")
    return match.group(1)


def parse_methods(source: str) -> list[str]:
    methods = []
    for match in FUNCTION_RE.finditer(source):
        return_type, name, params = match.group("return_type", "name", "params")
        return_type = normalize_space(return_type)
        params = normalize_space(params)

        if params.startswith("{") and params.endswith("}"):
            inner = params[1:-1].strip()
            names = [parameter_name(part) for part in split_top_level(inner)]
            call_args = ", ".join(f"{name}: {name}" for name in names)
        elif params:
            raise ValueError(f"Unsupported positional parameters for {name}: {params}")
        else:
            call_args = ""

        methods.append(
            f"  {return_type} {name}({params}) => ffi.{name}({call_args});"
        )

    return methods


def main() -> None:
    methods = parse_methods(FFI.read_text())

    if not methods:
        raise RuntimeError(f"No bridge functions parsed from {FFI}")

    OUT.write_text(
        """import 'dart:async';
import 'dart:typed_data';

import 'package:uuid/uuid.dart';

import 'generated_bridge/flutter_ffi.dart' as ffi;
import 'generated_bridge/flutter_ffi.dart' show EventToUI;

export 'generated_bridge/frb_generated.dart';
export 'generated_bridge/flutter_ffi.dart';
export 'package:flutter_rust_bridge/flutter_rust_bridge_for_generated.dart'
    show ExternalLibrary;

class RustdeskImpl {
  const RustdeskImpl();

"""
        + "\n".join(methods)
        + "\n}\n"
    )

    print(f"Generated {len(methods)} RustdeskImpl bridge facade methods")


if __name__ == "__main__":
    main()
