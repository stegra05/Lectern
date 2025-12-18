import time
import os
import config
from google import genai
from google.genai import types

def test_inference():
    api_key = os.getenv("GEMINI_API_KEY") or config.GEMINI_API_KEY
    model_name = "gemini-3-flash-preview"
    thinking_level = "low" 

    print(f"Testing model: {model_name}")
    print(f"Thinking level: {thinking_level}")

    if not api_key:
        print("Error: GEMINI_API_KEY not found.")
        return

    client = genai.Client(api_key=api_key, http_options={'api_version': 'v1alpha'})
    
    # Try GenerateContent with ThinkingConfig
    print("\n--- Testing client.models.generate_content ---")
    try:
        config_params = types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.2,
            max_output_tokens=1024,
            thinking_config=types.ThinkingConfig(thinking_level=thinking_level),
        )

        prompt = "List 3 benefits of spaced repetition. Return as JSON: {\"benefits\": []}"
        
        print("Sending request (timeout 30s)...")
        start_time = time.time()
        response = client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=config_params
        )
        end_time = time.time()
        
        print(f"Response received in {end_time - start_time:.2f} seconds.")
        print("Response text:")
        print(response.text)
    except Exception as e:
        print(f"Error in generate_content: {e}")

    # Try Interactions API
    print("\n--- Testing client.interactions.create (Interactions API) ---")
    try:
        start_time = time.time()
        interaction = client.interactions.create(
            model=model_name,
            input="List 3 benefits of active recall. Return as JSON: {\"benefits\": []}",
            config=types.GenerateContentConfig(
                thinking_config=types.ThinkingConfig(thinking_level=thinking_level),
            )
        )
        end_time = time.time()
        print(f"Interaction response received in {end_time - start_time:.2f} seconds.")
        if interaction.outputs:
            print("Interaction output:")
            print(interaction.outputs[-1].text)
        else:
            print("No outputs in interaction.")
    except Exception as e:
        print(f"Error in interactions.create: {e}")

if __name__ == "__main__":
    test_inference()