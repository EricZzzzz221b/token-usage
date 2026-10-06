#!/usr/bin/env python3
"""Match Tauri's portable tar.gz layout (one .app root, no AppleDouble entries).

Do not change the source app or its security attributes. Apple code signatures and
stapled tickets must survive extraction and are verified separately before signing.
"""
import pathlib
import sys
import tarfile

app = pathlib.Path(sys.argv[1]).resolve(strict=True)
archive = pathlib.Path(sys.argv[2])
if app.suffix != ".app" or not app.is_dir():
    raise SystemExit("A finalized .app bundle is required")
# Exclusive output: never replace a prepared or released artifact.
with archive.open("xb") as output:
    with tarfile.open(fileobj=output, mode="w:gz", format=tarfile.PAX_FORMAT, dereference=False) as bundle:
        bundle.add(app, arcname=app.name, recursive=True)
