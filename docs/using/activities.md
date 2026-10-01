# Activities

The **Activities** tab holds things to do on the wall that aren't the family schedule. It works the same on every device, including paired wall displays and the demo. There are three activities: **Paint**, the **Sticker book** and [**Photos**](photos.md). [Rewards](rewards.md) have their own screen, next to Chores.

Families can add more activities made by others: see [Activities from others](#activities-from-others).

An admin can turn off **Paint** or **Photos** in **Settings → General** (tap **Change** under **Features**); the Sticker book goes with **Chores & points** or the sticker shop. When all of them are off, the Activities tab is hidden. See [Features](../settings/general.md#features).

## Paint

A drawing app for kids. Tap **Activities → Paint**. The canvas fills the screen under a row of big buttons. Draw with a finger, an Apple Pencil or a mouse. Only one finger draws at a time, so a hand resting on the screen won't scribble.

### Tools

* **Brush**: a round, smooth brush in the chosen color.
* **Rainbow brush**: the color changes as you draw.
* **Eraser**: paints white paper back.
* **Fill bucket**: tap an area to fill it with the chosen color. It also covers most of the soft edge along a line, so outlines don't leave a white ring.
* **Sizes**: seven dots, from Tiny to Giant.
* **Colors**: the round button after the tools shows the current color. Tap it for forty colors in rows: bright, pastel, dark, skin tones and browns, and grays. **Any color** opens the device's color picker (a color wheel on most devices), and the last seven picked that way are kept on that device. Picking a color while the eraser or rainbow brush is on switches back to the brush.
* **Undo / Redo**: up to 20 steps. With a keyboard, use Ctrl/⌘+Z and Ctrl/⌘+Shift+Z (or Ctrl+Y).
* **Clear**: wipes the picture after you confirm. You can undo a clear.
* **Who's drawing?**: a new drawing asks who's making it (tap a face, or **Skip**). When the family is filtered to one person, or the display is pinned to one, that person is the artist without asking. The face button in the toolbar changes it later. The artist shows in **My drawings** and in the caption when the picture is saved to family photos.
* **Name**: tap the drawing's name (e.g. "Drawing 3") to rename it.

Rotating the device or resizing the window rescales the picture to fit instead of clearing it.

### My drawings

**My drawings** (the pictures button) shows every saved drawing on this device, newest first, with a thumbnail, name, date and artist. You can:

* **Open** a drawing to keep working on it.
* **Copy** it to start a variation.
* **Delete** it after you confirm.
* Start a **New drawing**.

Drawings save automatically every few strokes, when you switch tabs, when the app goes to the background, and before the wall's idle reset. Paint reopens the last drawing you worked on.

A device holds up to **50 drawings**. When it's full, Paint says so and stops saving new pictures until you delete a few. Edits to pictures that are already saved still work.

### Save, share and print

* **♥ Save to family photos** adds the drawing to the family's [photos](photos.md), captioned with its name and who drew it (for example "Drawing 3 by Maya"). It then turns up on the Board's picture card and in the screensaver.
* **Save** downloads the picture as a PNG. On an iPhone or iPad it opens the share sheet instead, so you can choose **Save Image** to put it in Photos. If sharing isn't available, the picture opens in a new tab: press and hold it to save.
* **Print** prints just the picture, scaled to fit the page, with its name and date in small type at the bottom.

### On a wall display

* The wall never goes back to the calendar while an activity is open (Paint, the sticker book, or an added activity like Sight words), so nobody gets pulled out mid-picture or mid-game. Paint still saves as you draw.
* The [night hours](night.md) still rest the display as usual. The display's drawings can also be its [night screensaver](night.md#screensaver).

## Where drawings are stored

Drawings are stored **only on the device you drew them on**, in the browser's IndexedDB storage. They aren't sent to your Kinwall server, aren't part of [export & backups](../your-data/export-import.md), and don't sync to other devices. Clearing the browser's website data, or removing a home-screen app on iOS, deletes them. To keep a picture, use **Save** or **Print**, or tap **♥ Save to family photos**. That uploads it to the family's shared [photos](photos.md), where it shows on every device, on the Board and in the screensaver. Wall displays can do this too. Only a parent (admin) can delete it from the photos later.

## Sticker book

Each family member has their own sticker page. Tap **Activities → Sticker book**, then pick whose book it is from the avatar chips. The member picked in the header is chosen for you.

### Book

The page fills the screen, with a tray of that member's stickers along the bottom, grouped by pack.

* **Tap a sticker in the tray** to stick it in the middle of the page.
* **Drag** a sticker to move it.
* **Tap** a sticker to select it. A toolbar appears with **Bigger**, **Smaller**, **Rotate**, **To front** and **Remove**.
* With a keyboard, Tab to a sticker. The arrow keys move it (hold Shift for bigger steps), **+** and **−** resize it, **R** turns it, and **Delete** removes it.

On a kid's own device, only the kid's sticker book opens.

Changes save by themselves a moment after you stop. Pages are stored on the Kinwall server, so a sticker book looks the same on the wall, a phone and a tablet. Positions are kept as a share of the page, not pixels.

### Shop

The **Shop** tab shows every sticker pack with a peek at five of its stickers, and the member's balance at the top ("Maya has 42 points to spend"), with a link to their [rewards](rewards.md). **Sticker packs** on the Rewards screen opens this tab for that person.

| Pack | Price |
|---|---|
| 🐾 Animals | Free for everyone |
| 🍩 Sweets, ⚽ Sports | 15 |
| 🦖 Dinosaurs, 🐙 Ocean | 20 |
| 🚀 Space, 🤖 Robots | 25 |
| 🦄 Unicorns & Rainbows | 30 |

* **Buy** asks first: "Spend 20 points on Dinosaurs? Maya will have 22 left." Once bought, the pack is theirs for good and its stickers appear in the tray.
* If there aren't enough points yet, Kinwall says how many more are needed and roughly how many chores that is.
* Points come from [chores](chores.md#points-to-spend). Spending doesn't change the leaderboard.

### Settings

Under **Settings → Family → Chores**:

* **Sticker shop** turns the sticker book on or off. When it's off, the card disappears from Activities and the server refuses purchases.
* **Sticker prices** scales every price: **Free**, **50%**, **100%** (default) or **150%**. A pack bought earlier stays unlocked when prices change.

Sticker pages, unlocked packs and the points ledger are part of [export & import](../your-data/export-import.md).

### API

Display keys can use all of these, so the wall can shop and decorate. A member's own device buys and decorates only for that member (`403` for anyone else).

* `GET /api/stickers/packs?memberId=`: every pack with its price after scaling, and whether that member has it unlocked.
* `POST /api/stickers/packs/{packId}/buy {memberId}`: `409` if it's already unlocked, `402 {error, balance, price}` if there aren't enough points, `403` if the shop is off.
* `GET /api/stickers/scrapbook/{memberId}` and `POST` to place a sticker `{sticker, x?, y?, scale?, rotation?}`. The sticker must come from a pack that member has unlocked.
* `PATCH /api/stickers/scrapbook/{memberId}/{id}` `{x, y, scale, rotation, z}` and `DELETE` the same path.
* `GET /api/members/{id}/points`: balance, all-time earned and spent, and the last 50 ledger entries.

## Activities from others

Admins can add activities made by others: tap **Activities → Get more activities**.

- **Reviewed by Kinwall** lists activities Kinwall has checked. Tap **Install**. When a newer version has been reviewed, the activity shows **Update to v…**.
- **From anywhere** (self-hosted only) adds any GitHub repository that publishes a Kinwall package, or an uploaded `kinwall-plugin.zip`. These haven't been reviewed, so only add ones you trust. **Update** installs the newest release.

Every added activity runs in a sandbox: it can't load anything from the internet and sees only who's playing (first name, emoji and color) and its own saved progress, never your calendar, chores, lists or photos. Each person's progress is saved in your Kinwall. If an activity tries to leave Kinwall for another site, Kinwall stops it, shows **tried to leave Kinwall**, and stops answering it; open it again from **Activities** to restart it. A sandbox can't stop a page from trying, and what it already saw (who's playing and its progress) could go with it, which is why unreviewed activities need your trust. Turning an activity off hides it; **Remove** deletes it and everyone's progress in it.

When you open one, Kinwall asks **Who's playing?** unless the header is set to one person. **Just playing** plays without saving to anyone. A kid's own device always plays as the kid: the server saves progress and play time from it only for them (or the family's shared progress). A chore can ask for minutes of an activity; see [Activity chores](chores.md#activity-chores).

Want to build one? See [Building activity plugins](../contributing/plugins.md).
