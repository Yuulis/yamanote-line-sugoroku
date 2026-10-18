# Tokyo suburban assembled stage

This handoff contains the frozen S4 cross-operator stage. Its expected catalogue and counts come from the verified frozen research catalog and freeze manifest.

- Services: 135
- Station groups: 1586
- Service stop rows: 2142
- Service route pairs: 2009
- Directed segments: 3988
- Gate report SHA-256: b324a5d69deff266a4348ea827bdb4b94750ad074eb14f0815f571bbbb0a4ee0

## Verification commands

```bash
uv run python -m scripts.data_pipeline.stage_suburban_assembly gate --out-dir .claude/logs/s4/gate
uv run python -m scripts.data_pipeline.stage_suburban_assembly audit --data-dir .claude/logs/s4/gate
uv run python -m scripts.data_pipeline.stage_suburban_assembly handoff --data-dir .claude/logs/s4/gate
```

S5 must merge these staged overrides into a fresh product build and restore approved gameplay settings. Do not publish a stage artifact or relabel its manifest.
