# -*- mode: python ; coding: utf-8 -*-

a = Analysis(
    ['gui/launcher.py'],
    pathex=[],
    binaries=[],
    datas=[('gui/frontend/dist', 'frontend/dist'), ('gui/backend', 'backend')],
    hiddenimports=['webview', 'uvicorn', 'objc', 'Cocoa', 'WebKit', 'PIL', 'PIL.Image', 'pdf2image', 'pypdf'],
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
    strip=True, 
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['icon.icns'],
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
app = BUNDLE(
    coll,
    name='Lectern.app',
    icon='icon.icns',
    bundle_identifier='com.stefra.lectern',
)
