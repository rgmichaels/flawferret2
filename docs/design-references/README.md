# Design references

Drop screenshots/exports of visual explorations here (e.g. from Claude
Design) before asking `graphic-designer` to work from them — one
subdirectory per topic:

```
docs/design-references/
  framework-builder-facelift/
    broadsheet-theme-turn2a.png
    ...
```

`graphic-designer` reads image files directly (it has the `Read` tool,
which can view PNG/JPG) — it checks this directory and any file path
handed to it in the task. It reasons about a reference rather than
transcribing it: what fits flawferret2 as a dense operational tool gets
adopted, what doesn't (decorative chrome, low information density) gets
explicitly called out and rejected in the resulting spec.

These are working references, not final specs — the actual spec `coder`
implements from lives in `docs/specs/design-<topic>.md`.
