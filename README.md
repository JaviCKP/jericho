<p align="center">
  <img src="docs/assets/hero_banner.jpg" alt="JERICHO — FROM CHAT TO AGENT" width="100%" />
</p>

<h3 align="center">
  <b>Turn the unlimited web version of ChatGPT (<a href="https://chatgpt.com">chatgpt.com</a>) into a powerful, autonomous software engineering agent for your local computer.</b>
</h3>

<p align="center">
  Deterministic Computer Use & Screen Perception · Surgical Code Patching with Atomic Rollback · Structured Memory with Revision Control · Out-of-Band Human Approvals · Zero-Trust Security Architecture.
</p>

---

<p align="center">
  <img src="docs/assets/unlock_poster.jpg" alt="UNLOCK YOUR CHATGPT" width="100%" />
</p>

---

## 📑 Table of Contents

- [🌟 Why Jericho?](#-why-jericho)
- [🏛️ System Architecture](#️-system-architecture)
- [⚡ Core Technical Pillars](#-core-technical-pillars)
- [🛠️ The Tool Surface](#️-the-tool-surface)
- [🚀 Quickstart in 60 Seconds](#-quickstart-in-60-seconds)
- [💬 Real-World ChatGPT Web Workflows](#-real-world-chatgpt-web-workflows)
- [🎛️ Human Operator Console (Human-in-the-Loop)](#️-human-operator-console-human-in-the-loop)
- [🔒 Zero-Trust Security & Threat Mitigation](#-zero-trust-security--threat-mitigation)
- [📚 Deep-Dive Technical Documentation](#-deep-dive-technical-documentation)
- [📄 License](#-license)

---

## 🌟 Why Jericho?

While web-based AI models like ChatGPT Web have unlimited reasoning capabilities, they are isolated in the cloud without direct access to your local machine. Most existing local tools are either unsafe scripts with unrestricted command access or superficial wrappers that suffer from total amnesia between chats.

**Jericho** bridges this gap by enabling **ChatGPT Web** to act as a secure, autonomous agent directly on your PC:

1. **🚀 Unleash ChatGPT Web on Your Local PC:** Turn the unlimited web version of ChatGPT into an active local pair programmer and OS operator that reads your projects, writes and edits code, runs test suites, and monitors system processes.
2. **🔒 Zero Open Ports (Outbound-Only TLS Tunnel):** Connects to ChatGPT Web via OpenAI's official secure tunnel protocol. No public IP exposure, no port forwarding, and no firewall reconfigurations required.
3. **🛡️ Unified Zero-Trust Chokepoint Engine:** Every single tool call must clear a centralized `PolicyEngine` before touching your operating system. Every action is formally risk-scored from **R0** (read-only) to **R4** (high impact).
4. **↩️ Surgical Code Patching with Atomic Rollback:** Unified diff application with SHA-256 pre-validation, `dry_run` simulation, and instant `rollback_token` recovery to immediately undo breaking changes.
5. **🧠 Concurrent Structured Memory (No Amnesia):** Work items versioned with *Compare-and-Swap* (`expected_revision`), automatic disk and git staleness detection, and mandatory verification evidence before closing tasks.
6. **👁️ Deterministic Computer Use:** High-resolution window observation, coordinate mapping, and geometry preconditioning to prevent blind mouse clicks or misdirected keyboard actions.
7. **👤 Out-of-Band Human Approvals:** High-risk actions (destructive modifications, directory deletion) require physical operator authorization via terminal (`npm run approve`). The AI model cannot self-authorize destructive actions.

---

## 🏛️ System Architecture

<p align="center">
  <img src="docs/assets/system_architecture.svg" alt="Jericho Core Runtime System Architecture" width="100%" />
</p>

<details>
<summary><b>🔍 View Text Architecture Specification</b></summary>

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        ChatGPT Web (chatgpt.com)                       │
│                       [Developer Mode / MCP Client]                    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼  Outbound TLS Encrypted Stream
┌────────────────────────────────────────────────────────────────────────┐
│                   OpenAI Secure MCP Tunnel Gateway                     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼  stdio (JSON-RPC 2.0 / MCP 2025-11-25)
┌────────────────────────────────────────────────────────────────────────┐
│                         JERICHO CORE RUNTIME                           │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                CHOKEPOINT: POLICY ENGINE (Zero-Trust)             │  │
│  │       Identity · Risk Scoring (R0-R4) · Roots · Approvals        │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     │                                  │
│         ┌───────────────────────────┼──────────────────────────┐       │
│         ▼                           ▼                          ▼       │
│  ┌──────────────┐            ┌──────────────┐           ┌───────────┐  │
│  │  Workspace   │            │   Terminal   │           │  Desktop  │  │
│  │ Paths / Diff │            │ Safe Exec /  │           │ Observe / │  │
│  │ & Rollback   │            │ Allowlist    │           │ Input     │  │
│  └──────────────┘            └──────────────┘           └───────────┘  │
│         │                           │                          │       │
│         └───────────────────────────┼──────────────────────────┘       │
│                                     ▼                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │         IMMUTABLE CRYPTOGRAPHIC JOURNAL (Hash-Chained Log)       │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  Your Machine (Windows / macOS / Linux)                │
└────────────────────────────────────────────────────────────────────────┘
```

</details>

---

## ⚡ Core Technical Pillars

### 1. 🧱 Strict Filesystem Jailing (`paths.js`)
* **Authorized Root Confinement:** The agent is bounded to authorized workspace roots (`workspace`, `downloads`, `desktop`, `documents`).
* **OS Exploit Immunity:** Proactively rejects *Path Traversal* (`../`), NTFS Alternate Data Streams (`file:stream`), MS-DOS reserved device names (`CON`, `PRN`, `AUX`, `NUL`), 8.3 short-name aliases (`PROGRA~1`), UNC network paths (`\\evil-server\`), and symlink/junction breakout attacks via canonical `realpath` verification.
* **Non-Negotiable Secret Exclusions:** Hardcoded blocks for `.env*`, `.ssh/`, `.aws/`, `.gnupg/`, `id_rsa`, `.npmrc`, `.git-credentials`, and cryptographic certificates (`*.pem`, `*.key`) — even if located inside authorized workspaces.

### 2. ↩️ Surgical Patch Engine & Instant Rollback (`apply_patch` / `rollback`)
* **Dry-Run Validation:** Simulates diff application without touching the disk (`dry_run: true`).
* **Instant Undo Token:** Every applied patch produces an atomic `rollback_token` (e.g., `rb_cae1a6bfc938`). If tests fail or code breaks, `workspace.rollback` restores the exact pre-patch byte state immediately.
* **Preconditional SHA-256 Hashes:** Prevents dirty writes if the file was modified externally between reading and patching.

### 3. 🧠 Structured Task Memory & Anti-Hallucination (`memory.*`)
* **Optimistic Concurrency (Compare-and-Swap):** Tasks carry revision counters (`revision: 1, 2...`). Multiple ChatGPT windows cannot overwrite each other's work.
* **Staleness Detection:** When resuming tasks, Jericho checks real git branch states and filesystem modification dates, alerting the agent if files were altered outside the session.
* **Evidence-Backed Completion:** The model is physically prevented from setting tasks to `COMPLETED` without linking verifiable test execution IDs (`trace_id`) recorded in the append-only cryptographic journal.

### 4. 👤 Out-of-Band Human Approvals (`operator.js`)
* High-risk operations (directory deletion, destructive modifications) pause execution and yield an `approval_id`.
* The user reviews and approves via terminal (`npm run approve`). The LLM cannot forge approvals or bypass the gatekeeper.

---

## 🛠️ The Tool Surface

Jericho groups capabilities into clean, orthogonal tools across distinct security profiles:

| Profile | Tool Name | Risk Level | Capability & Description |
| :--- | :--- | :---: | :--- |
| **`core_read`** | `jericho.status` | R0 | Inspects server health, limits, active profiles, and metrics. |
| **`core_read`** | `workspace.read` | R0 | Reads multiple files with budget constraints and SHA-256 hashes. |
| **`core_read`** | `workspace.inspect`| R0 | Explores directory trees, file stats, permissions, and metadata. |
| **`core_read`** | `workspace.search` | R0 | Fast grep and glob file searches restricted to authorized roots. |
| **`core_read`** | `git.inspect` | R0 | Reads git status, branches, commits, and diffs cleanly. |
| **`core_read`** | `memory.resume` | R0/R1 | Loads task sessions with automatic staleness detection. |
| **`development`**| `workspace.apply_patch` | R1/R3 | Surgical diff patching with dry-run mode and rollback tokens. |
| **`development`**| `workspace.rollback` | R1 | Atomically reverts previous patches using a `rollback_token`. |
| **`development`**| `terminal.exec` | R1/R4 | Safe process execution with strict allowlists (`node`, `git`, `npm`, `python`, `powershell`). |
| **`development`**| `verify.run` | R1 | Runs isolated test suites and linters with resource limits. |
| **`development`**| `git.commit` | R1 | Creates atomic git commits with explicit file staging. |
| **`development`**| `memory.checkpoint`| R1 | Saves structured work items and validates completion evidence. |
| **`development`**| `memory.propose_rule`| R1 | Proposes global engineering conventions requiring human approval. |
| **`desktop`**    | `desktop.observe` | R2 | Lists windows and captures specific regions with geometry. |
| **`desktop`**    | `desktop.element_action` | R2 | Clicks, drags, and scrolls relative to verified window bounds. |
| **`desktop`**    | `desktop.keyboard` | R3 | Types text or presses hotkeys with secret leak prevention. |
| **`network`**    | `web.fetch_readonly` | R2 | Reads public web pages into clean Markdown with SSRF protection. |
| **`network`**    | `http.call_allowlisted` | R2/R3 | Sends HTTP requests to allowlisted API endpoints by alias. |
| **`admin`**      | `admin.perform_allowlisted_action` | R4 | Executes predefined operator actions with strict approval gates. |

---

## 🚀 Quickstart in 60 Seconds

### 1. Clone and Install Dependencies

```bash
git clone https://github.com/JaviCKP/jericho.git
cd jericho
npm install
```

### 2. Run the Interactive Setup Wizard

```bash
npm run setup
```
*(On Windows, you can simply double-click `setup.bat`)*

The wizard prompts for your OpenAI `CONTROL_PLANE_TUNNEL_ID` and `CONTROL_PLANE_API_KEY`, downloading official binaries and running health diagnostics.

### 3. Launch Jericho

```bash
npm start
```
*(On Windows, you can double-click `start.bat`)*.

### 4. Connect in ChatGPT Web

1. Open [https://chatgpt.com/#settings/Connectors](https://chatgpt.com/#settings/Connectors).
2. Click **Add Application / Connect MCP Server** (`+`).
3. Choose **Tunnel** and select your Jericho tunnel.
4. Done! Open a new chat in ChatGPT Web and start delegating real engineering tasks.

---

## 💬 Real-World ChatGPT Web Workflows

<details>
<summary><b>1. Discovery & Task Resumption ("What were we working on?")</b></summary>

```text
User: What tasks were we working on my machine?

ChatGPT: [Calls memory.resume(action="list_projects")]
Found active projects in your workspace:
📦 PROJECT: ecommerce-platform
   1. [IN_PROGRESS] Cart persistence with Zustand (Rev 3 · 66% completed)
   2. [PAUSED] Stripe Webhook Integration (Rev 1 · New)

Shall we resume the Cart persistence task?
```
</details>

<details>
<summary><b>2. Surgical Code Patching with Automatic Rollback</b></summary>

```text
User: Add localStorage caching to the cart store and run the unit tests.

ChatGPT: 
1. [Calls workspace.apply_patch(dry_run=true)] -> Simulation passed.
2. [Calls workspace.apply_patch] -> Applied to 'src/store/cart.js' (Token: rb_4a71b2).
3. [Calls verify.run(check="test", cwd="ecommerce-platform")] -> Tests failed due to a syntax bug.
4. [Calls workspace.rollback(rollback_token="rb_4a71b2")] -> Restored original file state.
5. Fixed the syntax error and reapplied the patch. All unit tests PASS!
```
</details>

<details>
<summary><b>3. Human Approval Gate for Destructive Actions</b></summary>

```text
User: Wipe the legacy assets directory and clean up dependencies.

ChatGPT: 
To delete the directory 'legacy_assets/', Jericho's security policy requires 
your out-of-band confirmation (Destructive Action R3).
Please run this command in your terminal:
  npm run approve -- apr_91d4e8

Let me know once approved so I can proceed.

User: Done, approved.
ChatGPT: [Retries call with approval_id="apr_91d4e8"] -> Directory deleted successfully.
```
</details>

---

## 🎛️ Human Operator Console (Human-in-the-Loop)

As the human operator, you retain ultimate authority via a dedicated CLI interface independent of LLM context:

```bash
# 1. Manage pending security approvals (R3 / R4 actions)
npm run approve -- --list             # List pending approval requests
npm run approve -- apr_0123456789     # Authorize specific action
npm run approve -- --deny apr_0123    # Reject action

# 2. Manage AI-proposed memory rules
npm run rules                         # List active and proposed rules
npm run rules -- accept prop_123      # Accept proposal into global policy
npm run rules -- reject prop_123      # Reject proposal

# 3. Cryptographic Audit Log Verification
npm run audit -- verify               # Validates hash-chain integrity
npm run audit -- export               # Exports tamper-evident audit journal
```

---

## 🔒 Zero-Trust Security & Threat Mitigation

| Security Layer | Implementation Mechanism | Threat Mitigated |
| :--- | :--- | :--- |
| **Path Confinement** | Canonical `realpath` + `isInside()` checks | *Path Traversal*, Symlink Escape, UNC Relays |
| **Syntactic Sanitization** | Blocks NUL bytes, NTFS ADS `:`, DOS device names | Windows hangs, parser exploits, hidden streams |
| **Credential Broker** | SecretBroker with `.env*` exclusion & regex redaction | API Key and SSH private key exfiltration |
| **Process Isolation** | Strict binary allowlist without shell wrapper | Remote Code Execution via command injection |
| **Network Guard** | Blocks loopback (`127.0.0.1`), RFC 1918, cloud metadata | Server-Side Request Forgery (SSRF) & LAN scans |
| **Audit Integrity** | Append-only SHA-256 hash-chained journal | Log tampering, trace erasure by malicious scripts |

---

## 📚 Deep-Dive Technical Documentation

For in-depth architectural and security analysis, explore the repository documentation:

* 🛡️ **[`THREAT_MODEL.md`](./THREAT_MODEL.md):** Formal STRIDE threat model and mitigation matrix.
* 🏛️ **[`ARCHITECTURE_V2.md`](./ARCHITECTURE_V2.md):** Complete architectural breakdown of the Runtime, Dispatcher, and Chokepoint.
* 🧰 **[`TOOL_CATALOG.md`](./TOOL_CATALOG.md):** Full tool specification with input/output schemas and risk annotations.
* 🔄 **[`MEMORY_MIGRATION.md`](./MEMORY_MIGRATION.md):** Step-by-step guide for migrating v1 Markdown tasks to v2 structured memory.
* 📊 **[`AUDIT.md`](./AUDIT.md):** Baseline security audit report and verified vulnerability closures.

---

## 📄 License

Distributed under the open-source **MIT License**.

Developed by **[JaviCKP](https://github.com/JaviCKP)**.
