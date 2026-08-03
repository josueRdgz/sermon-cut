# PyInstaller spec for the self-contained FastAPI sidecar.

from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

ROOT = Path(SPECPATH)

datas = [
    (str(ROOT / "alembic.ini"), "."),
    (str(ROOT / "alembic"), "alembic"),
]
binaries = []
hiddenimports = []

# These packages are imported lazily by optional editor features. Collecting
# them here keeps the installed app equivalent to the configured local venv.
for package in (
    "av",
    "ctranslate2",
    "faster_whisper",
    "tokenizers",
    "cv2",
    "yt_dlp",
):
    package_datas, package_binaries, package_hiddenimports = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

datas += collect_data_files("google.genai")
hiddenimports += collect_submodules(
    "google.genai",
    filter=lambda name: ".tests" not in name and "._test_" not in name,
)

a = Analysis(
    ["desktop_entry.py"],
    pathex=[str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["pytest"],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="sermon-cut-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="sermon-cut-backend",
)
