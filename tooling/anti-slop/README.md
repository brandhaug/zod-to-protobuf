# Vendored anti-slop plugin

`plugin.mjs` and `license.md` are unchanged copies of
`config/oxlint/anti-slop/` from the npm package `ultracite@8.0.1`.
The bundle identifies its [upstream source](https://github.com/dmmulroy/anti-slop)
at commit `13909c9e07590f5a85d93c62712259fe14a883f7`.

Only this self-contained plugin is used here. Vendoring it removes Ultracite's
CLI dependencies, including `braces`, which has no patched version for
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
The oxlint rules remain enabled in `.oxlintrc.json`.

## Updating

Download a reviewed Ultracite release with `npm pack ultracite@<version>` in a
temporary directory. Extract `package/config/oxlint/anti-slop/plugin.mjs` and
`license.md`, review their diff, and copy both files here. Keep the bundle and
licenses unmodified, update this provenance record, then run `npm run validate`.
Lint and formatting exclude these upstream copies to preserve their bytes.

SHA-256 for the current copies:

```text
9bfb19ea9e86908fdf930103d3f1ee0825e0e0eabdf016ac54bc96ab871884c4  plugin.mjs
2e796f3c65c1ee8f034add8eac12a1a9d29aecede719ec12d9e0c37a62a2b206  license.md
```
