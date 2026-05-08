# Architect — Human-in-the-Loop Blueprint Builder

You changed `Shima` into **Architect**. Good change.

The new essence is clearer:

&gt; **Architect is an AI-native product-building system that transforms a human Spark into a fully researched, validated, step-by-step Blueprint, then generates the exact `/docs`, code, tests, and validation flow required to build the application with cheaper coding models.**

Architect is not just a chatbot.

Architect is a **Blueprint compiler**.

It takes:

```text

Human Spark

```

and produces:

```text

Production-ready /docs + /docs/blueprint + implementation roadmap + coding tasks + validation criteria

```

The human stays in the loop at every important decision point.

---

# 1. Core Product Definition

## Product Name

`Architect`

## Core Mission

Architect helps users turn any serious application idea into a complete, researched, validated, production-ready Blueprint.

It does this through:

- beautiful interactive CLI,

- Telegram interface,

- real-time loading states,

- step-by-step guided decision flow,

- brainstorming,

- checkups,

- research,

- stack selection,

- implementation planning,

- documentation generation,

- Blueprint generation,

- code/test generation,

- validation,

- human approval gates.

## One-Sentence Definition

&gt; **Architect is an AI-native interactive Blueprint generator that turns a human Spark into a complete build plan, docs system, research base, and coding roadmap with human approval at every major step.**

## Stronger Product Definition

&gt; **Architect receives a user’s raw Spark, optionally improves it through brainstorming, checks it for gaps, researches all required technologies and approaches, asks the user to approve key decisions, generates a clean `/docs` structure, writes a detailed `/docs/blueprint` roadmap, and prepares the project so fast coding agents can build it with minimal intelligence, low cost, and high accuracy.**

---

# 2. The Most Important Rule

Architect must be powerful, but not uncontrolled.

You said:

&gt; “It should be able to do anything it want.”

For production, the correct version is:

&gt; **Architect can generate, modify, test, validate, and improve anything inside the project workspace, but every strategic decision, scope expansion, technology choice, Blueprint lock, and external action requires human approval.**

So the system is not weak.

It is autonomous inside approved boundaries.

## Correct Authority Model

| Action | Architect Can Do Automatically? | Human Approval Required? |

|---|---:|---:|

| Read Spark | Yes | No |

| Ask questions | Yes | No |

| Brainstorm options | Yes | No |

| Run gap check | Yes | No |

| Research tools/libraries | Yes | No |

| Filter research | Yes | No |

| Propose stack | Yes | Yes |

| Choose final stack | No | Yes |

| Create docs | Yes, after approval | Yes for manifest |

| Create Blueprint | Yes | Yes before lock |

| Generate code | Yes, after Blueprint lock | Yes for execution phase |

| Run tests | Yes | No |

| Modify Blueprint after lock | No | Yes |

| Send external messages/API actions | No by default | Yes |

| Delete project files | No by default | Yes |

---

# 3. The Blueprint in Architect

For Architect, the **Blueprint** is the final compiled build instruction set.

It is the definitive source of truth.

It tells every downstream coding agent exactly:

- what to build,

- what not to build,

- which docs exist,

- which stack to use,

- which APIs/libraries/frameworks are approved,

- what research was accepted,

- which files to create,

- what tests prove completion,

- what order to build in,

- when to stop.

## Blueprint Role

The Blueprint must make the build feel like:

&gt; **A simple, direct, step-by-step tutorial for the coding agents.**

Not because the product is simple, but because the planning is complete.

## Blueprint Golden Rule

&gt; **If it is not inside `/docs/blueprint`, the coding agents do not build it.**

## Architect’s Core Promise

Architect should convert this:

```text

I have an idea but it is messy, emotional, incomplete, and missing technical decisions.

```

into this:

```text

Here is the exact researched plan, approved stack, docs, service/module map, implementation order, test plan, and acceptance criteria.

```

---

# 4. Recommended Product Shape

Architect should support **both**:

1. **Modular monolith output**

2. **Microservice output**

But Architect itself should start as:

&gt; **A modular monolith with clean internal modules.**

Why?

Because Architect is a workflow-heavy system. Starting with $40+$ services for Architect itself would slow you down.

Later, Architect can generate $40+$ service plans for other products.

## Architect Internal Modules

```text

architect/

  modules/

    interface_cli/

    interface_telegram/

    design_system_telefocus/

    spark_capture/

    brainstorming/

    checkup/

    blueprint_sketch/

    research_planning/

    research_execution/

    option_questionnaire/

    decision_settlement/

    docs_generation/

    blueprint_generation/

    code_generation/

    validation/

    project_state/

    model_routing/

    approval_gates/

    audit_log/

```

---

# 5. Required Interfaces

Architect needs two primary interfaces.

## Interface 1 — Beautiful CLI

Purpose:

- local project creation,

- interactive walkthrough,

- loading states,

- user choices,

- project file generation,

- test/validation output.

Recommended CLI technology options:

| Stack | Best For |

|---|---|

| `Ink` + React | Beautiful Node.js CLI with React mental model |

| `Textual` | Rich Python terminal apps |

| `Bubble Tea` / `Lip Gloss` | Beautiful Go TUIs |

| `oclif` + `Ink` | Production-grade command framework plus beautiful UI |

| `Clack` | Lightweight beautiful prompts |

| `Enquirer` / `prompts` | Simple interactive CLI prompts |

## My Recommendation

Use:

```text

Node.js / TypeScript

oclif or commander for command structure

Ink for beautiful live UI

Clack for simple prompts

Vercel AI SDK or custom model router for LLM calls

```

Why?

Because TypeScript is excellent for:

- CLI,

- Telegram bots,

- web dashboard later,

- schema validation,

- JSON state machines,

- LLM orchestration.

## Interface 2 — Telegram Interface

Purpose:

- run Architect from Telegram,

- use TeleFocus design system,

- show step-by-step flows,

- show real-time loading,

- approve decisions,

- receive Blueprint summaries,

- trigger generation,

- review docs.

You already have:

```text

/docs/design-system

```

with `TeleFocus`.

Architect should treat TeleFocus as the official Telegram UI design source.

## Telegram Bot Library Options

| Library | Best For |

|---|---|

| `grammY` | Modern, strong TypeScript Telegram bot framework |

| `Telegraf` | Popular and mature |

| `aiogram` | Python async Telegram bots |

| `python-telegram-bot` | Python ecosystem |

## My Recommendation

Use:

```text

grammY + TypeScript

```

because it fits the TypeScript CLI and allows one shared core workflow engine.

---

# 6. The Architect Flow

Architect should run as a **state machine**.

Every user project moves through fixed states.

```text

START

  ↓

SPARK_CAPTURE

  ↓

SPARK_MODE_SELECTION

  ↓

BRAINSTORM_OR_CHECKUP_OR_SKIP

  ↓

GROWN_SPARK_APPROVAL

  ↓

BLUEPRINT_SKETCH

  ↓

RESEARCH_SUBJECT_DISCOVERY

  ↓

STACK_AND_CAPABILITY_QUESTIONNAIRE

  ↓

TARGETED_RESEARCH

  ↓

APPROACH_SELECTION

  ↓

DECISION_SETTLEMENT

  ↓

DOCS_MANIFEST_APPROVAL

  ↓

DOCS_GENERATION

  ↓

BLUEPRINT_GENERATION

  ↓

BLUEPRINT_REVIEW

  ↓

BLUEPRINT_LOCK

  ↓

CODE_AND_TEST_GENERATION

  ↓

VALIDATION

  ↓

FOUNDATION_READY

```

This state machine is the heart of Architect.

---

# 7. Phase Breakdown

## Phase 0 — Project Start

### Goal

Create or select a project workspace.

### CLI Example

```text

architect new my-product

```

### Telegram Example

```text

/start_project

```

### Output

```text

/project

  /docs

  /src

  architect.state.json

```

### Human Approval

Not required.

---

## Phase 1 — Spark Capture

### Goal

Collect the raw human idea without corrupting it.

### Input

The user writes their Spark.

The Spark can be:

- messy,

- emotional,

- incomplete,

- long,

- short,

- technical,

- non-technical.

### Output

```text

/docs/[00-human-spark.md](http://00-human-spark.md)

```

### Important Rule

This document is preserved as the original idea.

Architect can later improve it, but never overwrite the original Spark.

### Human Approval

Required after capture.

---

## Phase 2 — Mode Selection

Architect asks:

```text

What do you want to do with this Spark?

1. Brainstorm and grow it

2. Check for gaps only

3. Skip and continue directly

```

## Mode A — Brainstorm

Use this when the user wants Architect to improve the idea.

Architect should:

- expand the idea,

- detect missing user types,

- find business/product gaps,

- improve the feature logic,

- improve technical realism,

- improve uniqueness,

- remove weak assumptions,

- suggest stronger directions.

Recommended skill:

```text

obra/superpowers/brainstorming

```

### Output

```text

/docs/[01-grown-spark.md](http://01-grown-spark.md)

```

## Mode B — Checkup Only

Use this when the user does not want the idea expanded.

Architect should:

- find gaps,

- find contradictions,

- find unclear parts,

- find risks,

- propose fixes,

- preserve the original scope.

### Output

```text

/docs/[01-spark-checkup.md](http://01-spark-checkup.md)

```

## Mode C — Skip

Use this when the user trusts the current Spark.

### Output

No extra doc unless the Blueprint mandates a transition note.

---

## Phase 3 — Grown Spark Approval

Architect presents the result.

The user can choose:

```text

1. Approve

2. Edit manually

3. Ask Architect to revise

4. Revert to original Spark

5. Continue with warnings

```

### Human Approval

Required.

### Output

```text

/docs/[02-approved-product-essence.md](http://02-approved-product-essence.md)

```

This becomes the approved product direction before research.

---

## Phase 4 — Blueprint Sketch

### Goal

Create a rough map before deep research.

This is not the final Blueprint.

It is a lightweight planning sketch.

### It Should Include

```text

Product summary

Core capabilities

Likely modules/services

Likely docs required

Known unknowns

Research topics

Risky areas

User decisions needed

Potential architecture options

```

### Output

```text

/docs/[03-blueprint-sketch.md](http://03-blueprint-sketch.md)

```

### Human Approval

Required before research begins.

---

## Phase 5 — Research Subject Discovery

Architect reads:

```text

/docs/[00-human-spark.md](http://00-human-spark.md)

/docs/[02-approved-product-essence.md](http://02-approved-product-essence.md)

/docs/[03-blueprint-sketch.md](http://03-blueprint-sketch.md)

```

Then it extracts all research subjects.

### Research Subject Types

```text

APIs

SDKs

libraries

frameworks

databases

queues

auth systems

payment systems

AI models

MCP servers

deployment platforms

open-source projects

design systems

security requirements

legal/compliance requirements

third-party integrations

```

### Output

```text

/docs/research/[00-research-subjects.md](http://00-research-subjects.md)

```

### Example

```text

Research Subjects:

1. Best Telegram bot framework for TypeScript

2. Best CLI framework for interactive AI-native workflows

3. Best schema validation library

4. Best state machine library

5. Best LLM routing architecture

6. Best way to stream loading states to CLI and Telegram

7. Best docs generation structure

8. Best test validation framework

```

---

## Phase 6 — Stack and Capability Questionnaire

Architect should not silently choose everything.

It should ask the user.

### If User Already Specified Stack

Architect should not ask again unless something is missing.

Example:

```text

User specified TypeScript, grammY, Ink, PostgreSQL.

```

Architect only asks about missing areas:

```text

Which queue system do you prefer?

Which database migration tool?

Which test runner?

```

### If User Did Not Specify Stack

Architect proposes options.

Example:

```text

For the CLI, choose:

1. Ink + React

2. Textual Python

3. Bubble Tea Go

4. Lightweight prompts only

5. Custom answer

```

### Custom Answer Rule

If the user writes a custom answer, Architect must research it further.

Flow:

```text

User custom answer

  ↓

Research custom option

  ↓

Compare with suggested options

  ↓

Ask again

  ↓

Repeat until settlement

```

### Output

```text

/docs/research/[01-user-preferences.md](http://01-user-preferences.md)

```

---

## Phase 7 — Targeted Research

Now Architect researches the approved subjects.

### Important Rule

Research must be comprehensive but filtered.

It should not be a tutorial.

It should not dump raw web pages.

It should answer:

```text

What is it?

Why does it matter for this project?

Should we use it?

How should we use it?

What are the risks?

What are the best practices?

What examples/patterns matter?

What does the Blueprint need to remember?

```

### Research Filter Rule

Architect must remove at least $85\%$ of irrelevant data.

Only keep findings that affect:

- architecture,

- implementation,

- library choice,

- API usage,

- security,

- testing,

- performance,

- deployment,

- product behavior.

### Output Structure

```text

/docs/research/

  [00-research-subjects.md](http://00-research-subjects.md)

  [01-user-preferences.md](http://01-user-preferences.md)

  [02-cli-frameworks.md](http://02-cli-frameworks.md)

  [03-telegram-interface.md](http://03-telegram-interface.md)

  [04-llm-routing.md](http://04-llm-routing.md)

  [05-state-machine.md](http://05-state-machine.md)

  [06-docs-generation.md](http://06-docs-generation.md)

  [07-testing-validation.md](http://07-testing-validation.md)

  [08-security.md](http://08-security.md)

  [09-deployment.md](http://09-deployment.md)

```

Only create files mandated by the docs manifest.

---

## Phase 8 — Approach Selection

After research, Architect asks a second questionnaire.

This time, it is not asking what to research.

It is asking what to choose.

Example:

```text

For the Architect CLI, recommended approach:

1. Ink + React + Clack

   Reason: best balance of beauty, speed, and TypeScript compatibility.

2. Textual Python

   Reason: strongest full terminal UI, but splits stack from Telegram bot.

3. Bubble Tea Go

   Reason: beautiful and fast, but less ideal for LLM-heavy TypeScript ecosystem.

Recommended: Option 1

Choose:

[1] Accept recommended

[2] Choose another

[3] Custom answer

[4] Ask for deeper comparison

```

### Output

```text

/docs/research/[10-approved-decisions.md](http://10-approved-decisions.md)

```

---

## Phase 9 — Decision Settlement

Architect confirms all critical decisions.

### Decision Categories

```text

Product scope

Architecture style

CLI framework

Telegram framework

LLM provider strategy

Model routing strategy

Database

Queue

State machine

Docs structure

Testing strategy

Deployment target

Security model

Human approval gates

```

### Output

```text

/docs/[04-approved-decisions.md](http://04-approved-decisions.md)

```

### Human Approval

Required.

This is a major gate.

---

## Phase 10 — Docs Manifest Approval

Before generating docs, Architect creates a docs manifest.

The manifest controls what docs may exist.

### Output

```text

/docs/[05-docs-manifest.md](http://05-docs-manifest.md)

```

### Example

```text

Allowed Docs:

/docs/[00-human-spark.md](http://00-human-spark.md)

/docs/[01-grown-spark.md](http://01-grown-spark.md)

/docs/[02-approved-product-essence.md](http://02-approved-product-essence.md)

/docs/[03-blueprint-sketch.md](http://03-blueprint-sketch.md)

/docs/[04-approved-decisions.md](http://04-approved-decisions.md)

/docs/[05-docs-manifest.md](http://05-docs-manifest.md)

/docs/research/[00-research-subjects.md](http://00-research-subjects.md)

/docs/research/[01-user-preferences.md](http://01-user-preferences.md)

/docs/research/[02-cli-frameworks.md](http://02-cli-frameworks.md)

/docs/research/[03-telegram-interface.md](http://03-telegram-interface.md)

/docs/research/[04-llm-routing.md](http://04-llm-routing.md)

/docs/research/[05-state-machine.md](http://05-state-machine.md)

/docs/research/[06-testing-validation.md](http://06-testing-validation.md)

/docs/blueprint/[00-overview.md](http://00-overview.md)

/docs/blueprint/[01-architecture.md](http://01-architecture.md)

/docs/blueprint/[02-modules.md](http://02-modules.md)

/docs/blueprint/[03-flow.md](http://03-flow.md)

/docs/blueprint/[04-implementation-roadmap.md](http://04-implementation-roadmap.md)

/docs/blueprint/[05-validation.md](http://05-validation.md)

```

### Rule

No doc can be generated unless it appears here.

### Human Approval

Required.

---

## Phase 11 — Research Docs Generation

Architect now writes the approved research docs.

### Research Doc Template

Each research doc should use this structure:

```text

# Topic Name

## Decision Summary

## Why This Matters

## Approved Choice

## Alternatives Considered

## Implementation-Relevant Findings

## Required Patterns

## Risks / Warnings

## Testing Notes

## Blueprint References

## Sources / References

```

### Important

These docs should be detailed enough for implementation, but not tutorials.

Bad:

```text

Here is a 50-page tutorial on how React works.

```

Good:

```text

For this project, use Ink components for step rendering, loading states, error boundaries, and approval prompts. Avoid complex nested layouts in early versions.

```

---

## Phase 12 — Final Blueprint Generation

Architect now creates:

```text

/docs/blueprint

```

This is the final build plan.

### Recommended Blueprint Structure

```text

/docs/blueprint/

  [00-overview.md](http://00-overview.md)

  [01-product-scope.md](http://01-product-scope.md)

  [02-approved-stack.md](http://02-approved-stack.md)

  [03-system-architecture.md](http://03-system-architecture.md)

  [04-state-machine.md](http://04-state-machine.md)

  [05-cli-interface.md](http://05-cli-interface.md)

  [06-telegram-interface.md](http://06-telegram-interface.md)

  [07-model-routing.md](http://07-model-routing.md)

  [08-docs-generation.md](http://08-docs-generation.md)

  [09-human-approval-gates.md](http://09-human-approval-gates.md)

  [10-data-model.md](http://10-data-model.md)

  [11-module-map.md](http://11-module-map.md)

  [12-implementation-roadmap.md](http://12-implementation-roadmap.md)

  [13-test-plan.md](http://13-test-plan.md)

  [14-validation-plan.md](http://14-validation-plan.md)

  [15-acceptance-criteria.md](http://15-acceptance-criteria.md)

```

Only generate these if listed in the docs manifest.

---

# 8. The Final Blueprint Must Be Step-by-Step

The Blueprint should not merely describe the product.

It must instruct coding agents.

## Example Blueprint Step Format

```text

## BP-CLI-001 — Create CLI Project Shell

### Goal

Create the base CLI application with command routing and shared project context.

### Inputs

- /docs/research/[02-cli-frameworks.md](http://02-cli-frameworks.md)

- /docs/blueprint/[05-cli-interface.md](http://05-cli-interface.md)

### Files To Create

- package.json

- src/cli/index.ts

- src/cli/commands/new.ts

- src/cli/commands/resume.ts

- src/cli/commands/validate.ts

### Implementation Steps

1. Initialize TypeScript project.

2. Add CLI command router.

3. Add project workspace resolver.

4. Add error formatting.

5. Add version command.

### Acceptance Criteria

- `architect --help` works.

- `architect new <project>` creates a workspace.

- CLI errors are formatted consistently.

- No docs are created outside `/docs`.

### Prohibited

- Do not implement brainstorming yet.

- Do not add Telegram bot code in this step.

```

This is what makes cheap coding agents effective.

---

# 9. Human-in-the-Loop Design

Architect must be human-in-the-loop completely.

That does **not** mean the human manually edits everything.

It means the human approves irreversible or strategic changes.

## Approval Gates

| Gate | Human Must Approve? |

|---|---:|

| Original Spark capture | Yes |

| Brainstormed/grown Spark | Yes |

| Checkup findings | Yes |

| Blueprint sketch | Yes |

| Research subject list | Yes |

| Stack/capability choices | Yes |

| Final approved decisions | Yes |

| Docs manifest | Yes |

| Final Blueprint | Yes |

| Code generation start | Yes |

| Blueprint changes after lock | Yes |

| External API actions | Yes |

| File deletion | Yes |

## Approval UX

Every approval should support:

```text

Approve

Reject

Edit

Ask for revision

Ask for deeper research

Skip with warning

```

## Approval Record

Every approval should be saved.

```text

/docs/audit/[approvals.md](http://approvals.md)

```

Or better, structured state:

```text

architect.state.json

```

Example:

```json

{

  "approvals": [

    {

      "id": "APPROVAL-001",

      "gate": "GROWN_SPARK_APPROVAL",

      "status": "approved",

      "approvedBy": "user",

      "timestamp": "2026-05-08T12:00:00Z",

      "artifact": "/docs/[02-approved-product-essence.md](http://02-approved-product-essence.md)"

    }

  ]

}

```

---

# 10. Real-Time Loading Design

You specifically want real-time loadings in CLI and Telegram.

Architect should have a shared progress event system.

## Progress Events

```ts

type ProgressEvent =

  | { type: "stage_started"; stageId: string; label: string }

  | { type: "step_started"; stepId: string; label: string }

  | { type: "token_stream"; text: string }

  | { type: "tool_started"; tool: string; inputSummary: string }

  | { type: "tool_finished"; tool: string; resultSummary: string }

  | { type: "warning"; message: string }

  | { type: "approval_required"; approvalId: string; label: string }

  | { type: "stage_completed"; stageId: string; artifactPaths: string[] }

  | { type: "error"; message: string };

```

The CLI and Telegram interface both subscribe to the same events.

## CLI Loading Examples

```text

◇ Reading Spark

◇ Running brainstorm ensemble

◇ Checking gaps from product, technical, UX, and market angles

◇ Creating Blueprint sketch

◇ Extracting research subjects

◇ Waiting for your approval

```

## Telegram Loading Examples

Using TeleFocus:

```text

✨ Architect is improving your Spark...

▰▰▰▱▱ 60%

Current step:

Checking missing product assumptions

Next:

Blueprint sketch

```

---

# 11. TeleFocus Integration

Your Telegram interface must follow:

```text

/docs/design-system

```

Architect should create a dedicated integration doc:

```text

/docs/blueprint/[06-telegram-interface.md](http://06-telegram-interface.md)

```

It should define:

- message layout,

- button style,

- progress style,

- approval card style,

- error style,

- confirmation style,

- long output pagination,

- file delivery format,

- summary cards.

## Required Telegram Components

```text

Spark Capture Card

Mode Selection Card

Brainstorming Progress Card

Checkup Findings Card

Research Subject Approval Card

Questionnaire Card

Decision Summary Card

Docs Manifest Card

Blueprint Review Card

Validation Result Card

```

## Telegram Interaction Pattern

```text

User sends Spark

  ↓

Architect replies with Mode Selection

  ↓

User taps Brainstorm / Checkup / Skip

  ↓

Architect streams progress

  ↓

Architect sends result summary

  ↓

User approves or requests revision

```

---

# 12. Model Routing Strategy

Architect should not use one model for everything.

## High-Intelligence Models

Use for:

- Spark interpretation,

- brainstorming,

- gap analysis,

- architecture design,

- stack decisions,

- final Blueprint writing,

- critical QA review.

Recommended:

```text

Claude-Opus-4.7

GPT-5.5

Kimi K2.5

DeepSeek-V4-Pro

```

## Fast / Cheap Models

Use for:

- formatting docs,

- extracting research subjects,

- summarizing research,

- generating repetitive docs,

- generating code from detailed Blueprint,

- test generation,

- validation scripts.

Recommended:

```text

DeepSeek-V4-Flash

MiniMax-M2.7

Qwen-Coder-Turbo

```

## Model Routing Levels

```text

Level 0: Code-only processing

Level 1: Fast model extraction/summarization

Level 2: Specialist model review

Level 3: High-intelligence architecture review

Level 4: Human approval

```

---

# 13. Exact Map of AI Agents for Architect

## 1. Spark Intake Agent

**Model:** Fast model, escalate to high-intelligence for messy Sparks  

**Purpose:** Capture and preserve the raw Spark.

### Responsibilities

- receive Spark,

- normalize formatting,

- save original unchanged,

- extract initial keywords,

- detect missing obvious fields,

- ask clarifying questions only if necessary.

### Output

```text

/docs/[00-human-spark.md](http://00-human-spark.md)

```

---

## 2. Brainstorming Agent

**Model:** `Claude-Opus-4.7` or `GPT-5.5`  

**Skill:** `obra/superpowers/brainstorming`

### Purpose

Grow the Spark into a mature idea.

### Responsibilities

- expand product concept,

- improve uniqueness,

- add missing user journeys,

- expose hidden opportunities,

- suggest stronger positioning,

- preserve the user’s original identity.

### Output

```text

/docs/[01-grown-spark.md](http://01-grown-spark.md)

```

---

## 3. Checkup Agent

**Model:** `Kimi K2.5`, `DeepSeek-V4-Pro`, or `GPT-5.5`

### Purpose

Find gaps without expanding the idea.

### Responsibilities

- detect contradictions,

- find missing requirements,

- identify unclear assumptions,

- find technical risks,

- find product risks,

- suggest minimal fixes.

### Output

```text

/docs/[01-spark-checkup.md](http://01-spark-checkup.md)

```

---

## 4. Blueprint Sketch Agent

**Model:** `GPT-5.5` or `Claude-Opus-4.7`

### Purpose

Create the rough pre-research plan.

### Responsibilities

- sketch architecture,

- identify probable docs,

- identify likely modules/services,

- identify research topics,

- identify unknowns,

- prepare next questionnaire.

### Output

```text

/docs/[03-blueprint-sketch.md](http://03-blueprint-sketch.md)

```

---

## 5. Research Planner Agent

**Model:** `GPT-5.5` for strategy, fast model for extraction

### Purpose

Determine what must be researched.

### Responsibilities

- extract APIs,

- extract libraries,

- extract frameworks,

- extract open-source options,

- extract uncertain stack areas,

- detect build-vs-buy opportunities,

- prepare research subject list.

### Output

```text

/docs/research/[00-research-subjects.md](http://00-research-subjects.md)

```

---

## 6. Research Filtering Agent

**Model:** `DeepSeek-V4-Flash`, escalate when needed

### Purpose

Research deeply but filter aggressively.

### Responsibilities

- gather current docs and examples,

- compare options,

- remove noise,

- keep implementation-relevant findings,

- discard at least $85\%$ irrelevant content,

- summarize risks and best practices.

### Output

```text

/docs/research/*.md

```

---

## 7. Questionnaire Agent

**Model:** Fast model, high-intelligence for complex tradeoffs

### Purpose

Ask the user structured questions.

### Responsibilities

- produce multiple-choice options,

- allow custom answers,

- trigger further research for custom answers,

- continue until settlement,

- save user preferences.

### Output

```text

/docs/research/[01-user-preferences.md](http://01-user-preferences.md)

/docs/[04-approved-decisions.md](http://04-approved-decisions.md)

```

---

## 8. Decision Settlement Agent

**Model:** `GPT-5.5` or `Claude-Opus-4.7`

### Purpose

Convert research and user answers into final approved decisions.

### Responsibilities

- consolidate choices,

- remove contradictions,

- identify unresolved questions,

- recommend final stack,

- ask for human approval.

### Output

```text

/docs/[04-approved-decisions.md](http://04-approved-decisions.md)

```

---

## 9. Documentation Governor

**Model:** Fast model

### Purpose

Prevent documentation chaos.

### Responsibilities

- enforce `/docs` only,

- generate docs manifest,

- block unauthorized docs,

- remove duplication,

- ensure docs are implementation-focused,

- ensure every doc maps to a Blueprint need.

### Output

```text

/docs/[05-docs-manifest.md](http://05-docs-manifest.md)

```

---

## 10. Blueprint Architect Agent

**Model:** `Claude-Opus-4.7` or `GPT-5.5`

### Purpose

Generate the final `/docs/blueprint`.

### Responsibilities

- write final source of truth,

- turn decisions into implementation steps,

- reference research docs directly,

- define file creation order,

- define module map,

- define tests,

- define acceptance criteria,

- make coding easy for fast models.

### Output

```text

/docs/blueprint/*

```

---

## 11. QA Reviewer Agent

**Model:** Ensemble: `Kimi K2.5` + `DeepSeek-V4-Pro` + optional `GPT-5.5`

### Purpose

Attack the final Blueprint before lock.

### Responsibilities

- detect missing steps,

- detect vague instructions,

- detect overengineering,

- detect unsafe assumptions,

- detect docs/code mismatch,

- detect impossible implementation order,

- detect test gaps.

### Output

```text

/docs/qa/[blueprint-review.md](http://blueprint-review.md)

```

Only if mandated by docs manifest.

---

## 12. Code Generation Agent

**Model:** `DeepSeek-V4-Flash` or `Qwen-Coder-Turbo`

### Purpose

Generate code from the locked Blueprint.

### Responsibilities

- create project files,

- implement modules,

- write tests,

- follow exact Blueprint steps,

- avoid extra features,

- avoid scattered docs,

- avoid duplicated code.

### Output

```text

/src

/tests

/config files

/package files

```

---

## 13. Validation Agent

**Model:** Fast model plus deterministic tools

### Purpose

Validate that the generated system matches the Blueprint.

### Responsibilities

- run tests,

- check docs manifest,

- check file structure,

- check commands,

- check linting,

- check type safety,

- check acceptance criteria,

- report failures.

### Output

```text

/docs/validation/[foundation-validation.md](http://foundation-validation.md)

```

Only if manifest-approved.

---

## 14. Human Approval Agent

**Model:** Mostly deterministic, no expensive model needed

### Purpose

Manage all approval gates.

### Responsibilities

- pause workflows,

- show summaries,

- collect approve/reject/edit decisions,

- write approval records,

- block unsafe or unauthorized transitions.

### Output

```text

architect.state.json

```

---

# 14. Architect’s Own `/docs` Structure

For Architect itself, use this:

```text

/docs/

  /design-system/

    ...TeleFocus files...

  [00-human-spark.md](http://00-human-spark.md)

  [01-grown-spark.md](http://01-grown-spark.md)

  [02-approved-product-essence.md](http://02-approved-product-essence.md)

  [03-blueprint-sketch.md](http://03-blueprint-sketch.md)

  [04-approved-decisions.md](http://04-approved-decisions.md)

  [05-docs-manifest.md](http://05-docs-manifest.md)

  /research/

    [00-research-subjects.md](http://00-research-subjects.md)

    [01-user-preferences.md](http://01-user-preferences.md)

    [02-cli-frameworks.md](http://02-cli-frameworks.md)

    [03-telegram-interface.md](http://03-telegram-interface.md)

    [04-llm-routing.md](http://04-llm-routing.md)

    [05-state-machine.md](http://05-state-machine.md)

    [06-docs-generation.md](http://06-docs-generation.md)

    [07-testing-validation.md](http://07-testing-validation.md)

    [08-security.md](http://08-security.md)

    [09-deployment.md](http://09-deployment.md)

  /blueprint/

    [00-overview.md](http://00-overview.md)

    [01-product-scope.md](http://01-product-scope.md)

    [02-approved-stack.md](http://02-approved-stack.md)

    [03-system-architecture.md](http://03-system-architecture.md)

    [04-state-machine.md](http://04-state-machine.md)

    [05-cli-interface.md](http://05-cli-interface.md)

    [06-telegram-interface.md](http://06-telegram-interface.md)

    [07-model-routing.md](http://07-model-routing.md)

    [08-docs-generation.md](http://08-docs-generation.md)

    [09-human-approval-gates.md](http://09-human-approval-gates.md)

    [10-data-model.md](http://10-data-model.md)

    [11-module-map.md](http://11-module-map.md)

    [12-implementation-roadmap.md](http://12-implementation-roadmap.md)

    [13-test-plan.md](http://13-test-plan.md)

    [14-validation-plan.md](http://14-validation-plan.md)

    [15-acceptance-criteria.md](http://15-acceptance-criteria.md)

  /qa/

    [blueprint-review.md](http://blueprint-review.md)

  /validation/

    [foundation-validation.md](http://foundation-validation.md)

```

But remember:

&gt; These files exist only if `/docs/05-docs-manifest.md` approves them.

---

# 15. Recommended Technical Stack for Architect

Unless you prefer another stack, this is the strongest default.

## Core Stack

```text

Language: TypeScript

Runtime: Node.js

Package Manager: pnpm

CLI: oclif or commander + Ink + Clack

Telegram Bot: grammY

Schema Validation: Zod

State Machine: XState or custom typed workflow engine

Database: PostgreSQL

ORM: Drizzle or Prisma

Queue: BullMQ + Redis

LLM Routing: custom provider abstraction

Testing: Vitest

E2E/CLI Testing: Playwright or custom process tests

Formatting/Linting: Biome or ESLint + Prettier

Docs Format: Markdown

Config: typed JSON/YAML

```

## Why This Stack

| Area | Choice | Reason |

|---|---|---|

| TypeScript | Main language | Shared CLI, Telegram, backend, schemas |

| Ink | CLI UI | Beautiful React-based terminal UI |

| Clack | Prompts | Simple polished prompts |

| grammY | Telegram | Modern TypeScript Telegram bot framework |

| Zod | Schemas | Strong validation for LLM outputs |

| PostgreSQL | Storage | Reliable project/workflow persistence |

| BullMQ | Jobs | Good for research and generation queues |

| Vitest | Tests | Fast TS-native testing |

| Biome | Formatting/linting | Fast and simple |

---

# 16. Core Data Model

Architect needs structured state.

## Main Entities

```text

Project

Spark

Artifact

WorkflowRun

WorkflowStage

Approval

ResearchSubject

ResearchFinding

Question

Answer

Decision

DocsManifestEntry

BlueprintStep

ValidationResult

ModelCall

AuditEvent

```

## Example Project State

```json

{

  "projectId": "architect-demo",

  "currentStage": "BLUEPRINT_SKETCH",

  "sparkPath": "/docs/[00-human-spark.md](http://00-human-spark.md)",

  "approvedEssencePath": "/docs/[02-approved-product-essence.md](http://02-approved-product-essence.md)",

  "docsManifestPath": null,

  "blueprintLocked": false,

  "pendingApproval": {

    "id": "APPROVAL-003",

    "stage": "BLUEPRINT_SKETCH",

    "artifact": "/docs/[03-blueprint-sketch.md](http://03-blueprint-sketch.md)"

  }

}

```

---

# 17. CLI Command Map

Architect CLI should be simple.

```text

architect new &lt;project-name&gt;

architect resume

architect spark

architect brainstorm

architect checkup

architect sketch

architect research

architect decisions

architect docs

architect blueprint

architect review

architect lock

architect generate

architect validate

architect status

```

## Example Flow

```text

architect new my-app

architect spark

architect brainstorm

architect sketch

architect research

architect decisions

architect docs

architect blueprint

architect review

architect lock

architect generate

architect validate

```

---

# 18. Telegram Command Map

```text

/start

/new_project

/resume

/spark

/brainstorm

/checkup

/sketch

/research

/decisions

/docs

/blueprint

/review

/lock

/status

/validate

```

Telegram should not dump giant docs into chat.

Instead:

- show summaries,

- provide approval buttons,

- attach files,

- link to generated artifacts,

- paginate long content.

---

# 19. Validation System

Architect must validate both docs and code.

## Docs Validation

Check:

```text

All docs are inside /docs

Every doc is listed in docs manifest

No duplicate docs

No forbidden filenames

Every Blueprint step has an ID

Every Blueprint step has acceptance criteria

Every research doc has decision summary

Every approved stack decision is referenced by Blueprint

```

## Code Validation

Check:

```text

Project builds

Tests pass

Types pass

Lint passes

No unauthorized files

No scattered markdown

No TODO-only implementations

No placeholder services marked complete

```

## Blueprint Validation

Check:

```text

No vague steps

No missing dependencies

No circular implementation order

No unapproved technology

No undocumented module

No module without acceptance criteria

No coding task without source docs

```

---

# 20. Implementation Roadmap for Architect

## Stage 1 — Foundation

Build:

```text

CLI shell

Project workspace creation

/docs creation

State file

Spark capture

Basic approval gate

```

Acceptance:

```text

User can create a project, submit Spark, and approve saved Spark.

```

---

## Stage 2 — Brainstorm / Checkup Flow

Build:

```text

Mode selection

Brainstorming Agent

Checkup Agent

Skip path

Grown Spark approval

```

Acceptance:

```text

User can choose Brainstorm, Checkup, or Skip.

Architect saves approved product essence.

```

---

## Stage 3 — Blueprint Sketch

Build:

```text

Blueprint Sketch Agent

Research subject extraction

Sketch approval

```

Acceptance:

```text

Architect creates /docs/[03-blueprint-sketch.md](http://03-blueprint-sketch.md) and extracts research subjects.

```

---

## Stage 4 — Research and Questionnaire

Build:

```text

Research Planner

Questionnaire system

Custom answer loop

Decision settlement

```

Acceptance:

```text

User can approve stack/capability decisions.

Custom answers trigger additional research.

```

---

## Stage 5 — Docs Manifest and Docs Generation

Build:

```text

Documentation Governor

Docs manifest

Research docs generator

Docs validator

```

Acceptance:

```text

Only manifest-approved docs are created.

Research docs are implementation-focused.

```

---

## Stage 6 — Final Blueprint

Build:

```text

Blueprint Architect Agent

Blueprint folder generator

Blueprint QA Reviewer

Blueprint lock

```

Acceptance:

```text

/docs/blueprint is generated, reviewed, and locked after human approval.

```

---

## Stage 7 — Code/Test Generation

Build:

```text

Code Generation Agent

Test Generation Agent

Validation Agent

```

Acceptance:

```text

Architect can generate the application foundation from locked Blueprint.

```

---

## Stage 8 — Telegram Interface

Build:

```text

grammY bot

TeleFocus components

Telegram approvals

Real-time progress cards

File delivery

```

Acceptance:

```text

User can run the same workflow from Telegram.

```

---

# 21. The Final Operating Principle

Architect should follow this exact philosophy:

```text

Human creates the Spark.

Architect improves or checks it only with permission.

Architect researches only what matters.

Human approves all major decisions.

Architect writes only manifest-approved docs.

Architect compiles the final Blueprint.

Human locks the Blueprint.

Cheap coding agents build from the Blueprint.

Validation proves the result.

```

The most important control point is:

```text

Human Spark → Approved Product Essence → Approved Decisions → Locked Blueprint

```

Everything after that is execution.

---

# 22. Immediate Next Step

The next artifact to create for Architect should be:

```text

/docs/[00-human-spark.md](http://00-human-spark.md)

```

Use this as the cleaned Spark:

```text

Architect is an AI-native interactive Blueprint builder.

It helps users transform a raw human Spark into a complete, researched, validated, production-ready application plan. Architect runs through a beautiful CLI and a Telegram interface using the TeleFocus design system.

The system captures the user’s Spark, asks whether they want brainstorming, gap checkup, or direct continuation, then improves or validates the idea through multiple AI models. After the user approves the grown idea, Architect creates a Blueprint sketch, identifies required research subjects, asks the user about stack and capability preferences, researches selected technologies and approaches, and repeats decision loops until the user approves the final direction.

Architect then generates only the required files inside /docs, including research findings, approved decisions, and the final /docs/blueprint folder. The Blueprint is a step-by-step implementation roadmap with direct references to the research docs, acceptance criteria, validation steps, and coding tasks.

The goal is to make even complex applications buildable by fast, cheap coding models because the hard thinking has already been completed inside the Blueprint.

Architect is human-in-the-loop by design. It can generate docs, code, tests, and validation flows, but major decisions, Blueprint locks, scope changes, and external actions require human approval.

```

Then create:

```text

/docs/[01-grown-spark.md](http://01-grown-spark.md)

/docs/[03-blueprint-sketch.md](http://03-blueprint-sketch.md)

/docs/[05-docs-manifest.md](http://05-docs-manifest.md)

/docs/blueprint/[00-overview.md](http://00-overview.md)

```

only after the relevant approval gates.

The final product should feel like:

&gt; **A beautiful AI command center that turns ideas into buildable reality without chaos, without documentation bloat, and without losing the human Spark.**