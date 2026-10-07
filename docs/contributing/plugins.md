# Building activity plugins

An activity plugin is a small web page that shows up under **Activities** on a family's Kinwall: a reading game, a math quiz, a drawing prompt. Plugins live in their own GitHub repositories, not in Kinwall's code.

**Start from the example:** [kinwall-plugin-hello-world](https://github.com/JohnDuprey/kinwall-plugin-hello-world). Use it as a template. It has the manifest, the SDK (`kinwall.js`), a preview page that stands in for Kinwall, the packaging script, the release workflow, and instructions for AI coding assistants (`AGENTS.md`). Its README is the full reference; this page is the overview.

## How a plugin runs

- **It's a package, not source.** Your repo's GitHub release has a `kinwall-plugin.zip` attached, built by the example's workflow. Kinwall downloads that package, checks it, and stores the files, so wall screens never contact GitHub.
- **It runs in a sandbox.** The page is shown in a sandboxed frame with its own strict security policy. It can't fetch or load anything from the internet, has no browser storage and no pop-ups, and it can't see Kinwall's pages, data or sign-in. It gets only who's playing, the theme and its own saved progress, through the SDK.
- **It talks to Kinwall through the SDK only.** `Kinwall.ready()` says who's playing (first name, emoji, color), whether it's a parent's device (`parent`: true on a parent's phone or computer, false on wall screens and kids' devices, missing on older Kinwall versions), the theme, text size, motion preference and locale. Use `parent` to show grown-up settings, like editing a kid's word list, only to parents. `Kinwall.load()` and `Kinwall.save()` keep progress per person or for the whole family. `Kinwall.close()` goes back to Activities.
- **Speech everywhere.** Android's WebView has no `speechSynthesis`, so Kinwall can speak for a plugin: `await Kinwall.speak(text, { rate, lang })` resolves when it's said (or stopped; it never rejects), and `Kinwall.stopSpeaking()` stops it. `ready()` says whether it works there (`canSpeak`). Use the page's own `speechSynthesis` when it has one (it gives more control over voices), else `Kinwall.speak` when `ctx.canSpeak`, else say the activity needs a device that can talk. Text is cut at 500 characters. Safari on a Mac takes speech from a plugin's sandboxed page but never says it (the utterance ends, or just sits, without its `start` event), so if your first utterance hasn't started after a moment, switch to `Kinwall.speak` for the rest of the session; Kinwall unlocks speech on its own page with the tap that opens an activity (or picks who's playing), so Safari lets it talk. It doesn't before then: speaking claims the device's audio (AirPods switch over, music on other devices pauses).
- **Play counts when there's play.** A family can make a chore of your activity, like "5 min of Sight words". Kinwall times it, not your plugin, in 15-second steps from launch: a step counts only if the player did something in it, and only while your page is on screen. `kinwall.js` passes real taps and key presses in your page to Kinwall (just "something happened", at most one message every 3 seconds, never what or where), and a `Kinwall.save()` or `Kinwall.speak()` counts too; `ready()` and `load()` don't. So keep the current `kinwall.js`: an activity on an older copy counts only the steps where it saves or speaks, so save each answer, not just the end of a round.
- **Leaving asks first; closing doesn't.** While an activity is open, Kinwall hides its own header, tabs and menu, and its back button, the browser's back and Android's back button ask "Leave …?" first. `Kinwall.close()` leaves right away, so call it when your activity is truly finished.
- **No zooming.** Activities don't pinch- or double-tap-zoom (a child zooms in and gets lost). Keep `maximum-scale=1, user-scalable=no` in your page's viewport and `touch-action: pan-x pan-y` on `html` (the template has both; `kinwall.js` also stops Safari's pinch gesture). Size text from Kinwall's text size (`ctx.textScale`) instead.
- **Slow down guessing.** After a wrong answer, disable the answer controls for about 1.5 seconds with a gentle look, and keep a 🔊 replay button disabled until the speech ends plus about 1.5 seconds. Use `aria-disabled` (not `disabled`) so focus stays put. The template shows the pattern.
- **Other apps can ask it to do things.** A plugin can declare **actions** in its manifest, like Spelling practice's `addList`, so a parent can say "add Maya's spelling list for this week" to an AI assistant, or a Home Assistant or n8n automation can send one. See [Actions](#actions).
- **It's one page.** If the page loads another page (a link, `location`, a reload), Kinwall stops the plugin. Switch screens in JavaScript.

## Actions

Your plugin's saved data is yours: its format is private to the plugin, and nothing else writes it. Actions are how other apps ask the plugin to change it. The plugin declares what it accepts, Kinwall queues each request for one person, and the plugin applies it the next time that person opens it.

Declare them in `kinwall-plugin.json` (at most 10). Names start with a lowercase letter, then letters and digits (`addList`). The input is a small JSON-Schema-like shape: `properties` with a `type` of `string`, `number`, `boolean`, `array` or `object`, an optional `description`, `items: { type }` for arrays, `maxLength` and `maxItems`, plus a `required` list.

```json
"actions": {
  "addList": {
    "description": "Add a spelling list for this person, or add words to their list with the same title.",
    "input": {
      "properties": {
        "title": { "type": "string", "maxLength": 40, "description": "The list's name" },
        "words": { "type": "array", "items": { "type": "string" }, "maxItems": 60 },
        "testDate": { "type": "string", "description": "YYYY-MM-DD" }
      },
      "required": ["title", "words"]
    }
  }
}
```

- **Sending one:** `POST /api/plugins/{id}/actions/{name}` with `{ "member": "<member id>", "input": { … } }` (`member: ""` for the family's shared data), or the MCP tool `run_activity_action`. Only full access can: a parent's device, a full-access API key or connected app; never wall screens or kids' devices. Kinwall checks the input against the declared shape (required fields present, no unknown fields, types match, strings at most 1,000 characters unless `maxLength` says otherwise), caps it at 16 KB, and keeps at most 50 waiting per person and plugin.
- **Applying them:** `await Kinwall.actions()` returns the current person's waiting actions, oldest first, as `[{ id, action, input, createdAt }]` (`Kinwall.actions({ shared: true })` for the family's). Apply each and then call `await Kinwall.done(id)`, which deletes it. Call `actions()` after `ready()` and `load()`; Kinwall also sends an `actions` event (`Kinwall.onActions(callback)`) when something changed while the plugin is open, so it can look again. On older Kinwall, `actions()` resolves to `[]`.
- **Check the input yourself,** even though Kinwall checked its shape: it came from outside. Drop what you can't use with `done(id)` so it doesn't come back.
- **Be idempotent.** If saving works but `done` doesn't (the network dropped), the action comes back next time. Applying it twice should change nothing more: merge rather than append.

## Limits

| What | Limit |
|---|---|
| Package | 5 MB zipped; unpacked, 10 MB, 200 files, 2 MB per file |
| Per family | 20 plugins, 50 MB of plugin files in all |
| Saved data | 16 KB per value, 100 values per person, 1 MB per plugin for the whole family |
| Saving | 30 saves in 10 seconds |
| Actions | 10 per plugin; input 16 KB; 50 waiting per person and plugin |

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
