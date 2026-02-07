# Feature: Focus Prompt (Replaces Exam Mode)

## Summary
Replace the binary "Exam Mode" toggle with a flexible **Focus Prompt** system. Users can describe their learning goals in natural language, and optionally use a cheap model to enhance their prompt.

## Status: Refined

---

## Requirements

### User Input
- **Text Area:** Free-form input where users describe what they want to focus on
- **Examples to show as placeholder/tooltip:**
  - "Focus on topic X"
  - "Include chapter Y"
  - "Emphasize connecting concepts"
  - "Focus on definitions"
  - "Prepare me for exam"
  - "Topic Z always appears in exams, make sure it's covered"

### Prompt Improvement (Optional)
- **Button:** "Improve Prompt" (optional, user can skip)
- **Behavior:** Send user's input to a cheap/fast model (e.g., Gemini Flash) to:
  - Expand vague instructions into structured guidance
  - Add specificity (e.g., "focus on definitions" → "prioritize definition-style cards, use Cloze for key terms")
- **UX:** Show improved prompt in an editable preview before applying

### Integration with AI Pipeline
- The focus prompt becomes additional context in:
  1. `concept_map` prompt (influences which concepts are prioritized)
  2. `generation` prompt (guides card style selection)
  3. `reflection` prompt (filters for relevance to stated focus)

---

## Migration from Exam Mode

### What Exam Mode Currently Does
| Component | Current Behavior |
|-----------|-----------------|
| Temperature | Lowered to 0.4 (stricter) |
| Pacing | Capped at 0.9 cards/page |
| System Prompt | "HIGH YIELD ONLY", scenario/comparison focus |
| Examples | Exam-specific examples loaded |
| Reflection | "Ruthless tutor" filtering |

### Replacement Strategy
- **Remove:** `exam_mode` boolean from all layers
- **Replace with:** `focus_prompt: Optional[str]` 
- **Presets (Optional):** Offer quick-select buttons for common focuses:
  - "Exam Prep" (applies previous exam mode behavior via preset prompt)
  - "Definitions Only"
  - "Connections & Comparisons"
  - "Comprehensive Coverage"

---

## UI/UX Design

### Location
Replace the Exam Mode toggle in `ConfigView.tsx` with:

```
┌──────────────────────────────────────────────────┐
│  Focus (Optional)                                │
├──────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────┐  │
│  │ Tell me what to focus on...                │  │
│  │ e.g. "Focus on definitions for Chapter 3"  │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌─────────────┐                                 │
│  │ ✨ Improve  │  (optional)                     │
│  └─────────────┘                                 │
│                                                  │
│  Quick Presets: [Exam Prep] [Definitions] [All] │
└──────────────────────────────────────────────────┘
```

---

## Technical Notes

### Backend Changes
1. Replace `exam_mode: bool` with `focus_prompt: Optional[str]` in:
   - `generate_config` / API endpoint
   - `lectern_service.py`
   - `ai_client.py`
   - `PromptConfig` dataclass
   - `PromptBuilder` methods

2. Add new endpoint for prompt improvement:
   - `POST /improve-prompt` → returns enhanced prompt string

3. Inject focus prompt into prompts:
   ```python
   if focus_prompt:
       focus_context = f"USER FOCUS: {focus_prompt}\n"
   ```

### Prompt Improvement Logic
Use a simple prompt like:
```
You are an expert prompt engineer for a flashcard generation system.
The user wants to focus their learning on: "{user_input}"
Rewrite this as a clear, actionable instruction for an AI generating Anki cards.
Be specific about card types (definition, comparison, application) and priorities.
Keep it to 2-3 sentences.
```

---

## Open Questions

1. Should presets be hardcoded or configurable?  
   *Recommendation: Start with 3-4 hardcoded presets*

2. Should we keep temperature adjustment based on focus?  
   *Recommendation: Yes, "Exam Prep" preset could still lower temperature*

3. Store focus prompt in history for session resume?
