import re
import sys

with open("gui/backend/main.py", "r") as f:
    lines = f.readlines()

new_lines = []
skip = False
for line in lines:
    if "from service import GenerationService, DraftStore" in line:
        continue
    if "from session import (" in line:
        skip = True
        new_lines.append("from session import (\n")
        new_lines.append("    SessionManager,\n")
        new_lines.append("    SessionState,\n")
        new_lines.append("    LECTERN_TEMP_PREFIX,\n")
        new_lines.append("    session_manager,\n")
        new_lines.append("    _get_session_or_404,\n")
        new_lines.append(")\n")
        continue
    if skip:
        if line.strip() == ")":
            skip = False
        continue
    
    new_lines.append(line)

content = "".join(new_lines)

# /stop route
stop_re = r'@app\.post\("/stop"\).*?def stop_generation.*?return \{"status": "stopped", "session_id": session\.session_id\}'
def repl_stop(m):
    return """@app.post("/stop")
async def stop_generation(session_id: str | None = None):
    session = _get_session_or_404(session_id)
    session_manager.stop_session(session.session_id)
    return {"status": "stopped", "session_id": session.session_id}"""

content = re.sub(stop_re, repl_stop, content, flags=re.DOTALL)

# Remove /drafts routes
content = re.sub(r'# Draft API.*?@app\.post\("/drafts/sync"\).*?return StreamingResponse\(sync_generator\(\), media_type="application/x-ndjson"\)\n', '', content, flags=re.DOTALL)

# We need to rewrite /generate endpoint. Let's find its start and end.
generate_re = r'@app\.post\("/generate"\).*?def generate_cards.*?return StreamingResponse\(event_generator\(\), media_type="application/x-ndjson"\)'

generate_new = """@app.post("/generate")
async def generate_cards(
    pdf_file: UploadFile = File(...),
    deck_name: str = Form(...),
    model_name: str = Form(config.DEFAULT_GEMINI_MODEL),
    tags: str = Form("[]"),  # JSON string
    context_deck: str = Form(""),
    focus_prompt: str = Form(""),  # Optional user focus
    target_card_count: Optional[int] = Form(None),
):
    service = LecternGenerationService()
    
    if focus_prompt:
        logger.info(f"User focus: '{focus_prompt}'")
    
    try:
        tags_list = json.loads(tags)
    except:
        tags_list = []

    def save_generate_temp():
        with tempfile.NamedTemporaryFile(
            delete=False,
            prefix=LECTERN_TEMP_PREFIX,
            suffix=".pdf",
        ) as tmp:
            shutil.copyfileobj(pdf_file.file, tmp)
            return tmp.name
            
    tmp_path = await run_in_threadpool(save_generate_temp)
    
    try:
        uploaded_size = os.fstat(pdf_file.file.fileno()).st_size
    except:
        uploaded_size = -1
        
    temp_size = os.path.getsize(tmp_path)
    logger.info(f"Uploaded file size: {uploaded_size} bytes. Temp file size: {temp_size} bytes. Path: {tmp_path}")
        
    session = session_manager.create_session(pdf_path=tmp_path)

    history_mgr = HistoryManager()
    entry_id = history_mgr.add_entry(
        filename=pdf_file.filename,
        deck=deck_name,
        session_id=session.session_id,
        status="draft"
    )

    status_handlers = {
        "done": ("completed", True),
        "cancelled": ("cancelled", False),
        "error": ("error", False),
    }

    async def event_generator():
        import time
        import json
        import threading
        import queue
        session_logs = []
        def emit_event(evt_type: str, message: str, data: Any = None):
            evt = {"type": evt_type, "message": message, "timestamp": int(time.time() * 1000)}
            if data is not None:
                evt["data"] = data
            session_logs.append(evt)
            return json.dumps(evt) + "\\n"

        yield emit_event("session_start", "Session started", {"session_id": session.session_id})
        
        q = queue.Queue()
        final_cards = []
        final_slide_set_name = "Generation"
        final_total_pages = None
        final_coverage_data = None
        
        def worker():
            try:
                for event in service.run(
                    pdf_path=tmp_path,
                    deck_name=deck_name,
                    model_name=model_name,
                    tags=tags_list,
                    context_deck=context_deck,
                    focus_prompt=focus_prompt,
                    target_card_count=target_card_count,
                    skip_export=True,
                    stop_check=lambda: session_manager.get_session(session.session_id).stop_requested if session_manager.get_session(session.session_id) else True
                ):
                    q.put(event)
            except Exception as e:
                q.put(e)
            finally:
                q.put(None)
                
        t = threading.Thread(target=worker, daemon=True)
        t.start()
        
        while True:
            import asyncio
            # Non-blocking pull from queue to allow async event loop
            try:
                event = q.get_nowait()
            except queue.Empty:
                await asyncio.sleep(0.1)
                continue
                
            if event is None:
                break
                
            if isinstance(event, Exception):
                session_manager.mark_status(session.session_id, "error")
                yield emit_event("error", f"Generation failed: {str(event)}")
                history_mgr.update_session_logs(session.session_id, session_logs)
                break
                
            yield emit_event(event.type, event.message, event.data)
            
            try:
                event_type = event.type
                
                if event.data:
                    if "slide_set_name" in event.data:
                        final_slide_set_name = event.data["slide_set_name"]
                    if "total_pages" in event.data:
                        final_total_pages = event.data["total_pages"]
                    if "coverage_data" in event.data:
                        final_coverage_data = event.data["coverage_data"]
                    if "cards" in event.data:
                        final_cards = event.data["cards"]
                        
                if event_type in status_handlers:
                    status, cleanup = status_handlers[event_type]
                    session_manager.mark_status(session.session_id, status)
                    if cleanup:
                        session_manager.cleanup_temp_file(session.session_id)
                        
                    if event_type in ("done", "cancelled", "error"):
                        history_mgr.update_session_logs(session.session_id, session_logs)
                        
                    if event_type == "done" or event_type == "step_end" or event_type == "cards_replaced":
                        history_mgr.sync_session_state(
                            session_id=session.session_id,
                            cards=final_cards,
                            status="completed" if event_type == "done" else None,
                            deck_name=deck_name,
                            slide_set_name=final_slide_set_name,
                            model_name=model_name,
                            tags=tags_list,
                            total_pages=final_total_pages,
                            coverage_data=final_coverage_data,
                        )
            except Exception as e:
                logger.error(f"Error processing event: {e}")

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")"""

content = re.sub(generate_re, generate_new, content, flags=re.DOTALL)

with open("gui/backend/main.py", "w") as f:
    f.write(content)
