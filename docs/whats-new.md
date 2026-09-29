# What's new

The full list of changes in every version is in the [changelog](https://github.com/JohnDuprey/kinwall/blob/main/CHANGELOG.md), and each version is on the [releases page](https://github.com/JohnDuprey/kinwall/releases). Self-hosting? See [Updating](self-hosting/updating.md) for how to move to a new version.

## 1.1.0

* **Board**: a new default view with the family's day at a glance, count tiles and a Take now tile. See [Board view](using/calendar.md#board-view).
* **Meals and recipes**: meal planning, recipe import from any link, cooking mode with timers, ratings, share links and basics. See [Meals](using/meals.md).
* **Groceries**: aisles, Checkout and Shopping mode, plus list sections you can reorder. See [Lists](using/lists.md).
* **Chores and rewards**: rewards to spend points on, parent approval, checklists and activity chores. See [Chores](using/chores.md) and [Rewards](using/rewards.md).
* **Medications**: reminders, Take now, and courses that end on their own. See [Medications](using/medications.md).
* **Check-ins**: Temp check, the evening goal check and a personal journal, with [Insights](using/insights.md) and the [Energy battery](using/battery.md). See [Journal](using/journal.md).
* **Profiles, contacts, trackers and photos**: a page per person, a household contacts directory, reading (with audiobooks), memories and health trackers, and family photos. See [Profiles](using/profiles.md) and [Contacts](using/contacts.md).
* **Appearance**: color schemes and typefaces for the family or one device, light or dark mode that follows the device, 12- or 24-hour times, and help for colorblind eyes. See [Appearance](using/appearance.md).
* **Wall screens**: a Night screen button, a night screen during quiet hours with an optional PIN, and remote control from Home Assistant.
* **Privacy**: health data is always encrypted at rest and stays away from connected apps unless you turn it on. See [Privacy & what's encrypted](your-data/privacy.md).

Self-hosting: health data needs an `ENCRYPTION_KEY`. Docker and the Home Assistant app already have one; on Cloudflare Workers make sure the secret is set. See the [changelog's Upgrading notes](https://github.com/JohnDuprey/kinwall/blob/main/CHANGELOG.md#upgrading).
