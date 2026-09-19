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

Applied in `getMessageModel` / `getChatModel`, `Message` from/to/author, and the
`sendMessage` return (`Msg.get(newMsgKey._serialized)` returned `undefined` after
the rename, so the send response came back with a null message id).

**API contract:** unchanged. Responses keep every original field
(`id._serialized`, `remote`, `id`, `fromMe`, `from`, `to`, ...). The only
difference is an additive raw `$1` field alongside `_serialized` (same value).

**Also includes (media send fix):** WhatsApp Web build `2.3000.1047xxx`
(seen 2026-09-17) gave the `MediaData` model its own private `__x_id`.
`sendMessage` spreads the media model into the outgoing message, so that key
overwrote the Msg's id and every media send (image, video, audio, document)
failed with `Data passed to getter must include an id property (it's how we
memoize) but got undefined`. Text sends were unaffected. Backports upstream PR
[wwebjs/whatsapp-web.js#201923](https://github.com/wwebjs/whatsapp-web.js/pull/201923)
(unmerged as of 2026-09-18): `delete message.__x_id` right after the message
object is built.

**Version guard:** the Dockerfile applies this patch only when the installed
`whatsapp-web.js` is exactly `1.34.7`. Any other version is skipped with a log
line, so bumping the dependency will not break the build.

## `puppeteer-core+24.38.0.patch`

**Why:** during page load WhatsApp Web briefly creates an out-of-process iframe.
`page.exposeFunction` installs each binding into every frame, and when that
iframe closes mid-call puppeteer throws
`TargetCloseError: Protocol error (Page.addScriptToEvaluateOnNewDocument): Target closed`.
wwebjs runs `attachEventListeners()` inside the `onAppStateHasSyncedEvent`
callback, so the throw aborts it silently: `Msg.on('add')` is never registered,
`ready` never fires, and the session looks CONNECTED but emits no `message` /
`message_create` events (no webhooks). Seen on session `main` from 2026-09-18,
failing about half of all starts; captured and verified 2026-09-19.

**What it does:** backports upstream puppeteer commit
[`e29c4e7`](https://github.com/puppeteer/puppeteer/commit/e29c4e7) (#15300,
"do not fail a per-frame fan-out when an OOP iframe goes away") into the CJS
build of puppeteer-core 24.38.0. Per-frame calls in `addExposedFunctionBinding`,
`removeExposedFunctionBinding` and `evaluateOnNewDocument` now ignore a
`TargetCloseError` from an out-of-process frame's own session. Errors from the
main page session are still thrown. The fix only ships in puppeteer 25.x, and
wwebjs 1.34.7 pins puppeteer to exactly 24.38.0.

**Version guard:** applied only when the installed `puppeteer-core` is exactly
`24.38.0`, otherwise skipped with a log line.

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
