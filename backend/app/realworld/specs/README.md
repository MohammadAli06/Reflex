# Vendored OpenAPI fixtures

These small JSON fixtures are intentionally vendored so tests never access the
network. They model a reviewed, JSON-body-compatible GitHub-style issue create
operation. OAuth and multipart operations are out of scope.

## Provenance

| Fixture | Upstream | Pin | Operation | Change |
|---|---|---|---|---|
| `github/old.json` | GitHub REST API, `POST /repos/{owner}/{repo}/issues`, reduced to the fields this harness exercises | reduced fixture — not a verbatim upstream snapshot | `POST /repos/{owner}/{repo}/issues` | requires `title`, no required headers |
| `github/new.json` | same operation, next revision | reduced fixture | same | requires `summary`, requires `X-Tenant-Token` |

These are deliberately **reduced** fixtures rather than full upstream documents:
they carry only the request body, the required header and the 200 response that
the harness reads, so a diff stays reviewable. Before adding a production
benchmark case, record the real upstream commit SHA or release tag here and
vendor the unreduced document. Neither fixture is presented as an official
GitHub artifact.

## Out of scope

Operations using OAuth flows, multipart or form-encoded bodies, or path
parameters without a JSON request body are skipped: the mock validates JSON
requests only and `ActiveSchema.from_openapi` fails closed on anything else.
