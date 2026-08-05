#!/usr/bin/env python3
"""Generate the synthetic hostile JPEG corpus used by intake tests.

This script intentionally uses no Python packages. It shells out to mature fixture
creation tools, but none of those tools become application or npm dependencies.
"""

from __future__ import annotations

import base64
import hashlib
import json
import shutil
import struct
import subprocess
import tempfile
import zlib
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
CORPUS_DIRECTORY = REPOSITORY_ROOT / "tests" / "fixtures" / "jpeg"

HOSTILE_EXIF = 'PC-HOSTILE-EXIF <img src=x onerror="globalThis.PC_PWNED=1">'
HOSTILE_XMP = "PC-HOSTILE-XMP <script>globalThis.PC_PWNED=1</script>"
HOSTILE_IPTC = "PC-HOSTILE-IPTC <svg onload=globalThis.PC_PWNED=1>"

# Two 2x1 frames (red, then blue), generated once with:
# magick -size 2x1 xc:'#ff0000' -size 2x1 xc:'#0000ff' \
#   -set delay 10 -loop 0 two-frame.gif
ANIMATED_GIF = base64.b64decode(
    "R0lGODlhAgABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAgABAAACAgQKACH5BAAKAAAALAAAAAACAAEAgAAA/wAAAAICBAoAOw=="
)

# Expected displayed corner order after applying each EXIF orientation. Source
# corners are red/green/blue/yellow in reading order.
ORIENTATION_CORNERS = {
    1: ["red", "green", "blue", "yellow"],
    2: ["green", "red", "yellow", "blue"],
    3: ["yellow", "blue", "green", "red"],
    4: ["blue", "yellow", "red", "green"],
    5: ["red", "blue", "green", "yellow"],
    6: ["blue", "red", "yellow", "green"],
    7: ["yellow", "green", "blue", "red"],
    8: ["green", "yellow", "red", "blue"],
}


def main() -> None:
    tools = {name: require_tool(name) for name in ("cjpeg", "exiftool", "c2patool")}
    CORPUS_DIRECTORY.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="privacy-canvas-fixtures-") as temporary:
        workspace = Path(temporary)
        pattern = workspace / "orientation-pattern.ppm"
        write_orientation_pattern(pattern)

        control = CORPUS_DIRECTORY / "control-valid.jpg"
        run(
            tools["cjpeg"],
            "-baseline",
            "-optimize",
            "-quality",
            "95",
            "-sample",
            "1x1",
            "-outfile",
            str(control),
            str(pattern),
        )

        fixtures: list[dict[str, Any]] = [
            fixture(
                control,
                disposition="accept",
                detected_type="image/jpeg",
                purpose="valid-control",
                width=64,
                height=48,
                metadata_risks=[],
                description="Metadata-free asymmetric JPEG control.",
            )
        ]

        for orientation in range(1, 9):
            destination = CORPUS_DIRECTORY / f"orientation-{orientation}.jpg"
            shutil.copyfile(control, destination)
            run(
                tools["exiftool"],
                "-overwrite_original",
                "-n",
                f"-EXIF:Orientation={orientation}",
                str(destination),
            )
            fixtures.append(
                fixture(
                    destination,
                    disposition="accept",
                    detected_type="image/jpeg",
                    purpose="orientation-control",
                    width=64,
                    height=48,
                    orientation=orientation,
                    normalized_width=48 if orientation >= 5 else 64,
                    normalized_height=64 if orientation >= 5 else 48,
                    expected_corners=ORIENTATION_CORNERS[orientation],
                    metadata_risks=[],
                    description=f"Asymmetric JPEG with EXIF orientation {orientation}.",
                )
            )

        metadata_rich = CORPUS_DIRECTORY / "metadata-rich.jpg"
        shutil.copyfile(control, metadata_rich)
        run(
            tools["exiftool"],
            "-overwrite_original",
            "-EXIF:Make=Privacy Canvas Fixture Camera",
            "-EXIF:Model=PC-SYNTHETIC-42",
            "-IFD0:CameraSerialNumber=PC-SYNTHETIC-0001",
            "-ExifIFD:OwnerName=Fixture Person",
            "-ExifIFD:ExifImageWidth=64",
            "-ExifIFD:ExifImageHeight=48",
            "-EXIF:Artist=Fixture Person <fixture@example.invalid>",
            f"-EXIF:ImageDescription={HOSTILE_EXIF}",
            f"-EXIF:UserComment={HOSTILE_EXIF}",
            "-EXIF:Software=Privacy Canvas Fixture Editor 1.0",
            "-EXIF:ModifyDate=2026:08:05 12:34:56",
            "-EXIF:DateTimeOriginal=2026:08:05 12:34:56",
            "-EXIF:CreateDate=2026:08:05 12:34:56",
            "-EXIF:OffsetTimeOriginal=+00:00",
            "-EXIF:GPSLatitude=45 30 0",
            "-EXIF:GPSLatitudeRef=N",
            "-EXIF:GPSLongitude=73 34 0",
            "-EXIF:GPSLongitudeRef=W",
            "-EXIF:GPSAltitude=35",
            "-EXIF:GPSAltitudeRef=Above Sea Level",
            "-EXIF:GPSDateStamp=2026:08:05",
            f"-ThumbnailImage<={control}",
            "-XMP-dc:Creator=Fixture Person <fixture@example.invalid>",
            f"-XMP-dc:Description={HOSTILE_XMP}",
            "-XMP-xmp:CreatorTool=Privacy Canvas Fixture Editor 1.0",
            "-XMP-xmp:CreateDate=2026-08-05T12:34:56Z",
            "-XMP-xmpMM:DocumentID=xmp:did:00000000-0000-4000-8000-000000000003",
            "-XMP-xmpMM:InstanceID=xmp:iid:00000000-0000-4000-8000-000000000004",
            "-IPTC:By-line=Fixture Person",
            "-IPTC:City=Fixture City",
            "-IPTC:DateCreated=2026:08:05",
            "-IPTC:TimeCreated=12:34:56+00:00",
            f"-IPTC:Caption-Abstract={HOSTILE_IPTC}",
            str(metadata_rich),
        )
        rich_risks = [
            "creator-contact",
            "device-identity",
            "editing-history",
            "embedded-thumbnail",
            "hostile-text",
            "location",
            "timestamp",
        ]
        fixtures.append(
            fixture(
                metadata_rich,
                disposition="accept",
                detected_type="image/jpeg",
                purpose="metadata-risk-control",
                width=64,
                height=48,
                metadata_risks=rich_risks,
                source_name='PC-HOSTILE-NAME <img src=x onerror="globalThis.PC_PWNED=1">.jpg',
                description="JPEG containing synthetic EXIF, GPS, thumbnail, XMP, IPTC, and hostile text values.",
            )
        )

        c2pa = CORPUS_DIRECTORY / "metadata-c2pa.jpg"
        c2pa_manifest = json.dumps(
            {
                "claim_generator": "Privacy Canvas synthetic fixture generator",
                "label": "urn:c2pa:00000000-0000-4000-8000-000000000001",
                "instance_id": "xmp:iid:00000000-0000-4000-8000-000000000002",
                "title": "metadata-c2pa.jpg",
                "assertions": [],
            },
            separators=(",", ":"),
        )
        run(
            tools["c2patool"],
            str(metadata_rich),
            "--create",
            "digitalCapture",
            "--config",
            c2pa_manifest,
            "--output",
            str(c2pa),
            "--force",
        )
        fixtures.append(
            fixture(
                c2pa,
                disposition="accept",
                detected_type="image/jpeg",
                purpose="c2pa-provenance",
                width=64,
                height=48,
                metadata_risks=[*rich_risks, "provenance"],
                description="Metadata-rich JPEG with a locally signed synthetic C2PA manifest in JUMBF APP11 segments.",
            )
        )

        not_jpeg = CORPUS_DIRECTORY / "invalid-not-jpeg.jpg"
        not_jpeg.write_bytes(make_png())
        fixtures.append(
            fixture(
                not_jpeg,
                disposition="reject",
                detected_type="image/png",
                purpose="renamed-non-jpeg",
                failure="magic-byte-mismatch",
                metadata_risks=[],
                description="Valid one-pixel PNG renamed with a .jpg extension.",
            )
        )

        animated = CORPUS_DIRECTORY / "invalid-animated.gif.jpg"
        animated.write_bytes(ANIMATED_GIF)
        fixtures.append(
            fixture(
                animated,
                disposition="reject",
                detected_type="image/gif",
                purpose="unsupported-animation",
                failure="unsupported-animation",
                metadata_risks=[],
                description="Valid two-frame GIF renamed with a .jpg extension.",
            )
        )

        control_bytes = control.read_bytes()

        truncated = CORPUS_DIRECTORY / "invalid-truncated.jpg"
        scan_data_offset = find_scan_data_offset(control_bytes)
        truncated.write_bytes(control_bytes[: scan_data_offset + 4])
        fixtures.append(
            fixture(
                truncated,
                disposition="reject",
                detected_type="image/jpeg",
                purpose="truncated-container",
                failure="truncated-container",
                width=64,
                height=48,
                metadata_risks=[],
                description="JPEG truncated four entropy-coded bytes after its SOS header.",
            )
        )

        zero_dimension = CORPUS_DIRECTORY / "invalid-zero-dimension.jpg"
        zero_dimension.write_bytes(patch_dimensions(control_bytes, width=0, height=48))
        fixtures.append(
            fixture(
                zero_dimension,
                disposition="reject",
                detected_type="image/jpeg",
                purpose="malformed-dimensions",
                failure="malformed-dimensions",
                width=0,
                height=48,
                metadata_risks=[],
                description="JPEG whose SOF width is zero.",
            )
        )

        oversized = CORPUS_DIRECTORY / "invalid-oversized-dimensions.jpg"
        oversized.write_bytes(patch_dimensions(control_bytes, width=65_535, height=65_535))
        fixtures.append(
            fixture(
                oversized,
                disposition="reject",
                detected_type="image/jpeg",
                purpose="resource-limit-dimensions",
                failure="resource-limit-dimensions",
                width=65_535,
                height=65_535,
                metadata_risks=[],
                description="Small JPEG declaring 65,535 by 65,535 pixels in SOF.",
            )
        )

        trailing = CORPUS_DIRECTORY / "invalid-trailing-data.jpg"
        trailing.write_bytes(control_bytes + b'\nPC-HOSTILE-TRAILING <script>globalThis.PC_PWNED=1</script>\n')
        fixtures.append(
            fixture(
                trailing,
                disposition="reject",
                detected_type="image/jpeg",
                purpose="unexpected-trailing-data",
                failure="unexpected-trailing-data",
                width=64,
                height=48,
                metadata_risks=["hostile-text"],
                description="Valid JPEG followed by undeclared hostile bytes after EOI.",
            )
        )

    remove_undeclared_files({item["file"] for item in fixtures})
    manifest = {
        "schemaVersion": 1,
        "license": "Apache-2.0",
        "source": "Entirely synthetic; no user or real-world media is included.",
        "generationCommand": "python3 scripts/generate-jpeg-fixtures.py",
        "toolVersions": {
            "cjpeg": tool_version(tools["cjpeg"], "-version"),
            "exiftool": tool_version(tools["exiftool"], "-ver"),
            "c2patool": tool_version(tools["c2patool"], "--version"),
        },
        "fixtures": fixtures,
    }
    (CORPUS_DIRECTORY / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Generated {len(fixtures)} fixtures in {CORPUS_DIRECTORY.relative_to(REPOSITORY_ROOT)}")


def fixture(
    path: Path,
    *,
    disposition: str,
    detected_type: str,
    purpose: str,
    metadata_risks: list[str],
    description: str,
    width: int | None = None,
    height: int | None = None,
    orientation: int | None = None,
    failure: str | None = None,
    source_name: str | None = None,
    normalized_width: int | None = None,
    normalized_height: int | None = None,
    expected_corners: list[str] | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "file": path.name,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "disposition": disposition,
        "detectedType": detected_type,
        "purpose": purpose,
        "metadataRisks": metadata_risks,
        "description": description,
    }
    if width is not None:
        item["width"] = width
    if height is not None:
        item["height"] = height
    if orientation is not None:
        item["orientation"] = orientation
    if failure is not None:
        item["failure"] = failure
    if source_name is not None:
        item["sourceName"] = source_name
    if normalized_width is not None:
        item["normalizedWidth"] = normalized_width
    if normalized_height is not None:
        item["normalizedHeight"] = normalized_height
    if expected_corners is not None:
        item["expectedCorners"] = expected_corners
    return item


def write_orientation_pattern(path: Path) -> None:
    width, height = 64, 48
    pixels = bytearray()
    for y in range(height):
        for x in range(width):
            if x < width // 2 and y < height // 2:
                color = (240, 24, 24)  # top-left red
            elif y < height // 2:
                color = (24, 200, 48)  # top-right green
            elif x < width // 2:
                color = (24, 72, 240)  # bottom-left blue
            else:
                color = (240, 216, 24)  # bottom-right yellow

            # A white L in the encoded top-left makes mirroring and rotation obvious.
            if (4 <= x <= 7 and 4 <= y <= 19) or (4 <= x <= 19 and 16 <= y <= 19):
                color = (255, 255, 255)
            pixels.extend(color)
    path.write_bytes(f"P6\n{width} {height}\n255\n".encode("ascii") + pixels)


def patch_dimensions(jpeg: bytes, *, width: int, height: int) -> bytes:
    result = bytearray(jpeg)
    offset = 2
    while offset + 4 <= len(result):
        if result[offset] != 0xFF:
            raise RuntimeError(f"invalid marker at byte {offset}")
        marker = result[offset + 1]
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
            struct.pack_into(">H", result, offset + 5, height)
            struct.pack_into(">H", result, offset + 7, width)
            return bytes(result)
        if marker in {0xD8, 0xD9} or 0xD0 <= marker <= 0xD7:
            offset += 2
            continue
        length = struct.unpack_from(">H", result, offset + 2)[0]
        offset += 2 + length
    raise RuntimeError("JPEG has no SOF marker")


def find_scan_data_offset(jpeg: bytes) -> int:
    offset = 2
    while offset + 4 <= len(jpeg):
        if jpeg[offset] != 0xFF:
            raise RuntimeError(f"invalid marker at byte {offset}")
        marker = jpeg[offset + 1]
        if marker == 0xDA:
            length = struct.unpack_from(">H", jpeg, offset + 2)[0]
            return offset + 2 + length
        if marker in {0xD8, 0xD9} or 0xD0 <= marker <= 0xD7:
            offset += 2
            continue
        length = struct.unpack_from(">H", jpeg, offset + 2)[0]
        offset += 2 + length
    raise RuntimeError("JPEG has no SOS marker")


def make_png() -> bytes:
    signature = b"\x89PNG\r\n\x1a\n"

    def chunk(kind: bytes, data: bytes) -> bytes:
        checksum = zlib.crc32(kind + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", checksum)

    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)
    pixels = zlib.compress(b"\x00\xff\x00\xff\xff", level=9)
    return signature + chunk(b"IHDR", ihdr) + chunk(b"IDAT", pixels) + chunk(b"IEND", b"")


def remove_undeclared_files(declared: set[str]) -> None:
    retained = declared | {"README.md", "manifest.json"}
    for path in CORPUS_DIRECTORY.iterdir():
        if path.is_file() and path.name not in retained:
            path.unlink()


def require_tool(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise SystemExit(f"Required fixture-generation tool is not installed: {name}")
    return path


def run(*arguments: str) -> None:
    completed = subprocess.run(arguments, capture_output=True, text=True, check=False)
    warning_is_error = Path(arguments[0]).name == "exiftool" and "Warning:" in completed.stderr
    if completed.returncode != 0 or warning_is_error:
        raise RuntimeError(
            f"command failed ({completed.returncode}): {' '.join(arguments)}\n"
            f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}"
        )


def tool_version(executable: str, argument: str) -> str:
    completed = subprocess.run(
        (executable, argument), capture_output=True, text=True, check=True
    )
    output = completed.stdout.strip() or completed.stderr.strip()
    return output.splitlines()[0]


if __name__ == "__main__":
    main()
