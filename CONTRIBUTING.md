# Contributing to Jericho

Thank you for your interest in contributing to **Jericho**! We welcome contributions from developers worldwide to make local agentic computing safer, faster, and more capable.

---

## 🏛️ Development Philosophy & Security First

Jericho is built on a **Zero-Trust Chokepoint Architecture**. Any new feature or tool must adhere to these core principles:

1. **Deterministic Execution:** No arbitrary shell strings. Always pass explicit binary executables and argument arrays.
2. **Path Confinement:** Every filesystem access must be validated through `src/core/workspace/paths.js` against authorized workspace roots.
3. **Secret Isolation:** Never expose credentials, API keys, or `.env` variables to tool outputs. Always route through `src/core/redact.js`.
4. **Structured Output:** Every tool must define a strict `inputSchema` (`additionalProperties: false`) and `outputSchema` adhering to MCP specifications.

---

## 🛠️ Adding New MCP Tools

1. **Define the Tool in the Catalog:**
   Add your tool's schema, risk level, and metadata in `src/tools/catalog.js`:
   ```javascript
   {
     name: 'category.tool_name',
     version: '2.0.0',
     profile: 'development',
     risk: RISK.R1,
     timeoutMs: 30_000,
     description: 'Precise explanation of what the tool accomplishes.',
     annotations: {
       title: 'Human Friendly Title',
       readOnlyHint: false,
       destructiveHint: false,
       idempotentHint: true,
       openWorldHint: false,
     },
     inputSchema: {
       type: 'object',
       properties: {
         param: { type: 'string', description: 'Parameter description.' },
         ...SESSION_PROPS,
       },
       required: ['param'],
       additionalProperties: false,
     },
     outputSchema: out({
       result: { type: 'string' },
     }),
   }
   ```

2. **Implement the Tool Handler:**
   Create or update the implementation in `src/tools/impl/` ensuring it delegates actions to `ctx.runtime` (Runner, Roots, Network Guard, or Memory Store).

3. **Register the Implementation:**
   Export the handler in `src/tools/index.js`.

4. **Add Unit & Security Tests:**
   Add comprehensive tests in `tests/contract/` and `tests/security/`.

---

## 🧪 Running the Test Suite

Before submitting a pull request, ensure all tests pass:

```bash
# Run the complete test suite
node tests/run-all.js

# Run end-to-end evaluation scenarios
node tests/evals/index.js

# Run fast smoke test
npm run smoke
```

---

## 🚀 Pull Request Workflow

1. Fork the repository on GitHub.
2. Create a feature branch (`git checkout -b feat/my-new-feature`).
3. Commit your changes with clear, semantic commit messages (`git commit -m 'feat(exec): add support for rustc verification'`).
4. Push your branch (`git push origin feat/my-new-feature`).
5. Open a Pull Request with a description of your changes and test results.

---

## 📄 Code of Conduct

Be respectful, constructive, and collaborative. We are building the future of autonomous agent runtime security together.
