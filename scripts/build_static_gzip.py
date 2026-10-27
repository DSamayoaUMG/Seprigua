"""Precompress SEPRIGUA's public CSS and JavaScript without extra dependencies.

Run after changing a stylesheet or script. The server serves the original file
whenever a matching, current .gz file is unavailable.
"""

from pathlib import Path
import gzip
import os


ROOT = Path(__file__).resolve().parents[1]


def main():
    original_bytes = 0
    compressed_bytes = 0
    count = 0
    for folder, extension in (("css", ".css"), ("java", ".js")):
        for source in (ROOT / folder).rglob("*" + extension):
            if source.stat().st_size < 1024:
                continue
            data = source.read_bytes()
            target = source.with_name(source.name + ".gz")
            packed = gzip.compress(data, compresslevel=6, mtime=0)
            target.write_bytes(packed)
            source_time = source.stat().st_mtime
            os.utime(target, (source_time, source_time))
            original_bytes += len(data)
            compressed_bytes += len(packed)
            count += 1
    print(f"{count} archivos: {original_bytes} -> {compressed_bytes} bytes "
          f"({100 * (1 - compressed_bytes / original_bytes):.1f}% menos)")


if __name__ == "__main__":
    main()
