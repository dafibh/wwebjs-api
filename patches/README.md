# Local library patches

Patches applied to `node_modules` at Docker build time. Applied by the `deps`
stage in the root `Dockerfile` (default build only; the `USE_EDGE=true` build
installs `whatsapp-web.js` from git `main` and is **not** patched).

## `whatsapp-web.js+1.34.7.patch`

**Why:** WhatsApp Web build `2.3000.1043xxx` renamed the internal WID / MsgKey
property `_serialized` to `$1`. `whatsapp-web.js@1.34.7` (latest published) still
reads `_serialized`, so every chat/message operation that goes through the
injected layer (`getChats`, `getChatById`, `fetchMessages`, `downloadMedia`,
message `delete`, etc.) throws a minified `r` error and returns HTTP 500.

**What it does:** backports the dual-compat shim from upstream PR
[wwebjs/whatsapp-web.js#201840](https://github.com/wwebjs/whatsapp-web.js/pull/201840)
(unmerged as of 2026-07-16). Adds two helpers in `Injected/Utils.js`:
- `widSerialized(wid)` - reads `_serialized`, falls back to `$1`.
- `normalizeSerialized(obj)` - mirrors `$1` onto `_serialized` on objects
  returned to Node so existing node-side code keeps reading `id._serialized`.

Applied in `getMessageModel` / `getChatModel` and `Message` from/to/author.

**API contract:** unchanged. Responses keep every original field
(`id._serialized`, `remote`, `id`, `fromMe`, `from`, `to`, ...). The only
difference is an additive raw `$1` field alongside `_serialized` (same value).

**Version guard:** the Dockerfile applies this patch only when the installed
`whatsapp-web.js` is exactly `1.34.7`. Any other version is skipped with a log
line, so bumping the dependency will not break the build.

## How to revert

Preferred: `git revert` the commit that introduced this directory (removes the
patch file and the Dockerfile change together), then rebuild.

When the upstream fix ships in a release, instead:
1. Bump `whatsapp-web.js` in `package.json` to the fixed version and update
   `package-lock.json` (`npm install`).
2. Delete this `patches/` directory.
3. Revert the `deps`-stage patch block in the root `Dockerfile`.
4. Rebuild: `docker compose build api && docker compose up -d --force-recreate`.

Note: even if step 2/3 are skipped, the version guard makes the patch a no-op
once the version is no longer `1.34.7` - so a plain version bump is safe on its
own, and the cleanup can follow later.
