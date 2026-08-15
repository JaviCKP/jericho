# 🔒 Security Model & Architecture

**Jericho** provides local operating system execution capabilities to AI models such as **ChatGPT Web** via the Model Context Protocol (MCP). With local agentic execution comes critical responsibility: this document outlines the Zero-Trust security architecture and defense-in-depth mechanisms implemented in Jericho.

---

## 1. Outbound-Only TLS Tunnel Architecture

- **Zero Inbound Ports:** Jericho does not open any local listening ports on your router or public network. It requires no port forwarding, Dynamic DNS, or public IP addresses.
- **Outbound TLS Tunnel:** `tunnel-client` establishes an encrypted outbound connection to OpenAI's infrastructure using industry-standard TLS 1.3.
- **Firewall & NAT Isolation:** Your local MCP server is completely unreachable from the public internet.

---

## 2. Zero-Trust Policy Engine & Risk Scoring

Every single tool invocation is intercepted by the centralized `PolicyEngine` (`src/core/policy/engine.js`) and evaluated against strict risk levels:

- **R0 (Safe Read-Only):** Inspection of workspace structure, file reading, git status, and metrics.
- **R1 (Reversible Project Modification):** Atomic unified diff patching (`workspace.apply_patch`) with `rollback_token` issuance, local git commits, and isolated process execution (`terminal.exec`).
- **R2 (External / State Action):** Web fetching, allowlisted HTTP requests, window observation, and relative mouse actions.
- **R3 (Destructive / Secret / High-Impact):** Directory deletion, raw keyboard typing, or sensitive changes. These operations pause execution and require physical human confirmation.
- **R4 (Privileged / General Access):** Blocked by default.

---

## 3. Filesystem Jailing & Secret Redaction

1. **Authorized Workspace Confinement:**
   - File access is strictly jailed to designated roots (`workspace`, `downloads`, `desktop`, `documents`).
   - Path traversal (`../`), symlink breakouts, NTFS Alternate Data Streams (`file:stream`), and MS-DOS device names (`CON`, `PRN`, `AUX`, `NUL`) are rejected at the canonical `realpath` level.

2. **Hardcoded Sensitive Exclusions:**
   - Files matching `.env*`, `.ssh/`, `.aws/`, `.gnupg/`, `id_rsa`, `.npmrc`, `*.pem`, and `*.key` are physically blocked from reading, searching, or patching — even if placed inside an authorized root.

3. **Secret Redaction Layer:**
   - All tool outputs are automatically sanitized via `src/core/redact.js` to prevent credential exposure or API key leakage in tool outputs.

---

## 4. Safe Process Execution (`terminal.exec` & `verify.run`)

- **No Shell Execution (`shell: false`):** Commands are spawned directly via the OS API (`CreateProcess` / `execFile`) with explicit argument arrays, preventing command chaining (`&`, `|`, `&&`, `;`, `>`).
- **Environment Isolation:** Child processes do **not** inherit `process.env`. They only receive basic system variables (`PATH`, `TEMP`, `SystemRoot`). Server secrets and tunnel keys are never leaked to child processes.
- **Subcommand Filtering:** Dangerous subcommands (such as `npm run approve`, `git push`, `npm publish`) are rejected with `COMMAND_NOT_ALLOWED`.

---

## 5. Out-of-Band Human Approvals (`npm run approve`)

When a tool call requires human authorization (risk level R3):
1. Jericho pauses the operation and generates a unique, one-time `approval_id` (e.g., `apr_91d4e8`).
2. The human operator reviews the exact action details in a separate terminal and approves or denies it:
   ```bash
   npm run approve -- apr_91d4e8
   ```
3. The LLM cannot fabricate or forge approvals.

---

## 6. Reporting Security Vulnerabilities

If you discover a security vulnerability in Jericho, please do not open a public issue. Instead, report it directly to the maintainer at **[JaviCKP](https://github.com/JaviCKP)** via GitHub Security Advisories or private contact.
