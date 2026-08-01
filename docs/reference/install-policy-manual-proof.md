---
summary: "Reviewer proof for protocol-v1 install-policy allow, warn, acknowledgement, re-evaluation, and block behavior"
read_when:
  - Reviewing changes to security.installPolicy
  - Reproducing the ClawScan install-policy integration
title: "Install policy manual proof"
---

# Install policy manual proof

This proof exercises the real OpenClaw install lifecycle with the ClawScan
adapter built from its merged source. It does not replace the policy command
with a fixture.

The disposable assets live in
`docs/assets/install-policy-proof`. They are not shipped profiles,
runtime dependencies, or scanner registrations.

## Verified result

The 2026-08-01 proof used:

- OpenClaw runtime commit `10ccce25db8f3eaf7c506ed95998297ab7c314ae`
  before the evidence-only follow-up edit to this document.
- ClawScan adapter commit
  `e63bacb73e8ede8a166dd0d61267bdb07596972a`, with
  `13c6cb59b58176b6ed23f0514d5bca095f715eda` immediately below it.
- A native arm64 ClawScan binary at
  `/private/tmp/openclaw-install-policy-proof.ikuMIP/bin/clawscan`, SHA-256
  `b77644f53b4466e2cc316ebe30cdabd9bfae10a63ff82751cfb5d60d7c1d83ca`.
- Node.js `25.9.0`, Docker client `29.6.2`, and Docker server `29.6.1`.

Observed lifecycle behavior:

| Case                                                  | Policy result                                | OpenClaw result                                                                                                   |
| ----------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Benign local skill and plugin                         | `allow`                                      | Both installed                                                                                                    |
| Prompt-injection plugin, no acknowledgement           | `warn`                                       | Warning and finding shown; nonzero exit; config unchanged; staged npm root removed                                |
| Same plugin with `--dangerously-force-unsafe-install` | `warn` at package and dependency-tree stages | Both stages re-evaluated; plugin and dependency installed; config committed                                       |
| Destructive skill with the same flag                  | `block`                                      | Nonzero exit; no target committed                                                                                 |
| Interactive prompt-injection plugin                   | `warn` at package and dependency-tree stages | Each stage paused before commit; each `y` triggered policy re-evaluation; install followed second acknowledgement |

The multi-stage npm proof output included two separate warning pairs before
commit:

```text
Install policy: clawscan-static fired rule prompt-injection-warning
Install policy warning: ClawScan gate reported warnings for the staged installation
Install policy: clawscan-static fired rule prompt-injection-warning
Install policy warning: ClawScan gate reported warnings for the staged installation
Installed plugin: policy-proof-plugin
```

The interactive prompt at each npm stage was:

```text
Install after this policy warning?
ClawScan gate reported warnings for the staged installation
• [WARN · clawscan-static.prompt-injection-warning] clawscan-static fired rule prompt-injection-warning
  ↳ findings[].id="static.prompt_injection" [y/N]
```

While both prompts were waiting, the config remained byte-identical to its
pre-install value, no plugin config entry existed, and no activated plugin
target existed. After the first `y`, OpenClaw re-evaluated the installed
dependency tree and paused at the second warning. Only the second `y` allowed
the install and config commit. The policy runtime's focused test also proves
that a new `block` on re-evaluation remains terminal.

A direct adapter invocation emitted exactly one newline-terminated protocol-v1
JSON response on stdout and no diagnostics on stdout. The response was
`decision: "warn"` with the Semgrep rule in bounded findings; stderr was empty
for that successful invocation.

The BYOS composition completed both Semgrep and TruffleHog for all three
fixtures. ClawScan mapped them to deterministic `pass`, `warn`, and `block`
gates, and OpenClaw then reproduced `allow`, acknowledged `warn`, and terminal
`block` behavior without knowing either scanner identity.

## Prerequisites

- A checkout of this OpenClaw branch.
- Git, Go, npm, pnpm, `jq`, and a Node.js version accepted by this checkout.
- Docker for the optional BYOS composition proof.
- Port `4873` free for the disposable npm registry.

Run the following from the OpenClaw checkout:

```bash
export OPENCLAW_CHECKOUT="$(pwd -P)"
export ASSET_ROOT="$OPENCLAW_CHECKOUT/docs/assets/install-policy-proof"
export PROOF_ROOT=/private/tmp/openclaw-install-policy-proof

test -f "$OPENCLAW_CHECKOUT/openclaw.mjs"
test -d "$ASSET_ROOT"
test ! -e "$PROOF_ROOT"
mkdir -p "$PROOF_ROOT/bin" "$PROOF_ROOT/state" "$PROOF_ROOT/workspace"
```

Do not reuse a real OpenClaw state directory or workspace for this proof.

## Build the merged ClawScan adapter

There is no released ClawScan package containing this adapter yet, so build the
exact merged source:

```bash
git clone https://github.com/openclaw/clawscan.git "$PROOF_ROOT/clawscan"
git -C "$PROOF_ROOT/clawscan" checkout --detach e63bacb73e8ede8a166dd0d61267bdb07596972a

test "$(git -C "$PROOF_ROOT/clawscan" rev-parse HEAD)" = \
  e63bacb73e8ede8a166dd0d61267bdb07596972a
test "$(git -C "$PROOF_ROOT/clawscan" rev-parse HEAD^)" = \
  13c6cb59b58176b6ed23f0514d5bca095f715eda

(
  cd "$PROOF_ROOT/clawscan"
  TMPDIR=/private/tmp go test -count=1 ./internal/installpolicy ./internal/profiles
  go build -o "$PROOF_ROOT/bin/clawscan" ./cmd/clawscan
)

test -x "$PROOF_ROOT/bin/clawscan"
test ! -L "$PROOF_ROOT/bin/clawscan"
file "$PROOF_ROOT/bin/clawscan"
shasum -a 256 "$PROOF_ROOT/bin/clawscan"
```

`TMPDIR=/private/tmp` avoids macOS spelling the same temporary directory as
both `/var/...` and `/private/var/...` in a direct ClawScan fixture assertion.
The production path resolver canonicalizes the scan root.

## Prepare the native fixtures and complete OpenClaw config

```bash
cp "$ASSET_ROOT/clawscan-static.yml" "$PROOF_ROOT/clawscan-static.yml"
cp -R "$ASSET_ROOT/fixtures" "$PROOF_ROOT/fixtures"
cp -R "$ASSET_ROOT/registry" "$PROOF_ROOT/registry"
mkdir -p "$PROOF_ROOT/registry/artifacts"

npm pack "$PROOF_ROOT/registry/dependency" \
  --pack-destination "$PROOF_ROOT/registry/artifacts"
npm pack "$PROOF_ROOT/registry/plugin" \
  --pack-destination "$PROOF_ROOT/registry/artifacts"

node "$PROOF_ROOT/registry/server.mjs" "$PROOF_ROOT/registry" 4873 \
  >"$PROOF_ROOT/registry.stdout.log" \
  2>"$PROOF_ROOT/registry.stderr.log" &
echo "$!" >"$PROOF_ROOT/registry.pid"

sed "s|__PROOF_ROOT__|$PROOF_ROOT|g" \
  "$ASSET_ROOT/openclaw-static.json.template" \
  >"$PROOF_ROOT/state/openclaw.json"

export OPENCLAW_STATE_DIR="$PROOF_ROOT/state"
export OPENCLAW_CONFIG_PATH="$PROOF_ROOT/state/openclaw.json"
export TMPDIR=/private/tmp
export NPM_CONFIG_REGISTRY=http://127.0.0.1:4873
export npm_config_registry=http://127.0.0.1:4873

node "$OPENCLAW_CHECKOUT/openclaw.mjs" config validate
npm view openclaw-policy-proof-plugin@1.0.0 version
```

The rendered config points `security.installPolicy.exec.command` at the
absolute, non-symlink ClawScan binary. Its arguments select the operator-owned
profile explicitly. Diagnostics stay on stderr; ClawScan stdout contains only
the protocol-v1 response.

## Prove allow

```bash
node "$OPENCLAW_CHECKOUT/openclaw.mjs" skills install \
  "$PROOF_ROOT/fixtures/skill-allow" \
  --force \
  --as proof-allow

test -f "$PROOF_ROOT/workspace/skills/proof-allow/SKILL.md"

node "$OPENCLAW_CHECKOUT/openclaw.mjs" plugins install \
  "$PROOF_ROOT/fixtures/plugin-allow" \
  --force

jq -e '.plugins.entries["policy-proof-allow-plugin"].enabled == true' \
  "$PROOF_ROOT/state/openclaw.json"
```

Expected:

```text
Installed proof-allow from path -> /private/tmp/openclaw-install-policy-proof/workspace/skills/proof-allow
Installed plugin: policy-proof-allow-plugin
```

## Prove visible pause and no pre-acknowledgement commit

In an interactive terminal, run:

```bash
cp "$PROOF_ROOT/state/openclaw.json" "$PROOF_ROOT/config-before-warning.json"

node "$OPENCLAW_CHECKOUT/openclaw.mjs" plugins install \
  openclaw-policy-proof-plugin@1.0.0 \
  --force
```

The npm metadata stage is represented first. The resolved package and
dependency-tree stages follow. When the package scan returns `warn`, OpenClaw
shows the reason and findings and waits for `[y/N]`.

Before answering, use a second terminal:

```bash
cmp "$PROOF_ROOT/config-before-warning.json" "$PROOF_ROOT/state/openclaw.json"
jq -e '.plugins.entries["policy-proof-plugin"] == null' \
  "$PROOF_ROOT/state/openclaw.json"
```

The managed npm directory may exist while OpenClaw is scanning a staged
package. That is not activation or config commit. The byte-identical config and
missing plugin entry are the commit checks.

Answer `n`. Expected: a nonzero exit and no config change. The rejected staged
root is also removed:

```bash
cmp "$PROOF_ROOT/config-before-warning.json" "$PROOF_ROOT/state/openclaw.json"
test ! -e \
  "$PROOF_ROOT/state/npm/projects/openclaw-policy-proof-plugin"
```

## Prove acknowledgement, policy re-evaluation, and multi-stage commit

Only the existing break-glass flag is used:

```bash
node "$OPENCLAW_CHECKOUT/openclaw.mjs" plugins install \
  openclaw-policy-proof-plugin@1.0.0 \
  --force \
  --dangerously-force-unsafe-install
```

Expected:

- the ClawScan warning appears once for the staged package;
- the policy runs again for the installed dependency tree and shows a second
  warning;
- only then does OpenClaw print `Installed plugin: policy-proof-plugin`.

Verify both package and dependency plus the config commit:

```bash
test -f \
  "$PROOF_ROOT/state/npm/projects/openclaw-policy-proof-plugin/node_modules/openclaw-policy-proof-plugin/package.json"
test -f \
  "$PROOF_ROOT/state/npm/projects/openclaw-policy-proof-plugin/node_modules/openclaw-policy-proof-dependency/package.json"
jq -e '.plugins.entries["policy-proof-plugin"].enabled == true' \
  "$PROOF_ROOT/state/openclaw.json"
```

## Prove block remains terminal

```bash
set +e
node "$OPENCLAW_CHECKOUT/openclaw.mjs" skills install \
  "$PROOF_ROOT/fixtures/skill-block" \
  --force \
  --as proof-block \
  --dangerously-force-unsafe-install
block_status=$?
set -e

test "$block_status" -ne 0
test ! -e "$PROOF_ROOT/workspace/skills/proof-block"
```

Expected:

```text
Install policy: clawscan-static fired rule destructive-shell-block
blocked by install policy: ClawScan gate blocked the staged installation
```

The acknowledgement flag never converts `block` or policy failure to `allow`.

## Optional BYOS composition smoke

This exploratory proof keeps OpenClaw unaware of scanner identities. ClawScan
composes two unrelated scanners in its operator-owned profile:

- Semgrep `1.170.0` warns on dynamic `eval`.
- TruffleHog `3.95.9` blocks a generated private key.

No scanner is added to ClawScan's shipped profiles, no repository dependency is
added, and ClawScan's Docker sandbox remains enabled.

The verified image used:

- base:
  `ghcr.io/trufflesecurity/trufflehog@sha256:59b244249d1a1aef4baa24fe73d3c931616264482580d806d77f6c74d26b3e42`;
- local combined image ID:
  `sha256:39251e78900dfb8b7c9da9284995eed5b966e2a3e3f49d22b7f16302d3c0ca3c`;
- Semgrep `1.170.0`;
- TruffleHog `3.95.9`;
- Python `3.12.13`.

Prepare and build:

```bash
cp -R "$ASSET_ROOT/byos" "$PROOF_ROOT/byos"

sed "s|__PROOF_ROOT__|$PROOF_ROOT|g" \
  "$PROOF_ROOT/byos/clawscan-byos.yml.template" \
  >"$PROOF_ROOT/byos/clawscan-byos.yml"

openssl genrsa \
  -out "$PROOF_ROOT/byos/fixtures/block/private-key.pem" \
  2048
chmod 0600 "$PROOF_ROOT/byos/fixtures/block/private-key.pem"

docker build \
  --tag openclaw-policy-proof-scanners:semgrep-1.170.0-trufflehog-3.95.9 \
  "$PROOF_ROOT/byos"

docker image inspect \
  openclaw-policy-proof-scanners:semgrep-1.170.0-trufflehog-3.95.9 \
  --format 'IMAGE_ID={{.Id}} ARCH={{.Architecture}} OS={{.Os}}'
docker run --rm \
  openclaw-policy-proof-scanners:semgrep-1.170.0-trufflehog-3.95.9 \
  semgrep --version
docker run --rm \
  openclaw-policy-proof-scanners:semgrep-1.170.0-trufflehog-3.95.9 \
  trufflehog --version
```

The wrapper preserves the TruffleHog detector name/type and verified state but
does not write raw secret material into ClawScan evidence.

Run all three ClawScan cases:

```bash
for case_name in allow warn block; do
  "$PROOF_ROOT/bin/clawscan" \
    "$PROOF_ROOT/byos/fixtures/$case_name" \
    --config "$PROOF_ROOT/byos/clawscan-byos.yml" \
    --profile byos-install-policy \
    --json \
    --output "$PROOF_ROOT/byos/$case_name-artifact.json" \
    >/dev/null
done

jq '{gate,gateRules}' "$PROOF_ROOT/byos/allow-artifact.json"
jq '{gate,gateRules}' "$PROOF_ROOT/byos/warn-artifact.json"
jq '{gate,gateRules}' "$PROOF_ROOT/byos/block-artifact.json"
```

Expected:

```text
allow: gate=pass, no gateRules
warn:  gate=warn, proof-semgrep.dynamic-eval-warning
block: gate=block, proof-trufflehog.detected-secret-block
```

The scanner-native evidence is available under
`.scanners["proof-semgrep"].raw` and
`.scanners["proof-trufflehog"].raw`. Every scanner status must be `completed`;
a skipped or failed scanner makes the OpenClaw adapter fail closed.

To replay the composition through OpenClaw:

```bash
sed "s|__PROOF_ROOT__|$PROOF_ROOT|g" \
  "$PROOF_ROOT/byos/openclaw-byos.json.template" \
  >"$PROOF_ROOT/state/openclaw.json"

node "$OPENCLAW_CHECKOUT/openclaw.mjs" config validate

node "$OPENCLAW_CHECKOUT/openclaw.mjs" skills install \
  "$PROOF_ROOT/byos/fixtures/allow" \
  --force \
  --as byos-live-allow

set +e
node "$OPENCLAW_CHECKOUT/openclaw.mjs" skills install \
  "$PROOF_ROOT/byos/fixtures/warn" \
  --force \
  --as byos-live-warn
warn_status=$?
set -e
test "$warn_status" -ne 0
test ! -e "$PROOF_ROOT/workspace/skills/byos-live-warn"

node "$OPENCLAW_CHECKOUT/openclaw.mjs" skills install \
  "$PROOF_ROOT/byos/fixtures/warn" \
  --force \
  --as byos-live-warn \
  --dangerously-force-unsafe-install

set +e
node "$OPENCLAW_CHECKOUT/openclaw.mjs" skills install \
  "$PROOF_ROOT/byos/fixtures/block" \
  --force \
  --as byos-live-block \
  --dangerously-force-unsafe-install
block_status=$?
set -e
test "$block_status" -ne 0
test ! -e "$PROOF_ROOT/workspace/skills/byos-live-block"
```

Use the 1,200,000 ms policy timeout in the supplied config. On the verification
host, an earlier 120,000 ms exploratory setting expired while Semgrep was still
using CPU; OpenClaw failed closed and committed nothing.

## Cleanup

Stop the disposable registry, verify the exact proof root, and remove it:

```bash
kill "$(cat /private/tmp/openclaw-install-policy-proof/registry.pid)"
test "$PROOF_ROOT" = /private/tmp/openclaw-install-policy-proof
rm -r -- /private/tmp/openclaw-install-policy-proof
```

Optionally remove only the disposable scanner image:

```bash
docker image rm \
  openclaw-policy-proof-scanners:semgrep-1.170.0-trufflehog-3.95.9
```

Do not run cleanup against a real OpenClaw state directory.
