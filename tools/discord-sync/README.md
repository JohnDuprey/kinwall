# Discord forum ↔ GitHub Issues

A standalone Node 24 bridge. It has no npm dependencies and never starts with Kinwall.
The configuration connects exactly one Discord forum to one repository.

Read [the operator guide](../../docs/contributing/discord-forum-sync.md) before enabling writes.

```sh
node --test tools/discord-sync/test/*.test.mjs
node --env-file=/absolute/private/bot.env tools/discord-sync/cli.mjs plan --github-from-gh
```

The recommended deployment is the included [GitHub workflow](../../.github/workflows/discord-sync.yml):
15-minute reconciliation plus GitHub issue/comment events, with persistent state and
attachments in a dedicated prerelease. It needs only a Discord bot secret, not a host.

For the alternative standalone daemon, `plan` reads the APIs and writes a private local preview. It does not create issues,
comments, labels, forum posts, or messages. `run --apply` enables continuous synchronization.
Do not run the upstream bot alongside this bridge.
