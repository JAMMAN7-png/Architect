# 🏛️ The Architect — Complete Build Guide

*A Human-in-the-Loop System for Transforming Sparks into Production-Ready Blueprints*

---

## 🎯 Executive Evaluation

Your updated vision is **significantly stronger** than the original. By renaming Shima → **Architect** and scoping it to **"a product that generates docs/blueprints/code for every system and application"**, you've solved the #1 problem with the original spec: *unclear identity*. 

The Architect is now a **meta-tool** — a product that builds products. This is a defensible, unique position (not a generic AI wrapper) because:

1. **The flow itself is the moat** — Spark → Brainstorm/Checkup → Sketch → Research → Questionnaire → Deep Research → Docs → Blueprint. No competitor has this exact human-in-the-loop (HITL) ladder.

2. **The "TeleFocus" design system + CLI duality** is a unique distribution channel (most competitors are web-only).

3. **The philosophy is inverted correctly** — you're not trying to replace the human spark; you're trying to *armor it* so a cheap model can build it.

Let's now build the **Essence of the Blueprint** together.

---

## 🧬 Part 1: The Essence of the Architect Blueprint

&gt; This is the *`00_spark.md`** — the immutable human-authored identity. Everything downstream must obey it.

&lt;details open&gt;

&lt;summary&gt;&lt;strong&gt;📜 The Essential Identity (Locked)&lt;/strong&gt;&lt;/summary&gt;

### What the Architect Is

A **human-in-the-loop Blueprint Generator** that transforms a raw human Spark into a fully-researched, airtight, step-by-step build plan that a cheap/fast LLM can execute without supervision.

### What It Is Not

- Not an autonomous agent that builds apps end-to-end without the human.

- Not a code generator (that's a downstream consumer of its output).

- Not a chatbot (it's a *guided pipeline* with conversational touchpoints).

### The Core Loop (Sacred)

$$\text{Spark} \rightarrow \text{Grow/Check} \rightarrow \text{Sketch} \rightarrow \text{Research Targets} \rightarrow \text{HITL Questionnaire} \rightarrow \text{Deep Research} \rightarrow \text{HITL Questionnaire} \rightarrow \text{/docs Population} \rightarrow \text{Blueprint Assembly}$$

### Non-Negotiables

- **Dual Interface:** Beautiful AI-native CLI + Telegram bot (using `TeleFocus` design system).

- **Real-time feedback:** Every long operation streams progress (CLI spinners, Telegram "typing..." + progress messages).

- **Human controls the gates:** The user decides whether to brainstorm, check-up, or skip. The user picks the stack or delegates to research.

- **Research is mandatory before Blueprint writing.** No Blueprint section may exist without a backing `/docs` research file.

- **The final Blueprint is so detailed that a cheap model `DeepSeek-V4-Flash`, `Qwen-Coder-Turbo`) can execute it like a YouTube tutorial.**

### The "[Stake.com](http://Stake.com)" Uniqueness Factor

The Architect has **personality**: concise, confident, slightly opinionated, never sycophantic. The CLI and Telegram outputs feel hand-crafted, not AI-slop. Loading animations, phrasing, and error messages all follow `TeleFocus` design tokens.

&lt;/details&gt;

---

## 🗺️ Part 2: Phase Breakdown (End-to-End)

Each phase has: **Trigger → Agent(s) → HITL Gate → Output → Next Phase**.

### **Phase 0 — Session Bootstrap**

- **Trigger:** User runs `architect new` (CLI) or `/new` (Telegram).

- **Action:** Create session folder `sessions/<session-id>/`, initialize `/docs` and `/blueprint` scaffolding, greet the user via `TeleFocus`.

- **Output:** Empty session workspace ready to receive the Spark.

### **Phase 1 — Spark Capture**

- **Trigger:** User types or pastes their raw idea.

- **Agent:** *Spark Intake Agent* (fast model, minimal processing — just structuring).

- **HITL Gate:** "Is this your complete spark? [Yes / Add more / Attach files]"

- **Output:** `sessions/<id>/docs/00_spark.md` — **immutable** after confirmation.

### **Phase 2 — Spark Mode Selection (HITL)**

The user chooses one of three paths:

| Mode | What Happens | Agent | Model Tier |

|---|---|---|---|

| 🌱 **Brainstorm &amp; Grow** | Expand the spark, fill gaps, add mature depth | Brainstorm Agent (uses `obra/superpowers/brainstorming` skill) | High-Intelligence |

| 🔍 **Checkup Only** | Find gaps/flaws, suggest fixes, do NOT grow | Checkup Agent | High-Intelligence |

| ⏭️ **Skip** | Move directly to sketch with the raw spark | — | — |

- **Output:** `sessions/<id>/docs/01_spark_matured.md` (or unchanged if skipped).

### **Phase 3 — Blueprint Sketch**

- **Agent:** *Sketch Architect* (high-intelligence).

- **Action:** Produces a **low-resolution Blueprint skeleton** — section titles, doc placeholders, rough roadmap steps. No deep content yet.

- **Output:** `sessions/<id>/blueprint/_sketch.md` + placeholder files in `/docs/`.

### **Phase 4 — Research Target Extraction**

- **Agent:** *Research Target Extractor* (high-intelligence).

- **Action:** Reads the sketch and lists every APIs/library/framework/project/pattern that needs research. Checks user-specified stack preferences; only researches unspecified items.

- **Output:** `sessions/<id>/research/_targets.json`.

### **Phase 5 — First HITL Questionnaire (Stack &amp; Scope)**

- **Agent:** *Questionnaire Builder* (fast model).

- **Action:** For each research target, generates multiple-choice + free-text questions. Examples:

  - "For Telegram multi-account management, prefer: [Telethon / Pyrogram / TDLib / Let Architect decide]"

  - "Free-text: any strong preferences we should research?"

- **HITL Gate:** User answers. Free-text answers trigger **deeper research loops**. Loop continues until all answers are resolved.

- **Output:** `sessions/<id>/research/_user_prefs.json`.

### **Phase 6 — Deep Research**

- **Agent:** *Research &amp; Filter Agent* (fast model + web-fetch tool, filters ≥85% noise).

- **Action:** For every approved target, fetches official docs, GitHub READMEs, recent changelogs, best-practice articles. Looks for **existing open-source projects** that could be partially reused.

- **Output:** Per-target findings in `sessions/<id>/research/<target>.md` — implementation-focused, concise, ≤500 tokens each unless the target is "huge-role" critical.

### **Phase 7 — Second HITL Questionnaire (Approach &amp; Capabilities)**

- **Agent:** *Approach Clarifier* (high-intelligence for question-crafting, fast model for formatting).

- **Action:** Now that research is done, re-questions the user on *how* to apply findings (e.g., "We found 3 viable auth patterns — which matches your usage?").

- **HITL Gate:** Same loop as Phase 5 — free-text answers trigger re-research.

- **Output:** `sessions/<id>/research/_approach_decisions.json`.

### **Phase 8 — `/docs` Population**

- **Agent:** *Docs Writer Agent* (fast model, parallel).

- **Action:** For every section/capability/library in the final scope, writes a comprehensive but lean `/docs/<topic>.md` containing: purpose, current best practices, code patterns, gotchas, version info, official doc links. **No tutorials. No filler.**

- **Output:** Fully-populated `sessions/<id>/docs/` tree.

### **Phase 9 — Blueprint Assembly**

- **Agent:** *Blueprint Architect* (high-intelligence — the crown jewel).

- **Action:** Synthesizes everything into the final step-by-step roadmap at `sessions/<id>/blueprint/`. Each roadmap step:

  - Has its own folder if complex.

  - References `/docs/*.md` files by path.

  - Is granular enough that a cheap coder model can execute it.

- **Output:** `sessions/<id>/blueprint/FINAL.md` + per-step folders.

### **Phase 10 — Freeze &amp; Handoff**

- **Action:** Lock the Blueprint. Export options: zip, git repo init, direct handoff to downstream coder agents.

- **Output:** Production-ready Blueprint package.

---

## 🧠 Part 3: Intelligence Requirements

| Tier | Models | Used In Phases | % Workload |

|---|---|---|---|

| 🧠 **Strategic** | `Claude-Opus-4.7`, `GPT-5.5` | 2 (Brainstorm/Checkup), 3 (Sketch), 4 (Target Extract), 7 (Approach), 9 (Assembly) | ~15% |

| 🔍 **Ensemble Review** | `Kimi K2.5` + `DeepSeek-V4-Pro` | Final Blueprint QA before freeze | ~5% |

| ⚡ **Execution** | `DeepSeek-V4-Flash`, `Minimax M2.7`, `Qwen-Coder-Turbo` | 1 (Intake), 5 (Questionnaire), 6 (Research filtering), 8 (Docs writing) | ~80% |

**Rule:** Strategic models make *decisions*. Execution models *transcribe and expand* those decisions.

---

## 🤖 Part 4: The Exact Map of AI Agents

### 🏗️ **1. Blueprint Architect** *(Strategic)*

- **Model:** `Claude-Opus-4.7` primary, `GPT-5.5` cross-check

- **Role:** Transforms the matured spark + research into the final, airtight Blueprint.

- **Input:** `00_spark.md`, `01_spark_matured.md`, all `/docs/*.md`, all `/research/*.md`

- **Output:** `/blueprint/FINAL.md` + per-step folders

- **Prohibition:** Cannot invent features not in the spark. Cannot skip referencing `/docs`.

### 🌱 **2. Brainstorm Agent** *(Strategic, Optional)*

- **Model:** `Claude-Opus-4.7`

- **Skill:** `obra/superpowers/brainstorming`

- **Role:** Grows the spark — fills gaps, adds depth, surfaces implicit requirements.

- **Output:** `01_spark_matured.md`

- **Guard:** Preserves the Essential Identity verbatim; only grows *around* it.

### 🔍 **3. Checkup Agent** *(Strategic, Optional)*

- **Model:** `GPT-5.5` or `Claude-Opus-4.7`

- **Role:** Identifies gaps/flaws WITHOUT expanding scope. Presents fixes to the user for approval.

- **Output:** `01_spark_checkup.md` + user-applied patches

### 🎨 **4. Sketch Architect** *(Strategic)*

- **Model:** `Claude-Opus-4.7`

- **Role:** Low-res Blueprint skeleton + doc placeholder list.

- **Output:** `/blueprint/_sketch.md`

### 🔎 **5. Research Target Extractor** *(Strategic)*

- **Model:** `GPT-5.5`

- **Role:** Parses sketch → list of all tech/libraries/APIs needing research. Honors user stack preferences.

- **Output:** `/research/_targets.json`

### ❓ **6. Questionnaire Builder** *(Execution)*

- **Model:** `DeepSeek-V4-Flash`

- **Role:** Builds MCQ + free-text questions per research target; formats for CLI &amp; Telegram.

- **Output:** Interactive question flows.

### 🌐 **7. Research &amp; Filter Agent** *(Execution + Tools)*

- **Model:** `DeepSeek-V4-Flash` + web-fetch, GitHub API, package-registry tools

- **Role:** Fetches + filters ≥85% of noise. Surfaces existing OSS projects that match capabilities (critical for the "don't reinvent the wheel" rule).

- **Output:** `/research/<target>.md` (≤500 tokens unless critical)

- **Filter test:** *"Does this directly affect what we build or what we avoid?"* If no → discard.

### 🎯 **8. Approach Clarifier** *(Strategic)*

- **Model:** `Claude-Opus-4.7` (question-crafting) + `DeepSeek-V4-Flash` (formatting)

- **Role:** Phase 7 second questionnaire — maps research findings to user decisions.

- **Output:** `/research/_approach_decisions.json`

### 📝 **9. Docs Writer Agent** *(Execution, Swarm)*

- **Model:** `DeepSeek-V4-Flash` (parallel, one per doc)

- **Role:** Writes every `/docs/<topic>.md` — lean, implementation-focused, no tutorials.

- **Constraint:** Max 1 doc per topic. No `notes.md`, `misc.md`, `thoughts.md` allowed.

### 🛡️ **10. QA Reviewer (Ensemble)** *(Review)*

- **Model:** `Kimi K2.5` + `DeepSeek-V4-Pro` voting ensemble

- **Role:** Reviews final Blueprint + `/docs` for:

  - Gaps vs. Essential Identity

  - Missing doc references in Blueprint steps

  - Redundancy / bloat

  - Ambiguity a cheap coder model could stumble on

- **Output:** `/qa/blueprint_review.md`. Disagreement → escalate to Opus.

### 🎛️ **11. Interface Liaison (CLI + Telegram)** *(Execution)*

- **Model:** `DeepSeek-V4-Flash`

- **Role:** Renders every agent output through the `TeleFocus` design system. Handles real-time loading, streaming, step-by-step progress. Applies dual-rendering (CLI uses libraries like `InkTextualCharm`; Telegram uses `TeleFocus` components from `/docs/design-system`).

- **Constraint:** No agent may print directly to user — all goes through the Liaison.

### 🎼 **12. Orchestrator** *(Execution, Stateful)*

- **Model:** Rule-based + `DeepSeek-V4-Flash` for ambiguity resolution

- **Role:** The conductor. Manages phase transitions, session state, HITL gates, retries, and agent dispatch.

- **Output:** Session state machine.

---

## 📂 Part 5: Folder Structure (Enforced)

```

sessions/&lt;session-id&gt;/

├── docs/

│   ├── 00_[spark.md](http://spark.md)              # IMMUTABLE human source

│   ├── 01_spark_[matured.md](http://matured.md)      # After brainstorm/checkup

│   ├── design-system/           # TeleFocus reference (symlinked)

│   └── &lt;topic&gt;.md               # One per research target

├── research/

│   ├── _targets.json

│   ├── *user*prefs.json

│   ├── *approach*decisions.json

│   └── &lt;target&gt;.md              # Filtered findings

├── blueprint/

│   ├── _[sketch.md](http://sketch.md)               # Phase 3 low-res

│   ├── [FINAL.md](http://FINAL.md)                 # The deliverable

│   └── step-&lt;n&gt;/                # Per-step folders when complex

├── qa/

│   └── blueprint_[review.md](http://review.md)

└── _session.json                # State machine snapshot

```

**Rules:**

- No `.md` files outside these folders (pre-commit hook enforces this).

- No docs inside source code directories — ever.

- Every Blueprint step must reference at least one `/docs/*.md`.

---

## 🎨 Part 6: The Interactive Flow (CLI + Telegram)

### CLI Stack Recommendation

- **Python:** `Textual` (rich TUI) + `Rich` (styling) + `Questionary` (prompts)

- **Node.js:** `Ink` (React for CLI) + `@inkjs/ui` + `Clack` (beautiful prompts)

- **Go:** `Charm Bracelet` `Bubble Tea` + `Lip Gloss` + `Huh`) — *recommended for AI-native feel*

### Telegram Stack

- `Telethon` or `aiogram 3.x` for Python

- Render using **TeleFocus** components from `/docs/design-system/`

- Use Telegram's `sendChatAction`, progress-message editing, inline keyboards for HITL gates

### Example Flow Snippet (Phase 2 HITL Gate)

```

┌─ The Architect ─────────────────────────────────────┐

│ ✨ Spark captured: "A multi-account Telegram         │

│    intelligence system with AI-driven sorting..."   │

│                                                     │

│ How should we handle your spark?                    │

│   ▸ 🌱 Brainstorm &amp; Grow   (recommended)            │

│     🔍 Checkup Only                                 │

│     ⏭️  Skip &amp; Go to Sketch                         │

│                                                     │

│ [↑/↓] Navigate  [Enter] Select  [?] Explain         │

└─────────────────────────────────────────────────────┘

```

---

## 🔒 Part 7: Enforcement Guardrails

| Guardrail | Mechanism |

|---|---|

| Spark immutability | `00_spark.md` is write-once; needs human signature to change |

| Doc location | Pre-commit hook rejects `.md` outside allowed folders |

| Blueprint ↔ Docs link | CI check: every Blueprint step must cite a `/docs/*.md` path |

| 85% research filtering | Research Agent output hard-capped at 500 tokens (unless flagged critical) |

| No agent direct I/O | All user-facing output routed through Interface Liaison |

| HITL gate integrity | Orchestrator refuses to advance phase without explicit user confirmation |

| Cheap-model executability | QA Reviewer runs final Blueprint through `DeepSeek-V4-Flash` in dry-run to verify no ambiguity |

---

## 🧭 Part 8: Human-in-the-Loop Gates (Summary)

| Gate | Phase | User Decision |

|---|---|---|

| G1 | 1 → 2 | Confirm spark is complete |

| G2 | 2 | Brainstorm / Checkup / Skip |

| G3 | 2 (if Checkup) | Accept/reject each gap-fix |

| G4 | 5 | Answer stack/scope questionnaire |

| G5 | 5 | Re-answer if free-text triggered deeper research |

| G6 | 7 | Answer approach questionnaire |

| G7 | 7 | Re-answer if free-text triggered re-research |

| G8 | 9 → 10 | Review assembled Blueprint before freeze |

| G9 | 10 | Sign off and handoff |

**Rule:** No AI agent may advance past a gate without an explicit human signal.

---

## 🚀 Part 9: Build Sequence (Bootstrapping the Architect Itself)

You should build the Architect **using the Architect's own philosophy**. Start here:

1. **Week 1 — Orchestrator + Interface Liaison + CLI skeleton** (you must be able to navigate phases before agents matter)

2. **Week 2 — Spark Intake + Sketch Architect** (prove the human→sketch pipeline works)

3. **Week 3 — Research &amp; Filter Agent + Questionnaire Builder** (the HITL backbone)

4. **Week 4 — Docs Writer swarm + Blueprint Architect** (the delivery mechanism)

5. **Week 5 — Telegram interface via TeleFocus** (second channel)

6. **Week 6 — Brainstorm/Checkup Agents + QA Ensemble** (quality layer)

7. **Week 7 — Hardening, pre-commit hooks, CI guardrails**

8. **Week 8 — Dogfood: use the Architect to plan its own v2**

---

## ✅ TL;DR

&gt; **The Architect is a HITL pipeline that escorts a human spark through 10 phases — capture, mature, sketch, target, question, research, question again, document, assemble, freeze — producing a Blueprint so detailed a cheap coder model can execute it like a YouTube tutorial. Strategic models make rare decisions; execution models do the bulk work; the human owns every gate; and `TeleFocus` gives it a soul that feels hand-crafted rather than AI-generated.**

Ready to go deeper on any phase — want me to draft the actual `00_spark.md` for the Architect itself, or sketch the Orchestrator state machine next?