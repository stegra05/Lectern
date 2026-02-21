# Product Requirement Report: Lectern
**Subject:** Automated Semantic Study-Flow (PDF to Anki)  
**Author:** Steffen (Information Systems Student)  
**Date:** February 10, 2026

---

## 1. Executive Summary
Lectern is required to eliminate the "Manual Labor Gap" in the active recall loop. Current tools focus on OCR; Lectern must focus on **synthesis**. It should transform static slides into atomic knowledge without sacrificing the student’s agency or the integrity of their existing Anki collection.

---

## 2. User Personas
*   **The Power Student (Steffen):** Needs to process 200+ slides per week. Values dark mode, keyboard shortcuts, and "vibe-consistent" UI.
*   **The STEM Scholar:** Deals with complex diagrams, mathematical notation, and visual relationships that standard OCR fails to capture.

---

## 3. Comprehensive User Stories

### Category A: Ingestion & Semantic Analysis
*   **Visual Context Awareness:** *As a student,* I want Lectern to analyze the spatial relationship between text and diagrams on a slide, *so that* my cards include context that would be lost in a pure text extraction.
*   **The Concept Map:** *As a learner,* I want the AI to generate a high-level concept map of the lecture before creating cards, *so that* I can verify the "big picture" logic before diving into the details.
*   **Processing Profiles:** *As a user,* I want to toggle between "Visual-Heavy" (Diagram focus) and "Script-Dense" (Text focus) modes, *so that* I can optimize Gemini’s token usage and attention for different lecture styles.

### Category B: The Human-in-the-Loop Dashboard
*   **Live Audit:** *As a perfectionist,* I want a side-by-side view of the original slide and the generated cards, *so that* I can instantly verify the accuracy of the AI's synthesis.
*   **Batch Editing:** *As a student,* I want to perform bulk edits (tagging, deck assignment, or prefixing) on generated cards before they are finalized, *so that* my collection remains organized.
*   **Atomic Refinement:** *As a user,* I want the system to flag "wordy" cards that violate the Principle of Minimum Information, *so that* my Anki practice remains efficient.

### Category C: Safety & Integration
*   **The "Safe Zone" Export:** *As a cautious user,* I want Lectern to export a `.apkg` file or use a staging area *instead of* direct database writes, *so that* I never risk corrupting my primary Anki collection.
*   **Deduplication Check:** *As a long-term learner,* I want the system to notify me if a generated card closely matches an existing card in my deck, *so that* I avoid redundant reviews.

---

## 4. Aesthetic & Non-Functional Desires

### Design Vibe
*   **Interface:** Dark mode by default. Minimalist, utilizing Material Design principles. No "Bootstrap Blue"—prefer a custom, atmospheric palette (e.g., deep charcoal and muted violet).
*   **Performance:** Processing should be asynchronous. I want to see a progress bar for the "Semantic Construction" phase so the wait feels productive.

### Security
*   **Privacy:** Since this uses Gemini, I want a clear indicator of what data is being sent to the API and an option to "scrub" personal identifiers from the PDF before processing.

---

## 5. Success Criteria (The "Simplification Loop")
1.  **Reduction of Friction:** A 50-slide deck should result in a reviewed, high-quality Anki deck in under 15 minutes of human interaction.
2.  **Card Quality:** 90% of generated cards should require zero or only minor text edits.
3.  **Visual Fidelity:** Diagrams should be automatically cropped and attached to relevant cards as "Extra" context.
