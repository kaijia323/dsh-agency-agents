# Vendored corpus provenance

The markdown under `agency-agents-zh/` is a snapshot of the upstream community project.
It is vendored rather than fetched so the plugin works offline and so a run is
reproducible. `tools/vendor.mjs` is the only thing that may rewrite it.

| field | value |
| --- | --- |
| upstream | https://github.com/jnMetaCode/agency-agents-zh |
| upstream version | 1.4.0 |
| commit | e00aed9f77ad66156af20e1acfdd69a51596b4da |
| vendored on | 2026-09-12 |
| roles | 277 |
| departments | 20 |
| markdown files | 293 |
| license | MIT (upstream LICENSE copied beside the content) |

## Roles per department

| department | roles |
| --- | --- |
| academic | 6 |
| company | 7 |
| design | 10 |
| engineering | 42 |
| finance | 9 |
| game-development | 20 |
| gis | 13 |
| hr | 2 |
| legal | 2 |
| marketing | 43 |
| paid-media | 7 |
| product | 5 |
| project-management | 7 |
| sales | 9 |
| security | 10 |
| spatial-computing | 6 |
| specialized | 58 |
| supply-chain | 5 |
| support | 7 |
| testing | 9 |

## What is deliberately not vendored

`assets/`, `evals/`, `examples/`, `integrations/`, and `scripts/` — the upstream
repository's sponsor images, gallery, per-tool conversion output, and tooling. They
are most of its weight and none of this plugin's behaviour. The `strategy/`
documentation *is* vendored: it is the orchestration manual the playbooks load.

## Refreshing

```sh
node tools/vendor.mjs --from https://github.com/jnMetaCode/agency-agents-zh
npm test   # the roster assertions pin the counts recorded above
```

A refresh that changes the role count must update the expectations in
`test/roster.test.js` and `test/persona.test.js` in the same commit.
