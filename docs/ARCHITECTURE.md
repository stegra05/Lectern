# System Architecture

Lectern is designed as a modular pipeline that transforms unstructured lecture slides into structured knowledge objects (Anki cards).

## System Context

```mermaid
graph TB
    subgraph External["External Systems"]
        Anki["Anki Desktop<br/>(AnkiConnect API)"]
        Gemini["Google Gemini<br/>(Multimodal AI)"]
    end
    
    subgraph Lectern["Lectern Application"]
        App["Desktop App<br/>(PyWebView)"]
    end
    
    User["User"] -->|"PDF + Settings"| App
    App -->|"Flashcards"| Anki
    App -->|"Content + Prompts"| Gemini
    Gemini -->|"Generated Cards"| App
    Anki -->|"Deck List"| App
```

## Container Architecture

```mermaid
graph TB
    subgraph Desktop["Desktop Application"]
        PyWebView["PyWebView<br/>Native Window"]
        
        subgraph Backend["Python Backend"]
            FastAPI["FastAPI<br/>REST + SSE"]
            Service["Lectern Service<br/>Orchestrator"]
            AIClient["AI Client<br/>Gemini SDK"]
            PDFParser["PDF Parser<br/>PyMuPDF"]
            AnkiConn["Anki Connector<br/>REST Client"]
        end
        
        subgraph Frontend["React Frontend"]
            React["React App<br/>TypeScript + Vite"]
        end
    end
    
    PyWebView --> React
    React -->|"HTTP/SSE"| FastAPI
    FastAPI --> Service
    Service --> AIClient
    Service --> PDFParser
    Service --> AnkiConn
    
    AIClient -->|"API Calls"| Gemini["Gemini API"]
    AnkiConn -->|"REST"| Anki["AnkiConnect"]
```

## Data Flow Pipeline

```mermaid
graph LR
    subgraph Input
        PDF["PDF File"]
    end
    
    subgraph Phase1["Phase 1: Ingestion"]
        Parse["Parse PDF"]
        Extract["Extract Text<br/>+ Images"]
    end
    
    subgraph Phase2["Phase 2: AI Processing"]
        Init["Initialize<br/>Session"]
        Map["Build Concept<br/>Map"]
        Gen["Generate<br/>Cards"]
        Reflect["Reflection<br/>(QA)"]
    end
    
    subgraph Phase3["Phase 3: Export"]
        Preview["Live Preview<br/>+ Edit"]
        Sync["Sync to<br/>Anki"]
    end
    
    PDF --> Parse --> Extract --> Init --> Map --> Gen --> Reflect --> Preview --> Sync
```

## Generation Session Flow

```mermaid
sequenceDiagram
    participant U as User
    participant S as Service
    participant A as AI Client
    participant G as Gemini API

    U->>S: Upload PDF + Settings
    S->>S: Parse PDF (text + images)
    
    Note over S,G: Session Initialization
    S->>A: Start Session
    A->>G: System Prompt + Full PDF Content
    G-->>A: Session Ready
    
    Note over S,G: Concept Mapping
    S->>A: Request Concept Map
    A->>G: "Analyze slides, build concept graph"
    G-->>S: Concepts + Relations
    
    Note over S,G: Card Generation Loop
    loop Until Complete
        S->>S: Calculate Pacing
        S->>A: Generate Batch
        A->>G: Prompt + Pacing Hint + Avoid List
        G-->>S: JSON Cards
        S-->>U: Progress Update (SSE)
    end
    
    Note over S,G: Quality Control
    opt Reflection Enabled
        S->>A: Critique Cards
        A->>G: "Review for quality issues"
        G-->>S: Improvements
    end
    
    S-->>U: Cards Ready for Review
    U->>S: Approve + Sync
    S->>S: Send to AnkiConnect
```

## Core Components

### PDF Parser (`pdf_parser.py`)

Extracts content from lecture slides for multimodal prompting.

| Responsibility | Implementation |
| :--- | :--- |
| Text extraction | PyMuPDF page-by-page parsing |
| Image extraction | Convert to base64 for AI prompts |
| Page tracking | Preserve slide numbers for citation |

### AI Client (`ai_client.py`)

Interfaces with Google Gemini for intelligent card generation.

| Responsibility | Implementation |
| :--- | :--- |
| Multimodal prompting | Send text + images together |
| Prompt management | Centralized in `ai_prompts.py` |
| Concept mapping | First pass builds knowledge graph |
| Iterative generation | Batch cards with history tracking |
| Rate limiting | Coordinated by `ai_pacing.py` |
| Self-correction | Reflection step for quality |

### Service Layer (`lectern_service.py`)

Central orchestrator managing the generation pipeline.

| Responsibility | Implementation |
| :--- | :--- |
| State management | Track generation progress |
| Event emission | SSE for real-time UI updates |
| Resume support | Persist state for recovery |
| Pacing strategy | Adjust density based on content |

### GUI (`gui/`)

Desktop application with modern React frontend.

| Layer | Technology |
| :--- | :--- |
| Window | PyWebView (Cocoa/WebKit) |
| API | FastAPI + Uvicorn |
| Frontend | React + TypeScript + Vite |
| Styling | Tailwind CSS + Framer Motion |

## Data Models

### Anki Card

Abstract representation decoupled from Anki's internal format:

```json
{
  "model_name": "Basic",
  "fields": {
    "Front": "What is gradient descent?",
    "Back": "An optimization algorithm that iteratively adjusts parameters..."
  },
  "tags": ["lecture-1", "machine-learning"]
}
```

### Concept Map

Global context object guiding coherent generation:

```json
{
  "concepts": [
    {"id": "c1", "name": "Gradient Descent", "definition": "..."}
  ],
  "relations": [
    {"source": "c1", "target": "c2", "type": "optimizes"}
  ]
}
```

## Pacing Strategy

Lectern adapts its behavior based on content density:

| Content Type | Detection | Strategy |
| :--- | :--- | :--- |
| **Script** | > 3000 chars/page | Throttle based on text volume |
| **Normal** | 1000-3000 chars/page | Balanced approach |
| **Slides** | < 1000 chars/page | Page-count based |

## Security

| Concern | Approach |
| :--- | :--- |
| Anki data | Never write to SQLite directly; use AnkiConnect API only |
| API keys | Stored in system Keychain via `keyring`, never in config files |

## Logging

AI session logs for debugging and traceability:

- **Path:** `~/Library/Application Support/Lectern/logs/session-*.json`
- **Lifecycle:** Created at session start; appended after each phase
- **Use cases:** Debug generation quality issues, inspect prompts/responses
