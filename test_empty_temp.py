from fastapi import UploadFile
import io
import shutil
import tempfile
import os

f = UploadFile(file=io.BytesIO(b"Hello world"), filename="test.txt")

# Read it to simulate cost estimation
f.file.read()

# Now try to save it to a temp file
with tempfile.NamedTemporaryFile(delete=False) as tmp:
    shutil.copyfileobj(f.file, tmp)
    name = tmp.name

print(f"Size after reading: {os.path.getsize(name)}")

# Now reset the pointer and try again
f.file.seek(0)
with tempfile.NamedTemporaryFile(delete=False) as tmp2:
    shutil.copyfileobj(f.file, tmp2)
    name2 = tmp2.name

print(f"Size after seeking: {os.path.getsize(name2)}")
import os; os.remove(name); os.remove(name2)
