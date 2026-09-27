# Building activity plugins

An activity plugin is a small web page that shows up under **Activities** on a family's Kinwall: a reading game, a math quiz, a drawing prompt. Plugins live in their own GitHub repositories, not in Kinwall's code.

**Start from the example:** [kinwall-plugin-hello-world](https://github.com/JohnDuprey/kinwall-plugin-hello-world). Use it as a template. It has the manifest, the SDK (`kinwall.js`), a preview page that stands in for Kinwall, the packaging script, the release workflow, and instructions for AI coding assistants (`AGENTS.md`). Its README is the full reference; this page is the overview.

## How a plugin runs

- **It's a package, not source.** Your repo's GitHub release has a `kinwall-plugin.zip` attached, built by the example's workflow. Kinwall downloads that package, checks it, and stores the files, so wall screens never contact GitHub.
- **It runs in a sandbox.** The page is shown in a sandboxed frame with its own strict security policy. It has no network at all, no browser storage, no pop-ups, and it can't see Kinwall's pages, data or sign-in.
- **It talks to Kinwall through the SDK only.** `Kinwall.ready()` says who's playing (first name, emoji, color), the theme, text size, motion preference and locale. `Kinwall.load()` and `Kinwall.save()` keep progress per person or for the whole family. `Kinwall.close()` goes back to Activities.
- **Saving counts as playing.** A family can make a chore of your activity, like "5 min of Sight words". Kinwall times it, not your plugin, and it counts time only while your page is on screen and has saved in the last two minutes. So call `Kinwall.save()` on each answer or step, not just at the end, or the play won't count.
- **It's one page.** If the page loads another page (a link, `location`, a reload), Kinwall stops the plugin. Switch screens in JavaScript.

## Limits

| What | Limit |
|---|---|
| Package | 5 MB zipped; unpacked, 10 MB, 200 files, 2 MB per file |
| Per family | 20 plugins, 50 MB of plugin files in all |
| Saved data | 16 KB per value, 100 values per person, 1 MB per plugin for the whole family |
| Saving | 30 saves in 10 seconds |

The example's README lists everything else a plugin can't do (no module scripts, no workers, no dialogs, no device access) and why.

## Getting reviewed

Kinwall keeps a catalog of **reviewed** plugins. Each entry pins one release by the SHA-256 of its `kinwall-plugin.zip`, so families get exactly the package that was reviewed.

- **On kinwall.family (hosted):** only reviewed plugins can be installed.
- **Self-hosted:** reviewed plugins are listed first under **Get more activities**. Admins can still add any repository or upload a package, with a warning that it hasn't been reviewed.

To ask for a review, [open an issue](https://github.com/JohnDuprey/kinwall/issues) with your repository's link. A Kinwall admin downloads the release, checks it, and approves it in the admin console. What's checked:

- It passes the package checks and stays within the limits.
- It does what its description says, it's suitable for its ages, and it's kind: nothing to buy, no ads, no links out, no shaming.
- It works on a phone, a tablet and a wall screen, in light and dark.

## Updates

- **Publish a new version:** bump `version` in `kinwall-plugin.json` and publish a release tagged exactly `v<version>` (e.g. `v1.3.0`, not `1.3.0`): reviews and installs look the release up by that tag. The workflow attaches the package and checks the tag matches.
- **Reviewed plugins:** a new release changes nothing for families until it's reviewed too. The admin console checks each plugin's repository for new releases, and an admin approves each version (comparing it with the last one on GitHub). Families then see **Update to v…** under **Get more activities**. Kinwall refuses a package whose hash doesn't match the approved one, so a release replaced after review is never installed.
- **Unreviewed plugins (self-hosted only):** **Update** installs your latest release.
- **Saved data is kept** across updates. Never change your plugin's `id`: updates and saved data find your plugin by it.
