# Official Xinchao 4.0.0

Source: https://github.com/tianyupaipai-cmd/xinchao-nian
Commit: a38a0a3241b0d3928d4a452ea1a38cf7efa14cd3
Only the upstream `xinchao/` subtree is included. No bundled Ombre deployment.
Psychological parameters are unmodified. A narrowly scoped local compatibility
change to `src/ombre-client.js`, `src/black-box.js`, and the box keep handler in
`src/server.js` targets independent official Ombre 3.6.14: official parameters,
write receipts rather than guessed title IDs, longer write deadlines, no blind
write replay, and a durable per-item keep fence. This first delivery does not
disable the existing automatic dream archive. Its second delivery uses the
independent Ombre dream-archive extension: creation-time hiding, a verified real
bucket ID, and a persistent no-replay claim on the already recorded dream.
The automatic dream-material fallback now explicitly uses Ombre's automatic
mode. Only new dreams are archived; old dreams are not migrated. Native
dreaming and psychological parameters remain
unchanged. See the
[compatibility report](../../../../docs/XINCHAO_OFFICIAL_OMBRE_COMPATIBILITY.2026-10-06.md).
Zer provider hooks and the independently deployed Ombre compatibility bridge
live outside this snapshot. Old Eventide/Codex overlays are not applied.
