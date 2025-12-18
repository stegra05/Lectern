import time
import os
import json
import config
from google import genai
from google.genai import types

def verify_migration():
    print("--- Starting Migration Verification ---")
    
    # 1. Config Validation
    expected_model = "gemini-3-flash-preview"
    current_model = config.DEFAULT_GEMINI_MODEL
    print(f"Checking Configured Model: {current_model}")
    
    if current_model != expected_model:
        print(f"WARNING: Configured model '{current_model}' does not match expected '{expected_model}'.")
        print("Please check config.py or environment variables.")
        # Proceeding anyway to test what IS configured
    else:
        print("SUCCESS: Model configuration matches target.")

    # 2. Client Initialization
    api_key = config.GEMINI_API_KEY
    if not api_key:
        print("CRITICAL: GEMINI_API_KEY not found.")
        return

    client = genai.Client(api_key=api_key, http_options={'api_version': 'v1alpha'})
    
    # 3. Benchmark & Func Test
    prompts = [
        ("Short Fact", "What is the capital of France? Return JSON: {'answer': '...'}"),
        ("Reasoning", "Explain why the sky is blue. Return JSON: {'explanation': '...'}"),
    ]
    
    print(f"\nModel: {current_model}")
    print(f"Thinking Level: {config.GEMINI_THINKING_LEVEL}")
    
    generation_config = types.GenerateContentConfig(
        response_mime_type="application/json",
        temperature=0.2,
        max_output_tokens=1024,
        thinking_config=types.ThinkingConfig(thinking_level=config.GEMINI_THINKING_LEVEL.lower()),
    )

    results = []

    for label, prompt_text in prompts:
        print(f"\nRunning test: {label}...")
        start_t = time.time()
        try:
            response = client.models.generate_content(
                model=current_model,
                contents=prompt_text,
                config=generation_config
            )
            end_t = time.time()
            duration = end_t - start_t
            
            output_text = response.text
            # validate JSON
            try:
                json_data = json.loads(output_text)
                valid_json = True
            except:
                valid_json = False
                
            print(f"  Duration: {duration:.4f}s")
            print(f"  Valid JSON: {valid_json}")
            print(f"  Output Preview: {output_text[:100]}...")
            
            results.append({
                "test": label,
                "duration": duration,
                "valid_json": valid_json
            })
            
        except Exception as e:
            print(f"  FAILED: {e}")
            results.append({
                "test": label,
                "error": str(e)
            })

    # 4. Summary
    print("\n--- Benchmark Summary ---")
    avg_duration = sum(r['duration'] for r in results if 'duration' in r) / len(results) if results else 0
    print(f"Average Latency: {avg_duration:.4f}s")
    
    all_json_valid = all(r.get('valid_json', False) for r in results)
    if all_json_valid:
        print("SUCCESS: All outputs were valid JSON.")
    else:
        print("FAILURE: Some outputs were invalid JSON.")

if __name__ == "__main__":
    verify_migration()
