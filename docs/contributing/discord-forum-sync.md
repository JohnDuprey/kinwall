# Discord forum and GitHub Issues

The standalone bridge under `tools/discord-sync/` connects a Discord forum to a
repository. It uses Node 24's built-in SQLite and HTTP APIs; there are no npm packages
to install. This is community tooling, separate from Kinwall family data and releases.

## Behavior

* Existing and new human-created forum posts become issues. Existing replies are
  imported in chronological order, with authors, timestamps, and source links.
* GitHub issues with the configured `discord` label become forum posts. Unlabeled
  issues do not create new posts. Removing the label later does not unlink an existing pair.
* Replies flow both ways. Source edits update the bridge-owned copy. Long GitHub
  replies are split without dropping text; shortened replies replace unused continuations
  with an edit notice. Mentions do not ping people or roles.
* GitHub controls issue status. Each linked forum post has a bot-owned link/status
  card. Closing/reopening an issue updates the card. Archiving, locking, deleting, or
  reopening a Discord post never changes a GitHub issue's status or deletes an issue.
* For Discord-origin posts, edits to the starter or title update the issue. Concurrent
  edits on GitHub produce a conflict warning and preserve both copies. GitHub changes
  remain visible in the status card. For GitHub-origin posts, GitHub controls the forum
  title and bot-owned starter description. A human starter in Discord is never edited.
* Optional forum tags map to GitHub labels. For Discord-origin posts, Discord controls
  these mapped labels; unrelated GitHub labels remain. For GitHub-origin posts, GitHub
  controls mapped forum tags; unmapped tags remain. This avoids label/tag echo loops.
* Deletions do not propagate. A deleted destination is not silently recreated.
  Mappings remain in SQLite and the private report identifies missing copies when an
  update needs them. Deleting the source retains the copied history.
* Bot/webhook-authored Discord messages are not imported. Other GitHub bots' comments
  can be mirrored. Bridge-authored comments carrying the exact origin marker are skipped.

Polling defaults to once a minute. Each pass reads active and archived forum posts,
all messages in those posts, all repository issues, and comments on linked issues.
This favors dependable recovery over a webhook/Gateway service. It is intended for a
small community forum. Pagination stops with an error beyond 10,000 entries per list;
an incomplete snapshot never proceeds as if it were complete. Edits/deletions made
and undone entirely between polls are not an audit log.

## GitHub Actions deployment (recommended)

The included `.github/workflows/discord-sync.yml` runs one finite reconciliation every
15 minutes, at minutes 7, 22, 37, and 52. GitHub issue and comment events also trigger a
pass. GitHub schedules can be delayed or skipped under load, so this is eventual sync,
not an exact 15-minute delivery guarantee. Scheduled workflows run from the default
branch and can be disabled after 60 days without repository activity in a public repo.
A subsequent pass reads full history and catches up.

This deployment needs no Docker host, custom hostname, webhook endpoint, or personal
GitHub token. It uses the job's built-in `GITHUB_TOKEN`, with `issues: write` and
`contents: write`, and resolves the `github-actions[bot]` identity. The job checks out
trusted default-branch code; issue text is never executed. Pull request comments are
excluded. One concurrency group serializes all manual, scheduled, and event runs.

Configure these repository settings:

* Actions secret `DISCORD_SYNC_BOT_TOKEN`: the Discord bot token.
* Actions variables `DISCORD_GUILD_ID` and `DISCORD_FORUM_ID`: the selected server/forum.
* Optional variables `DISCORD_SYNC_TAG_MAP`, `DISCORD_DEFAULT_TAG`,
  `DISCORD_SYNC_REDACT_TERMS`, and `DISCORD_SYNC_RELATED_ISSUES`, using the JSON formats
  below. These values are passed through environment variables, never interpolated
  into shell commands.
* Leave `DISCORD_SYNC_ENABLED` unset or `false` while reviewing. Once the workflow is
  on the default branch, run **Discord forum sync → Run workflow** with **apply**
  unchecked to preview. Check **apply** for the first import; set
  `DISCORD_SYNC_ENABLED=true` to enable scheduled and issue/comment-event runs.

The first write-enabled run creates the **Discord synchronization data** prerelease,
using the non-version tag `discord-sync-data`. It is explicitly not the latest release
and never creates source-code commits. It stores:

* Immutable screenshot/file assets linked directly from GitHub issues. These are
  release downloads, not expiring Discord CDN links or workflow artifacts.
* The newest three SQLite checkpoints, each in a uniquely named, checksum-verified
  `state-…sqlite` asset. Snapshots contain synchronization mappings, pending write
  intents, and mirrored community content; they do not contain either token or the
  credential file. These assets are public when the repository is public.

Do not delete this prerelease or its attachment assets. Normal software releases can
continue independently. Snapshots are append-only uploads; the bridge never deletes
its only state file before uploading a replacement. It prunes only old state snapshots,
not screenshots. Before every issue/comment/forum-message creation, it uploads the
pending intent. If uploading fails, it stops all further destination writes. A fresh
runner restores the newest snapshot, verifies its checksum, and uses remote origin
markers to recover successful writes. Corrupt or incomplete newest state fails closed;
it does not silently restore an older snapshot and risk duplicates.

An existing storage release with no snapshots requires deliberate initialization after
inspection (the manual **initialize** checkbox). For a paused uncertain operation,
inspect the destination and enter its key in **retry_operation**, with **apply** checked,
only after confirming the destination is absent. Do not delete snapshots to clear a
warning. For conflicting edits, inspect the source and mirrored copy and align the
content using the generated proposal before retrying.

The Actions entry point is `tools/discord-sync/actions.mjs`. Preview mode makes no
remote writes and does not create the prerelease. The runner's local full plan is not
uploaded as a workflow artifact: it can contain community text not yet mirrored.
The terminal logs action types/IDs and warnings. Workflow failure identifies degraded
sync; manually rerun after correcting permissions, rate limits, or pending operations.
A runner killed mid-job still leaves its write-ahead checkpoint on GitHub. After an
abrupt stop, a restored writer lease may need up to two minutes to expire.

Do not run the Docker/standalone daemon at the same time as the workflow. To migrate
an already-active daemon, stop it first and transfer its SQLite state deliberately;
never start with unrelated empty state while it might still be writing.

References: [scheduled events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule),
[release assets](https://docs.github.com/en/rest/releases/assets), and
[automatic token authentication](https://docs.github.com/en/actions/concepts/security/github_token).

## Bot setup and standalone preview

Create a Discord application and bot. Enable **Message Content Intent**, invite the
bot, and give it access to the selected forum. It needs **View Channels**, **Read
Message History**, **Send Messages**, and **Send Messages in Threads**. **Manage Threads**
is needed to handle moderator-locked threads and allows thread metadata updates if
ownership permissions are insufficient. Administrator is not required. Manage Webhooks
is not used by this implementation.

Use a fine-grained GitHub personal access token with **Issues: read and write** and
**Metadata: read**, restricted to the target repository. For the standalone daemon, the bridge identifies its GitHub author using `/user`.
The Actions entry point instead supports the built-in workflow token as described above. A dedicated account
makes authorship clearer. Track the token's expiry and rotate it in the private file.

Copy `tools/discord-sync/config.example.env` outside the checkout, set its permissions
to `600`, and fill in the tokens, repository, guild ID, and forum ID. Protect the parent
directory too. Use an absolute `SYNC_DATA_DIR`. Never commit credentials, the database,
previews, or cached community attachments. The CLI creates state with private permissions.

```sh
node --env-file=/absolute/private/bot.env tools/discord-sync/cli.mjs plan
```

For local use, `--github-from-gh` reads an already authenticated GitHub CLI token into
memory when `GITHUB_TOKEN` is absent. It does not print or persist that token.
The Docker image uses `GITHUB_TOKEN` from the private env file instead.

The complete plan is saved to `SYNC_DATA_DIR/last-plan.json`; `--output=/absolute/path.json`
chooses a different existing directory. The terminal shows only operation types/IDs
and warnings. Review bodies and attributed comments in the private plan. Attachment
URLs in a preview are placeholders; no remote writes or downloads occur in `plan`.
The preview uses a disposable in-memory copy of the local state, so it does not advance
mappings or resolve pending operations.

Optional configuration:

* `SYNC_TAG_MAP={"Bug":"bug","Feature":"enhancement"}` maps existing forum tag names
  to issue labels. Required GitHub labels are created during startup with writes enabled.
* `DISCORD_DEFAULT_TAG` is an existing forum tag ID for new GitHub-origin posts with no
  matching labels. It is required when the forum requires a tag.
* `SYNC_REDACT_TERMS=["private-term"]` removes configured literal terms, ignoring case,
  from Discord content before publishing to GitHub. Source links remain available.
* `SYNC_RELATED_ISSUES={"100000000000000003":42}` appends a related issue link to a
  particular imported post. It never changes either issue's state.
* `SYNC_INTERVAL_SECONDS` accepts 15–3600; default 60. `DISCORD_SYNC_LABEL` defaults to
  `discord`. `SYNC_HOST` defaults to loopback and `SYNC_PORT` to 8098.

## Alternative: permanent attachments on a Docker host

Discord CDN download URLs expire. The bridge downloads attachments from trusted
Discord CDN hosts, verifies a size limit of 20 MiB per file, and stores bytes under a
SHA-256 name in the persistent data directory. The public endpoint serves these files
at immutable URLs. PNG, JPEG, GIF, and WebP are served as images based on their bytes;
other types are forced downloads. HTML and SVG never execute as hosted pages.

Set `PUBLIC_ASSET_BASE_URL=https://files.example.com/assets`. The endpoint is public
by URL; only attachments destined for the public repository belong here. Back it up
with the database and retain the hostname for as long as the GitHub issues need images.
Deleting/redeploying the service without its volume breaks those links.

Before performing any remote writes, the bridge starts its file server and verifies
that the configured HTTPS endpoint serves the exact bytes of a local test image.
A wrong/unreachable hostname stops activation. A standalone import that shuts down the
file server would leave broken image links, so this deployment runs as a continuous service.
The Actions deployment uses release assets and does not start this file server.

On an existing Docker host, point a dedicated hostname at it and allow ports 80/443.
The included Compose deployment starts the bridge and Caddy with automatic HTTPS:

```sh
export SYNC_ENV_FILE=/absolute/private/bot.env
export SYNC_ASSET_HOST=files.example.com
docker compose -f tools/discord-sync/compose.yml build
docker compose -f tools/discord-sync/compose.yml up -d
```

If the host already runs a reverse proxy on 80/443, run only the bridge service and
route `/assets/<hash>` to port 8098 through that proxy. The Compose file exposes 8098
only on its internal network. Adjust networking for the existing proxy; do not start
a second listener on occupied ports. Its public route should not expose `/healthz`.

For a non-Docker host, run `node --env-file=/absolute/private/bot.env
tools/discord-sync/cli.mjs run --apply` under the host's service manager. Proxy only
`/assets/<hash>` to its loopback HTTP port. Don't use both deployments against one state
directory, and don't start the upstream sync bot against the same forum/repository.

The bridge does not need a public webhook endpoint. GitHub webhook secrets and Discord
Gateway connections are unnecessary. The asset endpoint is read-only.

## Standalone monitoring, backups, and recovery

`GET /healthz` on the private listener returns 200 only after a successful pass without
warnings; startup or degraded synchronization returns 503. `lastSuccess` shows the last
complete warning-free pass. Docker health does not automatically restart an unhealthy
container: investigate reports and permissions rather than depending on restarts.

```sh
node --env-file=/absolute/private/bot.env tools/discord-sync/cli.mjs status
```

The database records the configured repository/forum scope and refuses reuse with a
different scope. A renewable writer lease prevents two bridge processes from mutating
the same state. Stop the process before moving/restoring its directory. Back up the whole
persistent volume (SQLite database plus its WAL/SHM files and `assets/`), preferably while
the bridge is stopped. Protect backups as community content; credentials stay separate.

Every creation first records an intent in SQLite. On restart, a complete destination
scan can recover a successful write using its bot-owned origin marker. A lost response
with no discoverable remote copy is deliberately paused: retries cannot promise exactly
once across an unacknowledged remote API write. No automatic retry can create a second
copy while that outcome is unknown. HTTP PATCH updates can be repeated safely.

Inspect the destination and private report before explicitly resetting an absent write:

```sh
node --env-file=/absolute/private/bot.env tools/discord-sync/cli.mjs retry \
  --operation=comment:100000000000000004 --confirm-absent
```

Stop the running bridge first; the writer lease rejects a concurrent reset. The next
pass checks the destination again. Do not reset an operation that might already exist.
If duplicates already exist, reconcile them manually before removing origin markers.
Do not delete the database to clear a warning.

To resolve conflicting edits, inspect the source and mirrored copy and align their
content deliberately. The bridge never resolves conflicts by deleting either copy.
Changing configuration does not retroactively erase copied history.

## Checks

```sh
node --test tools/discord-sync/test/*.test.mjs
```

CI and `scripts/check.sh` run these tests. They cover repeat scans, restart recovery,
ambiguous writes, both reply directions and edits, safe status/deletion behavior,
conflicts, dry-run isolation, pagination, rate limits, asset hosting, and writer leases.
A live read-only preview tests credentials/content access; mocked writes do not prove
live write permissions or a deployment's public DNS/TLS routing.
