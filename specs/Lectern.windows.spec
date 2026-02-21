from PyInstaller.utils.hooks import collect_all

datas: list = []
binaries: list = []
hiddenimports: list = []

import os
PROJECT_ROOT = os.path.abspath(os.getcwd())

a = Analysis(
    [os.path.join(PROJECT_ROOT, 'gui', 'launcher.py')],
    pathex=[PROJECT_ROOT, os.path.join(PROJECT_ROOT, 'gui', 'backend')],
    binaries=binaries,
    datas=[
        (os.path.join(PROJECT_ROOT, 'gui', 'frontend', 'dist'), 'frontend/dist'),
        (os.path.join(PROJECT_ROOT, 'gui', 'backend'), 'backend'),
        (os.path.join(PROJECT_ROOT, 'lectern'), 'lectern'),
    ] + datas,
    hiddenimports=[
        'webview', 'uvicorn', 'PIL', 'PIL.Image',
        # NOTE(Windows): pywebview loads platform backends dynamically; PyInstaller
        # won't find them via static analysis. Include both so the edgechromium
        # path is bundled and the winforms fallback doesn't silently fail.
        'webview.platforms.edgechromium', 'webview.platforms.winforms',
        'clr', 'pythonnet',
        # NOTE(keyring): keyring uses win32ctypes to access Windows Credential Manager.
        # Without these hidden imports it falls back to plaintext storage.
        'win32ctypes', 'win32ctypes.core', 'win32ctypes.core._common',
        'win32ctypes.core.ctypes', 'win32ctypes.core.ctypes._util',
        'keyrings.alt',
        'lectern', 'lectern.lectern_service', 'lectern.config',
    ] + hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'pytest', 'unittest', '_pytest', 'pip', 'wheel', 'setuptools', 'pkg_resources',
        'tkinter', 'test', 'xmlrpc', 'pydoc', 'doctest',
        'matplotlib', 'numpy', 'scipy', 'pandas',
        'PIL.AvifImagePlugin', 'PIL.TiffImagePlugin', 'PIL.Jpeg2KImagePlugin', 'PIL.WebPImagePlugin',
        'fitz', 'pymupdf', 'PyMuPDF',
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Lectern',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,  # strip is a Unix ELF flag — must be False on Windows
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=[os.path.join(PROJECT_ROOT, 'resources', 'icon.ico')],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False, 
    upx=True,
    upx_exclude=[],
    name='Lectern',
)
