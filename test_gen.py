import asyncio
from lectern.lectern_service import LecternGenerationService

async def main():
    service = LecternGenerationService()
    # Mocking check_connection to return True
    import lectern.lectern_service
    lectern.lectern_service.check_connection = lambda: True
    
    # We will just run it on a small sample PDF if available
    pass

