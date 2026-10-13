---
name: nenu-onboarding
description: Check a Nenu install on this host item by item (plugin, bridge service, tailnet front door, access gates, Web Push, Claude hooks, status line, operator files, updates), report what is done and what is missing, and finish each missing item through Nenu's own Herdr actions with the operator's OK. Use when setting up Nenu, finishing a Nenu install, or asking what is left to configure.
---

# Nenu onboarding

Run on the host where Herdr and Nenu run, not on the phone. Check every item read-only first, print
one checklist, then offer the missing items one at a time. End with what the operator still does on
the phone.

## Rules

- Every check below is read-only. Run them all before offering anything.
- Ask before any step that restarts the bridge, changes a file or sends a notification. One item per
  question. After a fix, re-run that item's check and show the result.
- Never print secrets: `.env` values, the Claude hook token (`NENU_HOOK_TOKEN` in Claude's
  `settings.json`), VAPID keys, push subscription endpoints. Never `cat` `.env`, Claude's
  `settings.json` or `push-subscriptions.json`. List `.env` key names only.
- Never run `tailscale funnel`. Never pass `--force` to `push-keys` unless the operator asks for new
  keys knowing every phone must re-enable notifications.
- Complete items through Herdr actions: `herdr plugin action invoke <action> --plugin "$ID"`. Use
  `bash "$ROOT/scripts/collie-ctl.sh" <verb>` only for a verb that has no action (`qr`, `logs`) or an
  action missing from `herdr plugin action list --plugin "$ID"`.
- An item you cannot check read-only is reported as "can't check", never as done.
- The checks use `jq`. If it is missing, parse the same fields with `bun -e`.

## 0. Context

```sh
herdr --version                       # needs 0.7.0+
herdr plugin list --json | jq -r '.result.plugins[]
  | select(.plugin_id == "herdr.nenu" or .plugin_id == "herdr.collie")
  | "\(.plugin_id) \(.plugin_root) \(.version) \(.source.kind)"'
```

- `ID` is the `plugin_id` printed. `herdr.nenu` is 1.0 or newer; `herdr.collie` is an install from
  before 1.0, which still answers to the old id (`.adr/0068-the-plugin-is-herdr-nenu-and-internal-names-stay.md`).
  Use the printed id in every command.
- `ROOT` is `plugin_root`, the checkout that is the plugin. `kind` `github` is a Herdr-managed
  install, `local` a linked clone.
- `CFG="$(herdr plugin config-dir "$ID")"` holds `.env` and the operator files. `config-dir` prints a
  path for any id, installed or not, so it never proves the plugin is installed. "`.env` lists X"
  below means X appears in `sed -n 's/^\([A-Z_][A-Z0-9_]*\)=.*/\1/p' "$CFG/.env"`, which prints key
  names and no values.
- `STATE="$HOME/.local/state/collie"` (every version keeps that name), or the `COLLIE_STATE_DIR` value
  if `.env` lists that key. It is a path, not a secret.
- `LOGIN="$(tailscale status --json | jq -r '.User[(.Self.UserID|tostring)].LoginName')"` and
  `NAME="$(tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")')"`.
- `PORT` is the port on the `local` line of the `status` banner (default 8787), and
  `B="http://127.0.0.1:$PORT"`.
- `S="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"`, Claude's user settings. Repeat the Claude
  checks for every profile the operator uses.

`herdr plugin action invoke` returns as soon as the action starts. Read its output from the log:

```sh
act() {  # usage: act <action>; prints status, stdout and stderr of that one run
  local log out
  log=$(herdr plugin action invoke "$1" --plugin "$ID" | jq -r '.result.log.log_id // empty')
  [ -n "$log" ] || { echo "invoke failed: is '$1' in herdr plugin action list?"; return 1; }
  for _ in $(seq 1 600); do   # update rebuilds the UI; give it minutes
    out=$(herdr plugin log list --plugin "$ID" --limit 20 | jq -c --arg id "$log" '.result.logs[] | select(.log_id == $id)')
    [ -n "$out" ] && [ "$(jq -r .status <<<"$out")" != running ] && break; sleep 1
  done
  jq -r '"[\(.status) exit=\(.exit_code)]", .stdout, .stderr' <<<"$out"
}
```

`status`, `url` and `version` need no OK. The first action run as `herdr.nenu`, these included,
copies the old `herdr.collie` config dir over once; that carry-over is intended.

```sh
paths_exist() {  # usage: <commands> | paths_exist <script name>; reports each script path a hook runs
  grep -oE "'[^']*/scripts/$1'" | tr -d "'" | sort -u \
    | while read -r p; do [ -f "$p" ] && echo "ok $p" || echo "missing $p"; done
}
```

## 1. Checklist

For each item: the check, what done looks like, and what completes it.

### Plugin installed

- Check: step 0.
- Done: one line for `herdr.nenu` or `herdr.collie`.
- Missing: offer `herdr plugin install frizynn/nenu`, then `start`. A raw `Os { code: 2, kind: NotFound }`
  from any `herdr plugin` command means the Herdr server is not running; start Herdr first.
- A `herdr.collie` install is reported as "works, pre-1.0" and handled under Updates.

### Bridge service

- Check: `act status`. Then the supervisor:
  - macOS: `launchctl print "gui/$(id -u)/$ID" | grep -E '^\s*(state|pid) ='`
  - Linux: `systemctl --user is-active nenu` (pre-1.0 unit: `collie`) and
    `loginctl show-user "$USER" -p Linger`.
- Done: the banner says `✓ Nenu is running`, the service line says `active`, and on Linux `Linger=yes`
  if the host must serve Nenu without a login session.
- Missing: offer `start` (builds if needed, starts the service, publishes the tailnet URL). A banner
  saying `⚠ Nenu isn't answering` needs the log, not another start: `bash "$ROOT/scripts/collie-ctl.sh" logs`.
  Lingering is `loginctl enable-linger "$USER"`, which the operator runs.

### Tailnet front door and URL

- Check: `act url` and `tailscale serve status`. If `.env` lists `COLLIE_SKIP_SERVE`, the operator runs
  their own proxy or tunnel: report "own front door" and check it against `DEPLOYMENT.md` instead.
- Done: `url` prints `https://$NAME` (or `https://$NAME:<COLLIE_SERVE_PORT>`), and `serve status` maps
  that URL to `http://127.0.0.1:$PORT` with `(tailnet only)`. The `status` banner's `tailnet` line
  carries no `(unreachable from other devices)` note.
- Missing: offer `restart`, which re-runs `tailscale serve`. If it prints `note: tailscale serve failed`,
  the fix is on the operator's side: `sudo tailscale set --operator=$USER`, `tailscale up`, or
  `COLLIE_SERVE_MODE=http` for tailnets without HTTPS certificates (which disables PWA install and
  push). An `unreachable` note is the tailnet policy, fixed in the Tailscale admin console.
- Any Nenu mapping that is not `(tailnet only)` is a stop: tell the operator and do nothing else
  until it is removed.

### Identity gate and host allowlist

- Check, against the local bridge:

  ```sh
  code() { curl -s -o /dev/null -w '%{http_code}\n' "$@"; }
  code "$B/api/config"                                                          # no identity
  code -H "Tailscale-User-Login: $LOGIN" -H "Host: $NAME" "$B/api/config"       # tailnet name
  code -H "Tailscale-User-Login: $LOGIN" -H 'Host: allowlist-probe.invalid' "$B/api/config"
  ```

  A `403` body names the reason; read it with `curl -s` only when the code is `403` (a `200` body
  carries the VAPID public key and operator rows).
- Done: no identity answers `403` (`identity required`), so `COLLIE_TRUSTED_USER` is set; the tailnet
  name answers `200`; the bogus host answers `403` (`host not allowed`).
- Missing:
  - No identity answers `200` and `.env` lists no `COLLIE_TRUSTED_USER_OPTIONAL`: anyone on the
    tailnet can drive every pane. Offer to add
    `COLLIE_TRUSTED_USER=$LOGIN` to `$CFG/.env` (confirm the login with the operator), then `restart`.
  - `identity not trusted` with `$LOGIN`: the gate is set to another login. Ask which one is right.
  - The tailnet name answers `host not allowed`: discovery missed it. Offer `restart`; if it persists,
    set `COLLIE_TAILSCALE_HOSTS` in `.env`.
  - The bogus host answers `200`: `.env` has `COLLIE_ALLOW_ANY_HOST`. Report it; removing it is the
    operator's call.
- Under `COLLIE_SKIP_SERVE` the identity header plays no part; report it as "not used".

### Device gate (optional)

- Check: `curl -s -H "Tailscale-User-Login: $LOGIN" "$B/api/snapshot" | jq 'has("device")'` and whether
  `.env` lists `COLLIE_DEVICE_HEADER` and `COLLIE_DEVICE_ALLOWLIST`.
- Done: `false` with neither key on a plain `tailscale serve` setup ("not used", which is normal), or
  `true` with both keys behind a proxy that injects the header.
- Missing: the header without an allowlist makes every device read-only. The gate needs a proxy in
  front (`DEPLOYMENT.md`, variants B to D); nothing here sets it up. Report and point there.

### Web Push

- Check:

  ```sh
  curl -s -H "Tailscale-User-Login: $LOGIN" "$B/api/config" | jq '{push, build}'
  sed -n 's/^\(COLLIE_VAPID_[A-Z_]*\)=.*/\1/p' "$CFG/.env"               # key names only
  jq length "$STATE/push-subscriptions.json" 2>/dev/null || echo 0      # count only
  ```

- Done: `push: true` and at least one subscription. `COLLIE_VAPID_SUBJECT` is optional.
- Missing, in order, each with its own OK:
  1. No `COLLIE_VAPID_PUBLIC`/`_PRIVATE`: `push-keys`. To set a contact address too, the shell form
     takes it: `bash "$ROOT/scripts/collie-ctl.sh" push-keys mailto:you@example.com`.
  2. Keys present but `push: false`: `restart` (keys are read at start).
  3. Zero subscriptions: a phone step, listed at the end.
  4. Once a phone is subscribed: `push-test` sends one notification to every subscribed device.
- Push needs HTTPS. With `COLLIE_SERVE_MODE=http` report push as unavailable instead of offering keys.

### Claude live status hooks (optional)

- Check, without printing the file (it holds the hook token):

  ```sh
  jq '[.hooks // {} | .[] | .[]? | .hooks[]? | select((.url? // "") | endswith("/api/hooks/claude"))] | length' "$S"
  ls "$STATE/claude-hooks.token"
  ```

- Done: a count above 0 and the token file present.
- Missing: offer `claude-hooks`. It backs up `settings.json`, keeps every other hook, and only new
  Claude sessions load it. `claude-hooks-remove` undoes it.

### Claude subagent hooks (optional)

- Check: the hook command, and that the script it runs still exists (a hook installed from a removed
  worktree breaks silently):

  ```sh
  jq -r '.hooks.SubagentStart[]?.hooks[]?.command, .hooks.SubagentStop[]?.hooks[]?.command' "$S" \
    | paths_exist subagent-hook.ts
  ```

- Done: an `ok` line, ideally under `$ROOT`.
- Missing or `missing`: offer `subagent-hooks`. It backs up `settings.json` and keeps other hooks.

### Claude status line (optional)

- Check: `jq -r '.statusLine.command // empty' "$S" | paths_exist claude-statusline.ts`. A
  project-level `statusLine` overrides the user one.
- Done: an `ok` line. It feeds the composer's context and usage figures.
- Missing: there is no action. Offer `bun "$ROOT/scripts/install-claude-statusline.ts"`, run from
  `$ROOT` so the wrapper points at the plugin checkout. It backs up settings and keeps the operator's
  own status line command. A custom profile takes `<settings.json> <state dir>` as arguments.

### Operator files (optional)

- Check: `ls "$CFG"` for `commands.toml`, `keys.toml`, `quick-replies.toml`, and
  `curl -s -H "Tailscale-User-Login: $LOGIN" "$B/api/config" | jq '{c: (.operatorCommands|length), k: (.operatorKeys|length), q: (.operatorQuickReplies|length)}'`.
- Done: each file present has a nonzero count. Absent files mean the shipped defaults, which is fine.
- Missing: a file with count 0 has rejected rows; the log names them
  (`bash "$ROOT/scripts/collie-ctl.sh" logs`). To start one, offer
  `cp "$ROOT/commands.toml.example" "$CFG/commands.toml"` (same for `keys` and `quick-replies`) and let
  the operator edit it. Edits are live, no restart. Grammar: `docs/USER_GUIDE.md`, "Your own slash
  commands" and the two sections after it.

### Updates

- Check:

  ```sh
  act version
  git -C "$ROOT" symbolic-ref -q --short HEAD || echo detached     # branch = linked clone
  git -C "$ROOT" ls-remote --tags --refs origin 'v*' | awk '{sub("refs/tags/v","",$2); print $2}' \
    | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -t. -k1,1n -k2,2n -k3,3n | tail -3
  ```

- Done: the running version equals the newest stable tag of its major and no newer major exists.
  A linked clone updates from its branch's upstream, so the tags are a hint there.
- Missing:
  - Newer release in the same major: offer `update` (advances the checkout, rebuilds, restarts).
  - Newer major: link the release notes (https://github.com/frizynn/nenu/releases), then offer
    `update-major` as its own question. It is the operator's consent to a breaking change.
  - A `herdr.collie` install crosses to 1.0 with `update-major --plugin herdr.collie`. After it the
    plugin answers to `herdr.nenu`: re-run step 0 and every check with the new id.
- Optional: `COLLIE_UPDATE_REPO=frizynn/nenu` in `.env` lets the phone's Settings report new releases.

## 2. Report

Print one table before offering anything:

| Item | State | Evidence | Completes it |
| --- | --- | --- | --- |

State is one of `done`, `missing`, `not used`, `can't check`. Evidence is the observed value (status
code, count, banner line), never a secret. Then offer the missing items in the order of the
checklist, one question each.

## 3. Phone

Finish with the steps still open. A push subscription count above 0 means a phone already did 1 to 4.

1. Install Tailscale on the phone and connect it to the same tailnet as the host.
2. Open the `url` output in Safari (iPhone) or Chrome (Android). For a QR code:
   `bash "$ROOT/scripts/collie-ctl.sh" qr`.
3. iPhone: Share, then Add to Home Screen, and open Nenu from the icon. iPhone only delivers web push
   to an app installed this way. Android: menu, then Install app.
4. In Nenu: Settings, This device, Push notifications on, and allow the prompt. Then ask the agent to
   run `push-test`.
5. Check that the build stamp in Settings, About, matches `version`.
