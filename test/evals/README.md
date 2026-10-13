# Golden Ask Evals

Run against your paired Codex bridge:

```bash
EVAL_BASE_URL=http://127.0.0.1:41414 \
EVAL_BRIDGE_TOKEN=... \
EVAL_MODEL=your-codex-model \
npm run eval
```

The runner uses semantic article Asks and native bridge streaming. Every Ask
creates its own Codex session with the source article and current intent.
It prints a rubric scorecard and exits nonzero on a hard rubric failure or
backend error. Deterministic fixtures do not establish live model quality.
