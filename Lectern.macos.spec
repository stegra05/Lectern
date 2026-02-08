from PyInstaller.utils.hooks import collect_all

datas, binaries, hiddenimports = collect_all('pypdfium2')

import os
PROJECT_ROOT = os.path.abspath(os.getcwd())

a = Analysis(
    ['gui/launcher.py'],
    pathex=[PROJECT_ROOT, os.path.join(PROJECT_ROOT, 'gui', 'backend')],
    binaries=binaries,
    datas=[
        ('gui/frontend/dist', 'frontend/dist'),
        ('gui/backend', 'backend'),
        ('utils', 'utils'),
        ('ai_client.py', '.'),
        ('ai_common.py', '.'),
        ('ai_pacing.py', '.'),
        ('ai_prompts.py', '.'),
        ('ai_schemas.py', '.'),
        ('anki_connector.py', '.'),
        ('config.py', '.'),
        ('lectern_service.py', '.'),
        ('pdf_parser.py', '.'),
        ('version.py', '.'),
    ] + datas,
    hiddenimports=['webview', 'uvicorn', 'objc', 'Cocoa', 'WebKit', 'PIL', 'PIL.Image', 'pypdf',
                   'lectern_service', 'ai_client', 'ai_common', 'ai_pacing', 'ai_prompts', 'ai_schemas',
                   'anki_connector', 'config', 'pdf_parser', 'utils'] + hiddenimports,
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
