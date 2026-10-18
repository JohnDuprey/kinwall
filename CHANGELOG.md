# Changelog

## [1.2.0](https://github.com/JohnDuprey/kinwall/compare/v1.1.0...v1.2.0) (2026-10-16)


### ⚠ BREAKING CHANGES

* **meals:** a meal's status is planned or prepared; sending handled to the REST API or MCP update_meal is refused.

### New

* **activities:** zoom and pan in Paint ([43668f0](https://github.com/JohnDuprey/kinwall/commit/43668f0c24048d3d28daa74952153426dca291fd))
* **board:** add a Get stuff done card showing a checklist's progress ([07f7745](https://github.com/JohnDuprey/kinwall/commit/07f77457aae19c48ff94e48e8e1302e3e9795c03))
* **board:** add an event from the board with the + button ([4b1719c](https://github.com/JohnDuprey/kinwall/commit/4b1719c78d5dc4dffd4fd04394ef180317348e12))
* **board:** cast screen mode for nest hub and other smart displays ([27483b2](https://github.com/JohnDuprey/kinwall/commit/27483b263b1867b77affab433eee8a5a95fee4bd))
* **board:** put one or two count tiles on the toolbar as chips ([1b4662b](https://github.com/JohnDuprey/kinwall/commit/1b4662b81ef24c8f3f8eb3f2025f8ec297fc5465))
* **board:** say what the today chips count on tablets and walls ([cb0dab5](https://github.com/JohnDuprey/kinwall/commit/cb0dab5994587fb5ae71eeedd7a4cadd0b632c8b))
* **board:** show photo captions legibly on the picture card ([8dc8bca](https://github.com/JohnDuprey/kinwall/commit/8dc8bca5591a27aedac0db2206799bf314b3293c))
* **board:** show saving-for goals beside the chores line on Today ([c33a771](https://github.com/JohnDuprey/kinwall/commit/c33a771cebabd7fc40ac3838be8c83d2637dabf8))
* **board:** show what's on now and next first in today's events ([21ea807](https://github.com/JohnDuprey/kinwall/commit/21ea8070c4dc7c852e7f371c19573220f32d0f44))
* **calendar:** add a family default calendar for new events ([081f6cf](https://github.com/JohnDuprey/kinwall/commit/081f6cf233ad0433e60ee4b9ec84616b4620a771))
* **calendar:** add Yearly to the event sheet's Repeat menu ([4d273f6](https://github.com/JohnDuprey/kinwall/commit/4d273f68da8ef169aeb4bd62e19b1d37b714085e))
* **calendar:** default event length and a view button on the saved toast ([789898d](https://github.com/JohnDuprey/kinwall/commit/789898da6ad1e94d6370355ddc2c11ab940ae66b))
* **calendar:** give Calendar its own place beside Home ([c06d260](https://github.com/JohnDuprey/kinwall/commit/c06d260ebca69590b19536dccc3a13aa523010fe))
* **calendar:** mark meal events and check off cooked or ordered meals ([b59379d](https://github.com/JohnDuprey/kinwall/commit/b59379dd3608939daf91ccba4b72f3603123b2e5))
* **calendar:** say plainly when a sign-in is revoked and tell parents once ([d8cbeac](https://github.com/JohnDuprey/kinwall/commit/d8cbeacc132d560ee498e6b8d66de93c56824ee5))
* **calendar:** say when Home and Calendar show only one person ([278710f](https://github.com/JohnDuprey/kinwall/commit/278710f3a4ae3ad93f998dd5bb3196119764948d))
* **chores:** add a start time and a timer to a chore ([37f0e62](https://github.com/JohnDuprey/kinwall/commit/37f0e62cd82c1ad2155dbed1c14587314a382802))
* **chores:** count activity play from launch and show a progress ring ([d8dbf1d](https://github.com/JohnDuprey/kinwall/commit/d8dbf1da2be7252c5255a622e64717abc639d521))
* **chores:** count activity time only while a kid is really playing ([6331fe0](https://github.com/JohnDuprey/kinwall/commit/6331fe0430224f0c02faa552ce4508c8cac4affb))
* **chores:** edit chores and lists with an edit mode, not press and hold ([418c805](https://github.com/JohnDuprey/kinwall/commit/418c805598e57ff8e0e5d01e4e47263527de5130))
* **chores:** let a parent reset a day's activity play time ([c772cf2](https://github.com/JohnDuprey/kinwall/commit/c772cf2cce6421426104fd74bf286ff7d25de964))
* **chores:** let kids suggest their own chores for a parent to approve ([fc763d9](https://github.com/JohnDuprey/kinwall/commit/fc763d934e6aa27fb553f8ca121706d98f65e25d))
* **chores:** let parents give bonus points outside a chore ([796bbc9](https://github.com/JohnDuprey/kinwall/commit/796bbc943db367364e578e561206d98ae307802c))
* **chores:** make Suggest a chore easier for kids, with Take back ([4a3ee88](https://github.com/JohnDuprey/kinwall/commit/4a3ee887046a13f04dbaaa1b7a34665fc25cdd17))
* **chores:** open a chore's checklist in Get stuff done ([ed9a54e](https://github.com/JohnDuprey/kinwall/commit/ed9a54e7a9ccd1b01235f0b1f07285cf91a70904))
* **contacts:** keep a shared place's own website and phone ([992c8d5](https://github.com/JohnDuprey/kinwall/commit/992c8d549ca2e00bf92c7fc8413cde772dea2d11))
* **contacts:** pick phone and email labels from a list, or type your own ([3e45b18](https://github.com/JohnDuprey/kinwall/commit/3e45b1845228608251e891826b37dd919edffe43))
* **contacts:** share a Maps place as a contact, not only a restaurant ([3aced8b](https://github.com/JohnDuprey/kinwall/commit/3aced8b7feda0e8863354af01bc538c478e7d8ce))
* **lists:** ↑ and ↓ buttons on aisles in Stores & departments ([ab26883](https://github.com/JohnDuprey/kinwall/commit/ab2688302791507108d03edb8f4700143abe2024))
* **lists:** add Get stuff done mode for working through a checklist ([7d3f9e4](https://github.com/JohnDuprey/kinwall/commit/7d3f9e4ffa0292b986f38aeef6e2746e21ce1bab))
* **lists:** add item sheet and on sale for shopping lists ([9d7735a](https://github.com/JohnDuprey/kinwall/commit/9d7735a933cca5ac72ff1bb714ec259426e4683f))
* **lists:** ask where an item was found when it's ticked off on a trip ([e366b73](https://github.com/JohnDuprey/kinwall/commit/e366b73763f6087338352526252f40e716f5889f))
* **lists:** connect to-do apps and sync a list with one ([5b9af9a](https://github.com/JohnDuprey/kinwall/commit/5b9af9af9bdfbf64e3ec79cb4da6e6099a732b54))
* **lists:** Get stuff done follows the list's sort and shows priority, due date and event ([f6d7a94](https://github.com/JohnDuprey/kinwall/commit/f6d7a94fe302af6e3f4b425cde672147866155af))
* **lists:** ⓘ on shopping mode rows opens the item ([3427620](https://github.com/JohnDuprey/kinwall/commit/342762057244e97e88bdb6b43d39fe9ec4183075))
* **lists:** keep stores per list type and add a default store per type ([4131797](https://github.com/JohnDuprey/kinwall/commit/4131797bfb0a022719ecaf15eb50ce2bd93a5e0a))
* **lists:** mark who a list item is for ([c570aa6](https://github.com/JohnDuprey/kinwall/commit/c570aa69edccf4491b3d0e900d0d9cc5718e2c27))
* **lists:** one scan sheet while shopping, catalog names and an already-on-the-list warning ([1346680](https://github.com/JohnDuprey/kinwall/commit/1346680b419dd3c9b5c9e2e1d260b11e5382e3e1))
* **lists:** open a new list after creating it, its emoji following the type ([073d4ad](https://github.com/JohnDuprey/kinwall/commit/073d4add47956922d406492c8771f300577691d2))
* **lists:** set the default store with a star in Stores & departments ([ed712b3](https://github.com/JohnDuprey/kinwall/commit/ed712b3c37d201231cea77f0d15abfb8a5d6c20d))
* **lists:** show a to-do list's sync warning under its header ([f30d18b](https://github.com/JohnDuprey/kinwall/commit/f30d18b630e085f20c208b948e36ba718ea4fece))
* **lists:** show lists waiting for their to-do app after an import ([dc9b1f3](https://github.com/JohnDuprey/kinwall/commit/dc9b1f3fa1fdf37812cd80e48fe50f881a1fa8a8))
* **meals:** add a restaurant binder with menus and family favorites ([7c783ad](https://github.com/JohnDuprey/kinwall/commit/7c783ad45bff8b9790877eb833e367e46951b72e))
* **meals:** add restaurants from an iPhone shortcut, a link or a photo ([c8be447](https://github.com/JohnDuprey/kinwall/commit/c8be4474a64311f8a574a5b94844d1a2fcaf64c5))
* **meals:** collect everyone's order for a night from the binder ([856004a](https://github.com/JohnDuprey/kinwall/commit/856004aa782761f974f56f9c269a498b95aac9fb))
* **meals:** cooking mode keeps the step's words in view ([60b71e2](https://github.com/JohnDuprey/kinwall/commit/60b71e240b4c8d1e7083b52a5191f2b2ce07b42c))
* **meals:** fold a meal's All done status into Cooked ([d6f38a8](https://github.com/JohnDuprey/kinwall/commit/d6f38a884b8442e7e56f8c754dd705868a986c3c))
* **meals:** make ordering from a big menu clear for parents and kids ([7f5c6c0](https://github.com/JohnDuprey/kinwall/commit/7f5c6c0c5aaea4dc8909be25455328e2e895342d))
* **meals:** meal context on a planned recipe, phone filters, quicker hearts ([f880683](https://github.com/JohnDuprey/kinwall/commit/f880683e57ade449fa8bbe3cb34369dad0d960cf))
* **meals:** open order nights on their orders and plan meals recipe first ([ec61483](https://github.com/JohnDuprey/kinwall/commit/ec6148343940f561ce9c8158bcb22efec6366b15))
* **meals:** pin the order so far and confirm asking for orders ([ae72104](https://github.com/JohnDuprey/kinwall/commit/ae721041520b6d76961f7584053451a1ecd9fccc))
* **meals:** read a menu shared as several photos as one menu ([95e1569](https://github.com/JohnDuprey/kinwall/commit/95e15693095eeab9476dc43c9ed4f6d12b440a14))
* **meals:** read photographed menus into sections, prices and add-ons ([7b70271](https://github.com/JohnDuprey/kinwall/commit/7b7027119bb891150a61f9b6d526c590d1ca0fdf))
* **meals:** recipe favorites per family member ([ef6a97e](https://github.com/JohnDuprey/kinwall/commit/ef6a97e1ed3eb5216c014a44fa7a95ca1744d218))
* **meals:** show restaurant prices in the family's currency ([b4b7a52](https://github.com/JohnDuprey/kinwall/commit/b4b7a52c862ddaeaf018f3eb937f03a5c180f0ca)), closes [#31](https://github.com/JohnDuprey/kinwall/issues/31)
* **medications:** ask for refills at a contact, with phone menus ([53f9749](https://github.com/JohnDuprey/kinwall/commit/53f9749cf2370567464077e51c7440cdec8c3b72))
* **medications:** fix a marked dose's time or status ([d785458](https://github.com/JohnDuprey/kinwall/commit/d785458f7f3fc52ac503813bb1b47105120cf397))
* **medications:** request refills with a refill card and to-do ([af28f69](https://github.com/JohnDuprey/kinwall/commit/af28f693c8d9ff9aba7c5d844b3e2600d2f794a2))
* **medications:** show the kids' due doses on a parent's phone ([8a742d5](https://github.com/JohnDuprey/kinwall/commit/8a742d55f81a423942d2cc83753b1a3702cc8090))
* **outings:** add outing reminders and ideas ([796e4c3](https://github.com/JohnDuprey/kinwall/commit/796e4c397a77b93825e3ae98ac7d4998aa1e0708))
* **outings:** add outings, a list of things to do and places to go ([5dc6a91](https://github.com/JohnDuprey/kinwall/commit/5dc6a917e8a249f8d831b08b457a9596a39fe6d4))
* **outings:** import outings from links, flyers, maps and community calendars ([45b68f7](https://github.com/JohnDuprey/kinwall/commit/45b68f75a27aa0cd79c0cc86f720a50173f2867d))
* **plugins:** let plugins speak through Kinwall ([7a1b08d](https://github.com/JohnDuprey/kinwall/commit/7a1b08d63741061d4d7fe442344b7dc19ffd6dfb))
* **plugins:** tell plugins whether it's a parent's device ([8cfeba3](https://github.com/JohnDuprey/kinwall/commit/8cfeba3984bc21e0834ca5b63c44c5ddb9bc7b5e))
* **polls:** add family polls with votes, a board card and plan it ([bac4898](https://github.com/JohnDuprey/kinwall/commit/bac489868ecbff3abae16eb3fd7fa693d2830913))
* **polls:** offer restaurants from the binder as poll choices ([15abcff](https://github.com/JohnDuprey/kinwall/commit/15abcff40859b2979319c023ffaadce5b0836994))
* **polls:** show open polls and today's tiles inside the Today card ([6cc70af](https://github.com/JohnDuprey/kinwall/commit/6cc70af21b2832097193e09e89a9890f48d0074e))
* **polls:** show which choice is in the lead while voting ([5122039](https://github.com/JohnDuprey/kinwall/commit/5122039d6b70248d3080781f098772b5ef911ecc))
* **recipes:** time a step's range with a check chime and a done ring ([4add9a8](https://github.com/JohnDuprey/kinwall/commit/4add9a8a3844f237bef9116bf6fdbf047a2e862c))
* **rewards:** show a person's points history from their balance ([cbc5470](https://github.com/JohnDuprey/kinwall/commit/cbc547007945ec488479dc92da779aa6c5ee29d3))
* **rewards:** split a reward between several people ([3e5626a](https://github.com/JohnDuprey/kinwall/commit/3e5626a8697c0cf8f9342ae024e1e18e1fa750b4))
* **server:** a family language and a member's own language ([9749c54](https://github.com/JohnDuprey/kinwall/commit/9749c54e91b4e35e821058a6438b6d41e529c094)), closes [#31](https://github.com/JohnDuprey/kinwall/issues/31)
* **server:** add one share endpoint for the Add to Kinwall shortcut ([9a0bd20](https://github.com/JohnDuprey/kinwall/commit/9a0bd20fac82f361025fe927ad455f1ee00b59c2))
* **server:** let other apps send actions to activity plugins ([03da7ea](https://github.com/JohnDuprey/kinwall/commit/03da7ea28b2e9b08eea9a069b7a25b629cb9cef5))
* **server:** preview a shared recipe, restaurant or book before saving ([8da350e](https://github.com/JohnDuprey/kinwall/commit/8da350e9b1e6670ffe9964842e7e60761e13234c))
* **server:** read shared events' times, venues and notes more carefully ([a406eaf](https://github.com/JohnDuprey/kinwall/commit/a406eaf5d448dac76a8c7d94009a5974ea726394))
* **server:** save a shared event to a calendar and keep the invite's street ([f2cc0c7](https://github.com/JohnDuprey/kinwall/commit/f2cc0c7815a88be0acd8f13a30e8577dc1936d83))
* **server:** write the server's text in the family's language ([86d9a7c](https://github.com/JohnDuprey/kinwall/commit/86d9a7c3887b3ff4fbd3686bda5857c3824c02b7)), closes [#31](https://github.com/JohnDuprey/kinwall/issues/31)
* **settings:** add a per-device screen scale, auto-fitting 10" tablets ([76c31b3](https://github.com/JohnDuprey/kinwall/commit/76c31b38720c80b13e43d8bed4067f97428504f8))
* **settings:** ask what the family wants Kinwall for during setup ([4aa7e1d](https://github.com/JohnDuprey/kinwall/commit/4aa7e1d1b311bcd3863e6c7208c11328af13d085))
* **settings:** fold general's cards and add settings search ([e294890](https://github.com/JohnDuprey/kinwall/commit/e2948907ad593fe63c1a410e67c33471497c2777))
* **settings:** pin a checklist to a screen in Get stuff done ([3b2e102](https://github.com/JohnDuprey/kinwall/commit/3b2e102c000df7dcec519cc3704c5ba856d6676e))
* **settings:** profile pictures from photos, drawings or the camera ([3d7a1f5](https://github.com/JohnDuprey/kinwall/commit/3d7a1f50dfc6f534f8eecbc755c60078a6dd0b3a))
* **settings:** search every tab and add jump chips to Family and Access ([e0b9c32](https://github.com/JohnDuprey/kinwall/commit/e0b9c32bf4bc21b1722cf9fe7c5231aa04de6fa9))
* **settings:** show pictures from a photo folder on the server ([13e91ec](https://github.com/JohnDuprey/kinwall/commit/13e91ec2fae36c7860d1b127f010a623ddb79bd6)), closes [#44](https://github.com/JohnDuprey/kinwall/issues/44)
* **sync:** check to-do lists every two minutes and when one is opened ([f35fa2b](https://github.com/JohnDuprey/kinwall/commit/f35fa2bb4ee21d6680499d0c58f44fe5ba493e16))
* **sync:** sync steps, tell parents when a list stops, back up links ([a32601f](https://github.com/JohnDuprey/kinwall/commit/a32601f1eddc05226d450793d11214e080bd69d3))
* **sync:** sync to-do lists with Todoist, Google Tasks and Microsoft To Do ([284a7ee](https://github.com/JohnDuprey/kinwall/commit/284a7eec695cf3b4187c1f57300f6153433be794))
* **trackers:** add a cover view to the library ([af423d6](https://github.com/JohnDuprey/kinwall/commit/af423d61829420bc7eb9d7362ad55275492f57dd))
* **trackers:** filter the library by genre ([e4ad967](https://github.com/JohnDuprey/kinwall/commit/e4ad9678bd3870a80120c8d9e9fdbe95b5bdf3d2))
* **trackers:** log or fix reading for an earlier day ([d431a1c](https://github.com/JohnDuprey/kinwall/commit/d431a1caa4f73df582fcb203f3a0c47e4ee81e19))
* **trackers:** look library books up on Open Library for more details ([2717f2e](https://github.com/JohnDuprey/kinwall/commit/2717f2ec76ac0d38a6499455cb283eac950edd92))
* **trackers:** make a calendar event a health visit ([20b19be](https://github.com/JohnDuprey/kinwall/commit/20b19be27cacc5ea3caa146d24eea9fe1340f0cd))
* **trackers:** make audiobooks their own library items ([6adfc58](https://github.com/JohnDuprey/kinwall/commit/6adfc58f48663f6cfd7a3f96fb12dff7b3a0c726))
* **trackers:** move the library filters into a multi-select sheet ([ad722cf](https://github.com/JohnDuprey/kinwall/commit/ad722cfbe818529345e277a7b60e623c0cf1c773))
* **trackers:** put every book on a reading shelf in the library ([7c5bb75](https://github.com/JohnDuprey/kinwall/commit/7c5bb7532c1e24c7e918e3ccb509092387455580))
* **trackers:** show audiobooks as records in a crate in the library ([da4326c](https://github.com/JohnDuprey/kinwall/commit/da4326c0297d0efdcd95d88c62b1e9cec42a9582))
* **trackers:** sort the library by title, author, recently read and more ([225a9fd](https://github.com/JohnDuprey/kinwall/commit/225a9fdafe1229071ae0fb1c3c1b683af5f3a178))
* **trackers:** sort the library onto kids' and grown-ups' shelves ([9ab2325](https://github.com/JohnDuprey/kinwall/commit/9ab2325628cc3d610fd4467f909cda786be356b2))
* **web:** a translation framework and check ([ae8083d](https://github.com/JohnDuprey/kinwall/commit/ae8083d88fc58f413d4819469e8d428a37efa6e3)), closes [#31](https://github.com/JohnDuprey/kinwall/issues/31)
* **web:** act as the picked person on a wall until it goes idle ([ec0f79f](https://github.com/JohnDuprey/kinwall/commit/ec0f79fd917a7f52367237e639c0578e7cf541b8))
* **web:** add a pencil brush and ten remembered brush sizes ([bb92989](https://github.com/JohnDuprey/kinwall/commit/bb929890e1457d4e083cf3657419ae1e5374bd1b))
* **web:** add Help with this page to the Help sheet ([363a6f3](https://github.com/JohnDuprey/kinwall/commit/363a6f3755d22e2a4b15dfb460f12ac73fdb7ddf))
* **web:** Back closes the top sheet; sheets can ask before discarding ([6248da7](https://github.com/JohnDuprey/kinwall/commit/6248da7c7546584f5df1944e76c02b8d0a9de57e))
* **web:** close the top sheet or full-screen mode on the app's Back ([695b82b](https://github.com/JohnDuprey/kinwall/commit/695b82b39dce6a842ea09a3cc55414743b99f972))
* **web:** draw big screens bigger and fix the in-between screen sizes ([b96e23f](https://github.com/JohnDuprey/kinwall/commit/b96e23f0e3d224b2c39f292a6fb1158dba12e0ae))
* **web:** drift the night screen's pictures slowly ([f70b1ac](https://github.com/JohnDuprey/kinwall/commit/f70b1ac91fd649f2d6cdafc26048745109dae989))
* **web:** German for every screen ([22e0f59](https://github.com/JohnDuprey/kinwall/commit/22e0f5926dc84ab95512b60607a68888ff237933)), closes [#31](https://github.com/JohnDuprey/kinwall/issues/31)
* **web:** make a parent's phone compact by default ([9b80c30](https://github.com/JohnDuprey/kinwall/commit/9b80c303455377043c6cca8ef94055a364530c02))
* **web:** make compact density tight on any screen and compact forms ([01112b0](https://github.com/JohnDuprey/kinwall/commit/01112b081febf7c4536a6a7514bc0a90110ff328))
* **web:** Paint hides the nav like an added activity ([fa0296d](https://github.com/JohnDuprey/kinwall/commit/fa0296dc6641bdfb5b74c56a58a27924f991ccfd))
* **web:** put a shopping list's Add next to Shop instead of a text box ([645d455](https://github.com/JohnDuprey/kinwall/commit/645d455db9ab70e40ffccf10eae0d79115f6f1fd))
* **web:** redraw the coloring pages and add six more by category ([c1a6af0](https://github.com/JohnDuprey/kinwall/commit/c1a6af009a174993c3cca04c150e008f96fbdad3))
* **web:** show profile pictures in Paint's who's-drawing picker ([4c5844a](https://github.com/JohnDuprey/kinwall/commit/4c5844a9673148027006f86dd0bfe83cf35171fd))
* **web:** show-only-them button at the top of someone's day ([959bfe9](https://github.com/JohnDuprey/kinwall/commit/959bfe9fbdf6494c8b7f0515f1e080359e2baa88))
* **web:** timers with Undo on cancel, a row per ringing timer, and Ready ([45ac97f](https://github.com/JohnDuprey/kinwall/commit/45ac97f412dbfaf84c28dc83bd93b620aa8556f0))


### Fixed

* **activities:** keep Paint's tools on one row on a short landscape screen ([cb712a1](https://github.com/JohnDuprey/kinwall/commit/cb712a107ebfbef0da0f75f98c3093b3d8fa3db4))
* **api:** advertise the server origin in openapi.json ([0a37a30](https://github.com/JohnDuprey/kinwall/commit/0a37a30a7d492b19284c346fd21a01c26306fdf5))
* **auth:** check a typed key before keeping it ([3fe7b12](https://github.com/JohnDuprey/kinwall/commit/3fe7b12417c1d33710cd85d535a47be59887e110))
* **auth:** give the app's pairing page a way back to sign in ([d1e13d8](https://github.com/JohnDuprey/kinwall/commit/d1e13d8ccf1b3f9f534f4558f00b84aede958646))
* **auth:** keep connected apps off plugin installs and cap poll pushes ([ef45b56](https://github.com/JohnDuprey/kinwall/commit/ef45b5630b9ec436698ceb6490a19fd954486f4c))
* **auth:** keep device notes off kids' devices and wall screens ([60cb52d](https://github.com/JohnDuprey/kinwall/commit/60cb52d30de0b29cf16c02637a9190f7b2a38ab5))
* **auth:** make refresh-token rotation atomic and forgive a refresh race ([2741584](https://github.com/JohnDuprey/kinwall/commit/27415846a548746f197edcb968b309c38912a626))
* **auth:** offer Back to sign in on the app's first sign-in screen too ([557f746](https://github.com/JohnDuprey/kinwall/commit/557f74698d03d4e81199b38d9b48d383813c023e))
* **auth:** scale up sign-in and pairing on wall-sized screens ([b8d3ca4](https://github.com/JohnDuprey/kinwall/commit/b8d3ca4ed74cbff9667ee61e1ab709ffd1c661ec))
* **board:** fit the rail and scroll the board on a short landscape tablet ([d90b882](https://github.com/JohnDuprey/kinwall/commit/d90b882ec8159b5af1a374a3517cc24bebfb4c30))
* **board:** flow Today's slot right after the events ([9fb1ca2](https://github.com/JohnDuprey/kinwall/commit/9fb1ca2b975e0304d6e5b1412f6ae8e2a38ce4f0))
* **board:** give Today its whole column on a tablet on its side and a cast screen ([f429017](https://github.com/JohnDuprey/kinwall/commit/f4290173bd351df36467d51a7cdef8b896cea8ad))
* **board:** keep ▶ Start and poll rows clear of the phone's add button ([0abc4cf](https://github.com/JohnDuprey/kinwall/commit/0abc4cfbd26079033b954e9b483bbcd7c9ff9fb7))
* **board:** keep a two-column layout in two columns on a cast screen ([ad3410c](https://github.com/JohnDuprey/kinwall/commit/ad3410c71e176dff35ff364cbdf29c738399597d))
* **board:** keep the clock and today's events on short tablets ([13f114a](https://github.com/JohnDuprey/kinwall/commit/13f114ad2d094ecaa6b5bf6b8c29b28e73495b6c))
* **board:** keep the toolbar chips on the toolbar row on a phone on its side ([a90b69e](https://github.com/JohnDuprey/kinwall/commit/a90b69e9e3542f7d4d32cca0e6ca0e9281cba587))
* **board:** keep the toolbar chips on the toolbar row on a portrait tablet ([68299d7](https://github.com/JohnDuprey/kinwall/commit/68299d7732da55bcd16b7323c52bc95a195c6a95))
* **board:** name Polls and Outings under their icons on phones ([d837752](https://github.com/JohnDuprey/kinwall/commit/d83775272432e1680522029224207e49ec27bed9))
* **board:** say "4 meals" and "3 to-dos due", not "Show 4" and "3 due" ([fd61945](https://github.com/JohnDuprey/kinwall/commit/fd619454129f839fe289b3e6a50e3bd75ad8b754))
* **board:** show an event synced from two calendars once, as Calendar does ([7e50f75](https://github.com/JohnDuprey/kinwall/commit/7e50f75571d4005f6b1dff4e6fabaa40f3d59c25))
* **board:** show an event's category emoji on Board rows ([a190e4f](https://github.com/JohnDuprey/kinwall/commit/a190e4f55d24023d4513187c9ca6cab23bbc4b06))
* **board:** stop underlining timed chore rows on Today ([ac16576](https://github.com/JohnDuprey/kinwall/commit/ac165768e7c0df29062178b582bb50c28162ad40))
* **board:** three columns on a 10-inch Android tablet on its side ([5417bdd](https://github.com/JohnDuprey/kinwall/commit/5417bdd81586498cc8fb0525f090d606671c55b6))
* **brand:** match the web app's home-screen icon to the iPhone app's ([5d24cdf](https://github.com/JohnDuprey/kinwall/commit/5d24cdf33f9d6811fb2078664f0bf89fdaebc547))
* **calendar:** fold the event sheet's extra fields under More options ([6b01e28](https://github.com/JohnDuprey/kinwall/commit/6b01e28e2915a9b717a6585a20ccfc35725f9ac3))
* **calendar:** overlap faces on a narrow event so none are cut off ([69a5793](https://github.com/JohnDuprey/kinwall/commit/69a5793f60c796c1bc0c46cca72d88b8a63d2c8f))
* **calendar:** readable time grids that fit the day on a wall ([7327afe](https://github.com/JohnDuprey/kinwall/commit/7327afe6f5b4872820a98635c9811b414975edc6))
* **calendar:** say "Add a title" when Add event is tapped without one ([943fec3](https://github.com/JohnDuprey/kinwall/commit/943fec3c7623c576054be2a61ec2cc56ca8c5370))
* **calendar:** say who a chip tap added to an event, with Undo ([4a3018e](https://github.com/JohnDuprey/kinwall/commit/4a3018ed2137e700e788bd20ccec132443e58ed5))
* **chores:** complete a checklist chore on its last tick ([e6402a7](https://github.com/JohnDuprey/kinwall/commit/e6402a7fbad05b414dc7fccd9012a406c0f22de8))
* **chores:** count activity play time at most as fast as real time ([381b14c](https://github.com/JohnDuprey/kinwall/commit/381b14c1ebfb3e695fea1f89be3b9d15f5982949))
* **chores:** credit pts today to who did it and sort a column by start time ([049e352](https://github.com/JohnDuprey/kinwall/commit/049e3526504088b2c6ea5869d1e18f4ec276fd75))
* **chores:** drop the hidden Edit button on kids' devices ([c917b87](https://github.com/JohnDuprey/kinwall/commit/c917b871d07421001b147373fa21324e43592961))
* **chores:** hold missing-activity ticks for an ok and tidy the leaderboard ([d279185](https://github.com/JohnDuprey/kinwall/commit/d279185d957ddf6a6f3f3b647a7e289c2c5f0d30))
* **chores:** keep points to spend and the leaderboard current after a tick ([1d85c82](https://github.com/JohnDuprey/kinwall/commit/1d85c8204563853911ba9f613d32bd51e04832d5))
* **chores:** keep short button words on phones and give the leaderboard its row ([60dc023](https://github.com/JohnDuprey/kinwall/commit/60dc023d0c259d17394777b810b7662a1b3ab8a8))
* **chores:** keep Suggest a chore beside Rewards at the toolbar's end ([429b571](https://github.com/JohnDuprey/kinwall/commit/429b571d778cfe7786ceaf190ef1a93a39c4a946))
* **chores:** name who Again gives a library chore to, with Undo ([42d5e82](https://github.com/JohnDuprey/kinwall/commit/42d5e828c2f297511135698b106bc8fcb208dd82))
* **chores:** offer praise that fits the idea and kind notes for not this time ([197382c](https://github.com/JohnDuprey/kinwall/commit/197382cca68c97985930d191ea04c49d2020a9c1))
* **chores:** scroll the whole Chores view and fold To approve after two ([8c9e47c](https://github.com/JohnDuprey/kinwall/commit/8c9e47c718ac21dfba9f29c0d9be5aa8cf9106ce))
* **chores:** use one points stepper and one OK menu in chore and reward sheets ([7239bc5](https://github.com/JohnDuprey/kinwall/commit/7239bc5d7c8356786fce2a986b4e3158ca709282))
* **contacts:** drop the kind badge when a row has a relationship, explain the marks ([a4e5347](https://github.com/JohnDuprey/kinwall/commit/a4e53478d5ab57f818f2ac6e1644a21e8437d6d5))
* **contacts:** fold the add sheet's templates into one dropdown ([709519c](https://github.com/JohnDuprey/kinwall/commit/709519c519cea4a60105711de0a2c71303ed0352))
* **contacts:** keep a typed name when switching templates and file each one ([4a6d2e8](https://github.com/JohnDuprey/kinwall/commit/4a6d2e87418b7af80bf9c28f6d1b18c8d1e0d260))
* **contacts:** one Call button per number, the rest under More ([64d01cc](https://github.com/JohnDuprey/kinwall/commit/64d01cc7b0302050eed905cd29595a5f29f51239))
* **contacts:** put the wall switches under On the wall, after Who can see it ([6165d9c](https://github.com/JohnDuprey/kinwall/commit/6165d9cc1f19fbac74f2b74b0f28d9ab58b5f5c1))
* **insights:** show the battery's reasons as small chips ([e982312](https://github.com/JohnDuprey/kinwall/commit/e982312a89bedabfc29b15af3fe5a7e0e118fe3d))
* **lists:** a to-do's sheet puts Assign to and Due date right after its title ([968703e](https://github.com/JohnDuprey/kinwall/commit/968703e0d57a630ec6326f906b7f3b1a977ba2a2))
* **lists:** ask every product database even when one is down, in each list's order ([159e93e](https://github.com/JohnDuprey/kinwall/commit/159e93e9b04b07c4c9c7e22fc48a24db1f02646e))
* **lists:** Buy again sits under the name and skips what's in the cart ([136968c](https://github.com/JohnDuprey/kinwall/commit/136968c4a976654a00fd03fa14d803a46e3742a2))
* **lists:** closing "Didn't find these?" goes back to the trip ([dcc29a8](https://github.com/JohnDuprey/kinwall/commit/dcc29a88a30c70503137e55a98e19a874d47e8a8))
* **lists:** don't notify you about your own list change ([6adbd1d](https://github.com/JohnDuprey/kinwall/commit/6adbd1d189e59d9d37ae777fb25c65fddce3a865))
* **lists:** End on a shopping trip has Undo ([6558190](https://github.com/JohnDuprey/kinwall/commit/65581903e5cbfe72e3f59990c299de83fca51d36))
* **lists:** fill the height beside the rail and scroll a list as one on short tablets ([06b1d8a](https://github.com/JohnDuprey/kinwall/commit/06b1d8afa2ad97ced6cbc4a1d406443f87c6d665))
* **lists:** finish a shopping trip with one done shopping button ([ce2be9e](https://github.com/JohnDuprey/kinwall/commit/ce2be9eec4577b954fc5236b8f8a2951bfce4d83))
* **lists:** give an open list its own address; Back leaves shopping mode ([46e0b6c](https://github.com/JohnDuprey/kinwall/commit/46e0b6c36acb77ffa15d2bd66cae7269b5ace670))
* **lists:** group items with no aisle by department, not one Other heap ([f523c25](https://github.com/JohnDuprey/kinwall/commit/f523c251b2fc795d22763654aa29cc9b1d3e04c5))
* **lists:** match a UPC-A barcode and its EAN-13 form as one product ([6151ea6](https://github.com/JohnDuprey/kinwall/commit/6151ea646d34aa1adcc3ab0eb74d79087f9aa413))
* **lists:** shopping mode's store switcher wraps instead of cutting off ([b50297d](https://github.com/JohnDuprey/kinwall/commit/b50297d7ca6ef64efb2e718f2d35437c2860fc73))
* **lists:** smaller list fixes: wall row width, compact rows, sticky Done, sort and catalog sheet ([63799b2](https://github.com/JohnDuprey/kinwall/commit/63799b2b73beeba23d75d87018de02d9e01e07ea))
* **lists:** spell check and autocorrect list items again ([772e36d](https://github.com/JohnDuprey/kinwall/commit/772e36d2f47802da2e1398dcf3e2b516edc8665f))
* **lists:** the same words for the same things across list sheets ([58bc389](https://github.com/JohnDuprey/kinwall/commit/58bc389fc106e3ea470ba4aaa9c1442ff823911c))
* **mcp:** let output schemas accept fields added later ([af9279e](https://github.com/JohnDuprey/kinwall/commit/af9279e467c77e912c2ac956322e163990063583))
* **mcp:** say a want-to-read book is had, not wishlisted ([a57aa24](https://github.com/JohnDuprey/kinwall/commit/a57aa2465e7b702055e1fcaa94c14bf3b418301d))
* **meals:** ask only who hasn't ordered for their order ([6169c46](https://github.com/JohnDuprey/kinwall/commit/6169c46dba5e452c66d4636dbf9a48ba284ae480))
* **meals:** cap the cooking timer bar and show the soonest timer first ([e4d7cf4](https://github.com/JohnDuprey/kinwall/commit/e4d7cf4c55c325dd83224303864b14751dd5e151))
* **meals:** let a grown-up's own phone rate recipes for the kids ([2325ac6](https://github.com/JohnDuprey/kinwall/commit/2325ac6370964e7b3babf23e108755a1b8c6b898))
* **meals:** let only a grown-up lock or reopen an order night ([3cb0ef5](https://github.com/JohnDuprey/kinwall/commit/3cb0ef53f748403453221dab3497f75e7dc9bf07))
* **meals:** one text size for every cooking step ([4b28ae2](https://github.com/JohnDuprey/kinwall/commit/4b28ae246a4f00be5a336ccfe045581947e8cd6a))
* **meals:** read a phone's menu text without junk prices or split names ([698780e](https://github.com/JohnDuprey/kinwall/commit/698780e458ff51d5fbd81a9324e7043b30a6498d))
* **meals:** say an order is empty instead of tap what someone wants ([11fd7cf](https://github.com/JohnDuprey/kinwall/commit/11fd7cf1e48f7d4afb27ebf9c7d2b5c4aa9029aa))
* **meals:** size cooking mode's step text to its column, smaller for long steps ([e31d7f3](https://github.com/JohnDuprey/kinwall/commit/e31d7f3d3c43387f036051008f8b11b040b7271b))
* **meals:** use the Filter and sort button for the phone recipe library ([485c1e6](https://github.com/JohnDuprey/kinwall/commit/485c1e604fc4a84a092ae182981c289b13b3fc01))
* **medications:** add a back button and a person picker to the medicines page ([f7d6574](https://github.com/JohnDuprey/kinwall/commit/f7d6574416bcb54392fafa196dccf08e1c48eda0))
* **medications:** drop the refill toast that covered What to say ([ca8a472](https://github.com/JohnDuprey/kinwall/commit/ca8a4722b325e32b575f97b43bdae02ddd76f58d))
* **medications:** give each due dose one set of buttons on a person's page ([19b23e9](https://github.com/JohnDuprey/kinwall/commit/19b23e965f9f1cb352776dd0e8f5f9e3b868574e))
* **medications:** list pharmacies and medical contacts first in the refill pickers ([310bea7](https://github.com/JohnDuprey/kinwall/commit/310bea775068b463825e6591574785c1f80eb72d))
* **medications:** offer Add right in the row for someone with no medicines ([c3b3723](https://github.com/JohnDuprey/kinwall/commit/c3b37239150e5616c60284abb1fe9bb0fabc4ff4))
* **outings:** tidy an outing's sheet on phones ([24054b3](https://github.com/JohnDuprey/kinwall/commit/24054b36324b102ffb83b75a96f2eba02db0efec))
* **plugins:** download packages from GitHub's links, not its API ([bdf5776](https://github.com/JohnDuprey/kinwall/commit/bdf5776daf7ed87bb61fed43db358d2dc478cb3f))
* **plugins:** unlock speech on Kinwall's first tap so Safari can speak for plugins ([51fd012](https://github.com/JohnDuprey/kinwall/commit/51fd01244d5142975932f56df56d69db54db3c3c))
* **polls:** rename close poll to end voting and make it secondary ([2d95360](https://github.com/JohnDuprey/kinwall/commit/2d95360e73e03e4019c095addb153bb07ea520a8))
* **rewards:** count reward requests in one nav badge, not on Chores too ([3e33770](https://github.com/JohnDuprey/kinwall/commit/3e33770c206ebcb35fed3dc73078f8d66dfd7a47))
* **rewards:** don't leave a sticky error after a failed background refresh ([32a21c1](https://github.com/JohnDuprey/kinwall/commit/32a21c1d8f0fab2420678b76e1aafa8485ae873f))
* **rewards:** let a kid pick who splits a reward, with steppers that add up ([a0ea566](https://github.com/JohnDuprey/kinwall/commit/a0ea566ed533959126e6049381e5300b3c32bc93))
* **rewards:** list approved rewards under Ask a grown-up to hand it over ([4c522a1](https://github.com/JohnDuprey/kinwall/commit/4c522a1c6f1af404da046f1a4804e950f88e156d))
* **rewards:** open a parent's Rewards on a kid and put Manage rewards on top ([708ed2c](https://github.com/JohnDuprey/kinwall/commit/708ed2ce928854cd4e6581d25987fb0f7ec8a012))
* **rewards:** say what spending does to a goal and to a promised split share ([7f49f6f](https://github.com/JohnDuprey/kinwall/commit/7f49f6f8042a3c1100fba99bf08016147025b0d2))
* **server:** loop the tag strips inline so every pass is repeated ([d0aeea7](https://github.com/JohnDuprey/kinwall/commit/d0aeea7ed31b38f7eedddfe2b3f0c2797add3743))
* **server:** make the menu, share, page and notes parsers linear ([70bd683](https://github.com/JohnDuprey/kinwall/commit/70bd683805c5de9210dec7b0a166b055971d0121))
* **server:** never echo a passed-in admin key in the Cloudflare setup ([45de9c1](https://github.com/JohnDuprey/kinwall/commit/45de9c13606c9b2f7f538272880eaf8e0ad6ead6))
* **server:** never fetch an Apple Maps link shared as a recipe ([750c03a](https://github.com/JohnDuprey/kinwall/commit/750c03affaa17828dff01ccb31f65a4232ae0a1f))
* **server:** never update a reviewed plugin outside the catalog ([9fe1652](https://github.com/JohnDuprey/kinwall/commit/9fe1652f6f19426ba210f5e130b7cea5c863c728))
* **server:** point feature-off messages at Settings → General → Features ([7aaab26](https://github.com/JohnDuprey/kinwall/commit/7aaab261f612b6da68ca9f0ab086f32e741c78dc))
* **server:** read a party invite's name and two-line place off a photo ([358616f](https://github.com/JohnDuprey/kinwall/commit/358616f2ec42ba5dfbd940bf5bdd8160c0bdc6e8))
* **server:** strip tags until stable in recipe and event-notes text ([9e40196](https://github.com/JohnDuprey/kinwall/commit/9e40196f1eb4aa56b3c06ae0e242658c7dbbbfd5))
* **settings:** explain Google and Outlook app setup before the form ([6a52126](https://github.com/JohnDuprey/kinwall/commit/6a52126bfcf18828bd4cb63cf4119a162a3b827d))
* **settings:** explain the 🏠 chips and say "the family's", not Household ([e38068d](https://github.com/JohnDuprey/kinwall/commit/e38068dac13ae4c2abf2164205f01bae4c362795))
* **settings:** find Appearance by "theme" and stop capitalizing searches ([e1cc92d](https://github.com/JohnDuprey/kinwall/commit/e1cc92dfa9f92958fbaa15450dc17f8f708a2e4e))
* **settings:** finish the dangling sentence in the Night sheet ([70f1e49](https://github.com/JohnDuprey/kinwall/commit/70f1e4924bd9035b905eb56be3f7e4f012aa6481))
* **settings:** fold connected apps, API keys and webhooks under Advanced ([7758d2d](https://github.com/JohnDuprey/kinwall/commit/7758d2d774ceb17822e8e0d889ad3304ba2aeb01))
* **settings:** group This display into layout and wall-screen behavior ([6ea37ae](https://github.com/JohnDuprey/kinwall/commit/6ea37aede1ad8b27c31f3e3a367273d25fad67ad))
* **settings:** label every text field in the setup wizard ([afdb60b](https://github.com/JohnDuprey/kinwall/commit/afdb60b902a9e6be40906844025b68bd91d5f4f4))
* **settings:** make each calendar row one Edit button with a chevron ([e0a791d](https://github.com/JohnDuprey/kinwall/commit/e0a791ddeaaed110918a3f69ec2f44da91d4e2d5))
* **settings:** offer a shared choice in setup's whose device step ([fdbbf63](https://github.com/JohnDuprey/kinwall/commit/fdbbf638c6765847fe83936bac8cafa86e8f32f0))
* **settings:** only fold general's cards that hold more than one control ([d05b4d0](https://github.com/JohnDuprey/kinwall/commit/d05b4d08775e7854dde1da08e7b442d7164eac21))
* **settings:** plainer setup wizard steps for a parent who didn't run the server ([88d87a7](https://github.com/JohnDuprey/kinwall/commit/88d87a74f20a7b86c7facfd62450d027ee6b7a9f))
* **settings:** raise category rows and Copy to 44px, and keep the family name in the header ([b98d4c5](https://github.com/JohnDuprey/kinwall/commit/b98d4c5cc4a75b152b7145e9bac47546b243e644))
* **settings:** say "Shared (whole family)" for a device that's no one's ([e323e8d](https://github.com/JohnDuprey/kinwall/commit/e323e8dfa310fb701df2e5bf68bc5edfe4a89acc))
* **settings:** say This phone or This screen, not This display ([7b865e1](https://github.com/JohnDuprey/kinwall/commit/7b865e19c5e10992dfa07c4d464116796d8ff70c))
* **settings:** say what a paired device is now when its role changes ([7573cef](https://github.com/JohnDuprey/kinwall/commit/7573cef38f49d7006aa0ae689359be73dc650449))
* **settings:** show a visible Settings title above the tabs ([a39f802](https://github.com/JohnDuprey/kinwall/commit/a39f802c264ba6b019ed9067f081895da44c6208))
* **settings:** show the jump chips when a link opens Family or Access ([7f7af25](https://github.com/JohnDuprey/kinwall/commit/7f7af2567775a1d6f1e36a04a5d154bde740cf00))
* **setup:** let a hosted setup link's key continue on the welcome step ([45196e8](https://github.com/JohnDuprey/kinwall/commit/45196e89280e4dab1255770c91b9f21d23f50f64))
* **share:** treat a Google Maps place like an Apple Maps one, not a recipe page ([36d8314](https://github.com/JohnDuprey/kinwall/commit/36d831468d1da8d0692d4899b5bf6f2e2aa36a8b))
* **snapshot:** list meals by time and mark a late to-do with a warning ([e0f1405](https://github.com/JohnDuprey/kinwall/commit/e0f140597c19f404113cd53fa23d3f5ca06b1885))
* **snapshot:** show a chore's start time and the person's points in their day ([6be2822](https://github.com/JohnDuprey/kinwall/commit/6be2822bb51ab5e9daabf44c96d5f71750076eb2))
* **sync:** add the first checklist item to a Microsoft To Do task ([fd77125](https://github.com/JohnDuprey/kinwall/commit/fd77125ae3b022dc8c66691bc201b7001b870a14))
* **sync:** reopen a Google task before its subtasks ([f71e774](https://github.com/JohnDuprey/kinwall/commit/f71e7741e905eb898d156bdf4d8bcd8c5ceafc90))
* **trackers:** adding a book by ISBN finds its ISBN-less twin ([e3e690c](https://github.com/JohnDuprey/kinwall/commit/e3e690c04c23e0fe99f938b78a4197f7f9a9c4dd))
* **trackers:** count the library's sort on the Filters button ([b6e9735](https://github.com/JohnDuprey/kinwall/commit/b6e97357b0190e47635f1a45c2e374a2a6e4366f))
* **trackers:** fit the library header on one row on phones ([9db91b5](https://github.com/JohnDuprey/kinwall/commit/9db91b5580c0efe3d9f119aa646825e2dfc3d109))
* **trackers:** make a new health visit pick whose it is ([d548511](https://github.com/JohnDuprey/kinwall/commit/d548511e07ce844fb6362e36ccf1158b9c2e6e05))
* **trackers:** name the Pick buttons after what they show ([b626e6b](https://github.com/JohnDuprey/kinwall/commit/b626e6b4910b2afbe2be517c5656c74a1638b801))
* **trackers:** put Covers first in the library's view switch ([c1ddeb8](https://github.com/JohnDuprey/kinwall/commit/c1ddeb8b3fd9c7aa255e428f32a8919624decc8e))
* **trackers:** put the Books heading inside its bookcase ([fcb26bb](https://github.com/JohnDuprey/kinwall/commit/fcb26bba0d35467b8e39f6378073bc5579a14be7))
* **trackers:** put the library search beside the tabs on tablets ([c88ead4](https://github.com/JohnDuprey/kinwall/commit/c88ead4650bccf65ff7ed698cb3bb30ff6bface5))
* **trackers:** put the library search beside the view picker on phones ([19f2bde](https://github.com/JohnDuprey/kinwall/commit/19f2bde90cce5696d8cb1fa6af40fc99e54a1758))
* **trackers:** say why a book lookup failed ([2684ad3](https://github.com/JohnDuprey/kinwall/commit/2684ad329421c63f0909cf3b515f21cb928ed8eb))
* **trackers:** show books the same way in Reading and the library ([bc85e24](https://github.com/JohnDuprey/kinwall/commit/bc85e2448f79fc1a76de932c1a64067f6f54b4ff))
* **trackers:** show the library's sort and filters on the count row ([3521c05](https://github.com/JohnDuprey/kinwall/commit/3521c05c33927dcd44c009ce3ca8cb8b00754655))
* **trackers:** want to read isn't the wishlist, and the library filters reach the server ([ddea412](https://github.com/JohnDuprey/kinwall/commit/ddea412e0e63bde53d603bae86483e6b751fa536))
* **trackers:** wrap the library search under the tabs when it won't fit ([acae167](https://github.com/JohnDuprey/kinwall/commit/acae167a6dbc7e3af2c2fff7561cc671f3a8a74a))
* **web:** 3:1 outlines for unticked checks, unrated stars and off switches ([dc8480a](https://github.com/JohnDuprey/kinwall/commit/dc8480ac71aaa4ef49e247cca38062fb8f9134ae))
* **web:** 44px pick chips in sheets and toasts above the add button ([85d7c62](https://github.com/JohnDuprey/kinwall/commit/85d7c622aa1759f288f8774a03ba35c39765ebe6))
* **web:** a wall screen goes back Home after 10 minutes in a text field ([fad9c10](https://github.com/JohnDuprey/kinwall/commit/fad9c10bbcf728abb5d25e0f13471ec87f92f105))
* **web:** answer only the plugin sandbox and keep its frame on kinwall ([b58dd37](https://github.com/JohnDuprey/kinwall/commit/b58dd376eb8fb483464fa9d12f84848a3585ee42))
* **web:** ask "Discard changes?" before a stray tap loses a form ([b900a7a](https://github.com/JohnDuprey/kinwall/commit/b900a7a181df06f702ccc8093a37e455d02b8597))
* **web:** bring back the Night screen's art and its captions ([37b6c42](https://github.com/JohnDuprey/kinwall/commit/37b6c42384750d7d6003fa0dc6d84f0688c83ad8))
* **web:** call the Meals, Outings and Trackers group Spaces, not Nooks ([6d4dc58](https://github.com/JohnDuprey/kinwall/commit/6d4dc58be3e5ccd358f1fa3c1eb8ffc8a7107446))
* **web:** clear the status-bar fade in Shopping, Cooking and Get stuff done ([900588f](https://github.com/JohnDuprey/kinwall/commit/900588f635a09c509dd32f35e2767eb67f239c39))
* **web:** don't ask for a department after a scan when the aisle is known ([0c599ef](https://github.com/JohnDuprey/kinwall/commit/0c599ef1b234e54c2b9da170c99aaf2a57506fbf))
* **web:** don't pad for Android's system bars twice in the app ([0203e81](https://github.com/JohnDuprey/kinwall/commit/0203e81c78c85ce3b2461c6a9a63ee20632b86e2))
* **web:** fit the board, calendar toolbar and meal planner on mid-size tablets ([0bbdc93](https://github.com/JohnDuprey/kinwall/commit/0bbdc9325ca7394170cfeccafdfb0f8b3ae41083))
* **web:** fit the rail, header and list on a phone on its side ([b007b48](https://github.com/JohnDuprey/kinwall/commit/b007b48468cab5dff6f249bb907bbd79fa3f17b3))
* **web:** focus Cancel, not the destructive button, in delete dialogs ([a8dad50](https://github.com/JohnDuprey/kinwall/commit/a8dad50bb47ca7facdbf1bd9f9dda399a0031a34))
* **web:** give an activity the room above the on-screen keyboard ([8865a87](https://github.com/JohnDuprey/kinwall/commit/8865a87339dc25e176554022cc51f8aa318dbc84))
* **web:** give header faces, calendar toolbar icons and links a 44px tap ([fed70ab](https://github.com/JohnDuprey/kinwall/commit/fed70abe133273d01313aac3fb1596d4b1781d18))
* **web:** give short tablets and phones on their side the height back ([b2f90e8](https://github.com/JohnDuprey/kinwall/commit/b2f90e8c79721c081d140baf666fbfd453084a7a))
* **web:** give the header's people their own row on portrait tablets ([c765f3f](https://github.com/JohnDuprey/kinwall/commit/c765f3fb1b942dfad3e8d24fa199e57ed14d1dc7))
* **web:** hide the side menu too while typing in an activity ([d7fea94](https://github.com/JohnDuprey/kinwall/commit/d7fea947428d6364c2b3d9881f0e5e40c40c5147))
* **web:** hold the device's audio only while kinwall makes a sound ([3ecd10a](https://github.com/JohnDuprey/kinwall/commit/3ecd10adfb71c7174958a422f01e4fe6df089c0b))
* **web:** keep "in" and "leave" in the phone's Now and next ([e44f7d3](https://github.com/JohnDuprey/kinwall/commit/e44f7d325ce2a3057c55ce2b5a87d8fbe137fbbf))
* **web:** keep a sheet below the status bar while typing on an iPhone ([d0ddc5e](https://github.com/JohnDuprey/kinwall/commit/d0ddc5ec075d1bde3cc94292af77f0cc0775c6b8))
* **web:** keep a toast's action up while hovered, focused or tabbed to ([f0f5b3b](https://github.com/JohnDuprey/kinwall/commit/f0f5b3ba4afa0ba2f161cb605088eb80317f4f12))
* **web:** keep an activity's top bar to one row on phones ([6bc137f](https://github.com/JohnDuprey/kinwall/commit/6bc137fc73ad8c6e94bbacb960642f30fce26a62))
* **web:** keep cooking and get stuff done open on a wall screen ([3ffa133](https://github.com/JohnDuprey/kinwall/commit/3ffa133ad08bdcf43c0e42934e5b937bd1d04f92))
* **web:** keep the field and its save button above the on-screen keyboard ([e7db08d](https://github.com/JohnDuprey/kinwall/commit/e7db08d6a36d8165300cb5d4195719313e407ff4))
* **web:** keep the iPhone app's page out from under the island while typing ([460d7c8](https://github.com/JohnDuprey/kinwall/commit/460d7c85d5515e1e67afcd977c37044f7ea12324))
* **web:** keep the Me avatar round on a crowded nav rail ([d0e97b3](https://github.com/JohnDuprey/kinwall/commit/d0e97b3b26cfa284b63227e1d8e945537ec51cb3))
* **web:** keep the More sheet's link from bouncing back on iPhone ([c39ffff](https://github.com/JohnDuprey/kinwall/commit/c39fffff1724bf9d8f8e163296ef7584eb39e1e1))
* **web:** keep toasts above a sheet's buttons ([722bf0d](https://github.com/JohnDuprey/kinwall/commit/722bf0d684c25e773d473070d8f4b1835759215d))
* **web:** label the family sheet's show-only button ([ea3668e](https://github.com/JohnDuprey/kinwall/commit/ea3668e607404b19307859f2bd17a1b89bead7ca))
* **web:** label the Night screen preview and back its clock ([6e636a0](https://github.com/JohnDuprey/kinwall/commit/6e636a0bcf993447cffdcc612ca96859b220e56c))
* **web:** lead a profile with the journal and insights, with one privacy label ([8c61c0c](https://github.com/JohnDuprey/kinwall/commit/8c61c0c0cd7e767fb57c2e81d0cf46672988379a))
* **web:** leave the name off the app's loading screen, like its splash ([912e2a9](https://github.com/JohnDuprey/kinwall/commit/912e2a9a1eb4597762bde34543f0e75ceae0d205))
* **web:** line up emoji and picture faces on calendar events ([8a7a4bb](https://github.com/JohnDuprey/kinwall/commit/8a7a4bb25bcb381d9ab47474ec091821fe2fea2c))
* **web:** make the demo's points behave like the server's ([eb91ce9](https://github.com/JohnDuprey/kinwall/commit/eb91ce934b0fcf5c5a485883ef91d04831035da5))
* **web:** move Delete and Archive out of sheet footers ([7cd4dea](https://github.com/JohnDuprey/kinwall/commit/7cd4dea3d53eecb0c899e2553c56bfee36a7d66e))
* **web:** name every filter button and its sheet "Filter and sort" ([617b16e](https://github.com/JohnDuprey/kinwall/commit/617b16eee5229fa1b802fd60246dea2534563134))
* **web:** never leave the page blank when the app fails to start ([3d2fd9a](https://github.com/JohnDuprey/kinwall/commit/3d2fd9ade7c76ab5a93eb2e238a726cbb39c09f0))
* **web:** one shared load-error state with Try again ([c70700b](https://github.com/JohnDuprey/kinwall/commit/c70700b71999d43594559d2fc2c9b8b12e090618))
* **web:** put the rail's extra screens in a More sheet on a phone on its side ([df19f3b](https://github.com/JohnDuprey/kinwall/commit/df19f3b652de17ab522de3ec5a80792c128dc53e))
* **web:** render only safe photo previews and hash every inline script ([0f4c689](https://github.com/JohnDuprey/kinwall/commit/0f4c689db310dd7d8d9d95a0ff154e68a55c5aeb))
* **web:** say "That isn't here anymore" for an unknown profile link ([a10b067](https://github.com/JohnDuprey/kinwall/commit/a10b067a35592a349315e601fcf9208780d5ff57))
* **web:** say Family default, not Household default, in two menus ([3b66926](https://github.com/JohnDuprey/kinwall/commit/3b6692642f9308cdb7c2323ac49755017a9edee2))
* **web:** say Save for edits and Add &lt;thing&gt; for new ones in sheet footers ([5a44147](https://github.com/JohnDuprey/kinwall/commit/5a44147a89e142962768188b747a64492626f643))
* **web:** say to-do, not task, on events and label optional fields ([50da51b](https://github.com/JohnDuprey/kinwall/commit/50da51b760418374f9e97846eae3d30f1dbf5a90))
* **web:** scroll sign-in and pairing cards on a short screen ([4f1b6c7](https://github.com/JohnDuprey/kinwall/commit/4f1b6c706bc6701e8e44fa3a6f99228dbfa8e949))
* **web:** share history between an activity and its Who's playing? sheet ([c140401](https://github.com/JohnDuprey/kinwall/commit/c140401002378f54ae978d25b6802aa0cc039dc8))
* **web:** show-only wording covers all of Kinwall, not just the calendar ([eaa08c2](https://github.com/JohnDuprey/kinwall/commit/eaa08c24e145058c165a3360415f3042092219d8))
* **web:** size the loading screen's name from the mark ([76c8f53](https://github.com/JohnDuprey/kinwall/commit/76c8f531a77222973addf00ede8996fa89ca7dd6))
* **web:** stop cutting the phone Day title and the family name ([10d1499](https://github.com/JohnDuprey/kinwall/commit/10d1499fdd426414a1b4a5bd497c500dfa2f95f6))
* **web:** tell the app shell where the page is on every screen change ([2e9dead](https://github.com/JohnDuprey/kinwall/commit/2e9deade6378067d13158cb420a7a292445d0aa1))
* **web:** text that fits on phones and grows on walls ([075aa0c](https://github.com/JohnDuprey/kinwall/commit/075aa0cc14f3a2ee1261f20c781e1a6867609f55))
* **web:** tidy Photos and the sticker book on phones ([12cac36](https://github.com/JohnDuprey/kinwall/commit/12cac36cd4271377787b2c06157f9fea373d8b12))
* **web:** trim the side without the island on an iPhone on its side ([769982f](https://github.com/JohnDuprey/kinwall/commit/769982f39c819468f4cdae0dcdfcf6b901814e27))
* **web:** use the phone header on portrait tablets ([f790247](https://github.com/JohnDuprey/kinwall/commit/f79024784437f7eb321daeac44bc02e0b71c0291))
* **web:** wrap the Paint toolbar to two rows on phones ([7858990](https://github.com/JohnDuprey/kinwall/commit/785899017a609af04be1c6374f2a23b53ad47f81))


### Reverted

* **web:** keep the name on the app's loading screen ([dd20671](https://github.com/JohnDuprey/kinwall/commit/dd2067103bbeed59231ed2b7fa26b285da59899c))


### Chores

* keep the next release at 1.2.0 ([6693109](https://github.com/JohnDuprey/kinwall/commit/669310947ffd7d07e87a4f8e4398972e53094c6f))

## [1.1.0](https://github.com/JohnDuprey/kinwall/compare/v1.0.3...v1.1.0) (2026-10-02)

A big one: a Board view for the wall, meal planning and recipes, groceries that follow the store,
rewards, medications, daily check-ins, private journals, a family library, Newscast, Night, a new
logo and a lot more. Kids' devices and wall screens can change less than before. Self-hosting?
Read [Upgrading](#upgrading) first.

### Board

* A new **Board** view, now the default: the family's day at a glance with the clock, weather,
  today, coming up, due soon, chores, a rotating picture and a quote or fact.
* **Layouts per screen**: each screen uses the family's arrangement, a built-in layout (Kids,
  Kitchen, Parents, Simple), a family preset or its own. Place cards in one to four columns by
  drag and drop, with a height and text size for each card. Parents save family presets.
* The quote card can show fun facts, "On this day", trivia you tap to answer, or practical tips
  for routines, focus and feelings. Pick the sources in Settings → Quotes & facts, or give a
  screen **up to three cards** of its own, each with its own sources.
* **Count tiles** for chores, due soon, groceries, shopping and reward requests on smaller
  screens, with full cards on big ones. Each display picks Counts, Full lists or Auto, and tiles
  fill the grid without gaps.
* On a kid's device or a screen showing one person, chores, goals, due soon and reward requests
  count only that person (plus the family's unassigned ones).
* A **Take now** tile for medicines that are due.
* On a phone, **today's weather sits beside the time** on the clock card (temperature, condition,
  high and low, rain), so the card is about a fifth shorter. Narrow cards and big text keep the
  stacked layout.
* A **Finish setting up Kinwall** card on a parent's phone or computer lists only what's missing
  (a calendar, a wall screen, more people, a second way in), each linking to the right spot in
  Settings. Not now hides it for 30 days.
* Library books due back show on their day, and overdue ones stay on today.
* Tap a meal to open it right on the Board instead of jumping to Meals.
* On a wall screen the Board fits the screen, with "+3 more" for the rest.
* Pictures show whole, never cropped.

### Night

* **Quiet hours are now Night**: one family schedule, the night hours, with two effects you can
  turn off on their own: **wall screens rest** on the Night screen and **reminders wait** until
  morning. Families that had quiet hours keep both on, so nothing changes.
* What wall screens show at night, the **PIN to wake** and the moon button all live in the Night
  card under Settings → General → For the whole family. Each screen follows the family's choice
  unless it picks its own.
* Dark mode can follow the same schedule (**Dark hours: Same as night**) under Appearance.
* Tap the screen to wake it; it goes back to the Night screen after five minutes.
* Start and end the Night screen on wall screens from Home Assistant, for example when nobody's
  home.

### Medications

* **Medicine reminders**: a medicine's name, dose and times for each person. Their own devices
  get a reminder, and a **Take now** card offers Taken, Skip and Snooze.
* **Courses** that end on a date or after a number of doses, for things like antibiotics.
* Medicines live in **Trackers → Health**, added from parent devices.
* A different cheer each time you tap Taken (one calm line in low-stimulation mode).
* Each medicine says **how late it can be taken**. A long late window gets one kind follow-up,
  and a dose taken late asks **"When did you take it?"**
* **"When I start my day"** doses, reminded when the person starts their day instead of at a
  set time.
* **Catch up** on doses nobody marked from the person's page.
* Parents hear about a kid's missed dose once the late window has passed, and medicine
  reminders come through at night too.
* The Health tab can switch **whose health** it shows, and each person's medicines fold up to a
  name and a count until tapped.

### Check-ins and journals

* **Temp check**: a few quick questions at the end of a person's day: how they slept, how they
  feel and a goal for today, which shows on the Board.
* **Check-in points**: reading your day to the end and tapping "I'm all caught up" can earn
  points (Settings → Family, off by default, and only while Chores & points is on).
* An evening **goal check** ("Did you finish your goal?") with optional notes, and a personal
  **journal**.
* **Private journals**: a grown-up's journal is private by default, including what they already
  wrote, and opens only on their own devices. A parent can let a kid keep a private journal too.
  Everyone else, parents included, sees the mood and that an entry exists, so Insights and the
  battery keep working.
* Last night's check-in **stays open until the next morning** (noon, the morning Temp check or a
  skip), with one gentle reminder in the morning.
* A **drained check-in** ("How drained do you feel?") when the energy battery is on.
* A **Check-ins & journal** switch in Settings → Features turns off Temp check, goal checks, the
  energy battery, journals and Insights for the whole family (on by default; nothing is deleted).

### Insights and the energy battery

* **Insights** for each person: sleep, feelings, goals, chores and busy days as charts, with
  plain summaries and, after three weeks of check-ins, the connections that show up.
* The **Energy battery**: a rough daily energy level from sleep, feelings, events, chores and
  goals, with a heads-up the evening before a day that looks heavy. It learns from drained
  check-ins.

### Recipes and meals

* **Meal planning**: plan the week's meals, see who's eating, and add the ingredients to your
  Groceries list. Thanks to [@OwenIbarra](https://github.com/OwenIbarra) for contributing it.
* On phones the planner opens on **today**, with a Day/Week switch. **Swap** sits right under the
  meal's name.
* Put meals on **any calendar** at your usual meal times; the event follows the meal.
* **Import recipes** from any website link, pasted text or a meal kit, with step photos,
  bullets and timers kept. When a link would update a recipe you already have, Kinwall says
  which one and offers Save as a new recipe.
* **Cooking mode**: full screen, one step at a time, with the step's photo, its ingredients and
  its own named timers you can pause, resume and reset. The screen stays on while a recipe is
  open.
* **Ratings**: everyone can give a recipe 1 to 5 stars, with a Top rated sort.
* **Share links** for a recipe, with a link preview. A link shared from one Kinwall imports into
  another with nothing lost.
* **Basics** like a spice blend, sauce or dough that other recipes link to. When you add
  groceries, Kinwall asks if they're made already.
* Choose a meal's recipe from a **searchable picker**, and **swap** a planned meal with another
  one later in the week.

### Timers

* **Quick timers from the header** for homework, chores or anything else, shared with cooking
  mode. Timers keep running when you close a sheet, leave cooking mode or reload, and ring over
  everything, the Night screen included.

### Lists and groceries

* Shopping lists are now **Groceries** or **Shopping**, each with its own remembered items, so
  hardware-store things stop showing up on the grocery list. Existing lists are sorted into one
  or the other by name.
* A **catalog** of remembered items: browse and search them, fix a name, set the department and
  the aisle at each store, tag them with your own **categories** (Breakfast, Lunchbox,
  Cleaning…) and filter, sort or group by them.
* Grocery items remember their **store, aisle and department**, sort in aisle order, and stay
  crossed off in place until **Checkout** (with undo).
* **Shopping mode**: one store's trip, full screen, in walking order, grouped by aisle. Walk the
  aisles **in reverse** when you come in the other door. At a store that sells both, the trip
  shows your Groceries and Shopping items together.
* **Scan products** onto a list with the Kinwall app's camera. A product the family added before
  goes straight on under the family's name for it. Anything new is looked up in
  [Open Food Facts](https://world.openfoodfacts.org), then its sister databases
  [Open Products Facts](https://world.openproductsfacts.org),
  [Open Beauty Facts](https://world.openbeautyfacts.org) and
  [Open Pet Food Facts](https://world.openpetfoodfacts.org), so household, beauty and pet items
  are found too. A sheet shows the name (brand first) to check, starts it on Groceries or Shopping
  by what it is, and can save the barcode to the catalog. Only the barcode is sent, by the server.
* In Shopping mode, **scan to check items off** (or add them already checked off), and Kinwall asks
  which aisle it was in when it doesn't know yet. Wall screens scan with the front camera.
* A **default list** for each type: scans, meal ingredients, the Kinwall app's widgets and Siri,
  and connected assistants use it.
* **Move** an item to another list of the same type.
* See **who added and who checked off** an item, and when a reusable list was last done.
* **Swipe an item left** to delete it on a parent's device, with Undo.
* Each list's card shows how many items are **overdue**.
* A to-do's priority shows as a labeled badge.
* **Autocomplete** when adding shopping items.
* The Lists page groups lists into **Shopping, To-dos and Reusable** sections, and parents can
  **reorder** them.
* An item's notes get more room to read.
* **Offline**: the app opens without a connection, and list and chore changes sync when it's
  back.

### Chores and rewards

* **Chore library** for occasional jobs that don't fit a schedule (clean out the car, wash the
  windows): save them once, then hand one out from Chores → Library in a few taps (who, then Today,
  Tomorrow, This weekend or a date). An optional "about every N weeks" shows when it was last done
  and floats due-ish jobs to the top. New families start with eight common ones. Parent devices
  only. MCP `list_chore_library` and `assign_chore_from_library`.
* **Rewards** that kids spend chore points on, with limits, goals on the Board and parent
  approval. A kid can **cancel their own request** while it's still waiting, and gets the points
  back, and a quiet **Stop saving** button sits under the goal.
* Optional **parent approval** for chores: a tick waits for a parent's OK before it earns points.
* **Chore checklists**: link a list to a chore, and it's done once every item is ticked.
* **Activity chores** like "5 min of Sight words", done by playing.
* Ticking an Anyone chore asks who did it, so the right person gets the points.
* Chores can be ticked off from a person's day.
* A **Rewards** switch in Settings → Family → Chores (`rewardsEnabled`, on by default), for
  families who'd rather spend points only on stickers.

### Profiles and family

* A **profile** for each person: chores and points over time, streaks, their bookshelf, badges,
  sticker book and a birthday countdown when it's close.
* Kids can **pick their own avatar** on their own device.
* **Grown-ups**: mark a member as a grown-up, and their chores never wait for an OK. First-time
  setup asks Grown-up or Kid for each person.
* **Transition reminders** for each person before their events, with warning times you pick
  and repeat, and friendly headlines that change from day to day.
* **Start prep by**: a meal's event counts down to when to start cooking, not just when to leave.
* Tap the family name on a phone to filter to one person or open their day.

### Newscast

* A fourth Home tab: a 30-day digest built from chores, rewards given, photos and drawings, books,
  memories and birthdays, plus announcements (up to 280 characters, optional emoji and photo,
  everyone or grown-ups only) and 👏 ❤️ 🎉 reactions shown as faces. Wall screens ask who's
  reacting. Tap a photo or drawing to see it full size. Parents can take a post down or pause a
  kid's posting; anyone can opt out of being featured. Off switch under Settings → Features. API `GET /api/newscast`, MCP `list_newscast`,
  webhook `newscast.posted`.

### Calendar

* The main screen is called **Home** in the navigation, and its views are Board | Calendar |
  Schedule: Calendar opens in place into Day, Week (3 Day on phones) and Month and remembers the
  last one per device. The phone view sheet has the same structure. `#/home` is an alias for
  `#/calendar`, which keeps working for links, notifications, widgets and Home Assistant.
* **Filter a calendar**: show only the events that match, or hide them, by keywords, all-day or
  timed, and category, with presets like "School: days off & half days".
* **Hide an event**, its whole series or every event like it, even on read-only calendars.
  Parents can show hidden events faded, and bring them back from Settings.
* **Free or busy**: events marked free (synced both ways with Google, Outlook, iCloud and
  CalDAV) are striped, sit behind busy ones, and don't count for Now / Next, leave-by,
  transition reminders or the energy battery.
* **Day view is one shared timeline**, like Week: events at the same time sit side by side with
  the faces of who they're for, and an event on two calendars shows once with everyone from both.
* **Notes on events**: write them under Location; they show labeled, with links you can tap. The
  event's comment thread is now called Discussion. Outlook events keep their full description
  instead of the first 255 characters, and editing one no longer cuts it down.
* On phones, tap a day in Month to open it in Day view, with Back to Month. The + button adds to
  the day on screen.
* **A calendar that stops syncing** shows a warning on Home on parent devices after two failed
  syncs in a row, with a link to fix it in Settings → Calendars.
* On phones, switch views from one button instead of five cramped tabs.
* Clocks change right on the minute, and a traveling phone or laptop can show **its own time
  zone** on the clock (chores, reminders and "today" stay on family time).
* Sync writes only the events that changed instead of rewriting them all.
* Signing in to a calendar account that fails now brings you back to Settings with a message.
* Google Calendar asks for narrower scopes: `calendar.events` and
  `calendar.calendarlist.readonly` replace `calendar.readonly`, which was only used to list
  calendars. Setup steps say which scopes to declare.

### Contacts

* A household **contacts directory** for people, services and places, with vCard import and a
  duplicate review. Thanks to [@OwenIbarra](https://github.com/OwenIbarra) for contributing it.
* Importing from a phone keeps every phone number, email, address, label, date and company, and
  the review shows everything before you save.
* **FaceTime** a contact from their sheet on Apple devices.
* Visibility levels that mean something: everyone, grown-ups only, chosen people or parents
  only.

### Trackers

* Track **reading**, **memories** and **health** visits for each person or the whole family.
* **Audiobooks** in the reading tracker, with listening time and a narrator.
* **Look up a book** in [Open Library](https://openlibrary.org) by the
  [Internet Archive](https://archive.org) to fill in the title, author, pages and cover, or scan
  its barcode with the Kinwall app. The server fetches covers, so screens never contact Open
  Library.
* A book keeps **pages read each day**, shown as the last 14 days in its sheet. A shelf shows
  what's being read and wanted, then the last three finished, with Show all.
* A **family library** of the books you own: scan them in one after another or search, with series,
  reading level and description. Say where each one lives, lend it to someone, track books
  **borrowed** from the town library or a friend with a due date (a heads-up two days before and on
  the day), and keep a **wishlist**. Read it starts a reading entry (or links the one someone
  already has), and Save to library works the other way.
* Trackers pick Reading, Library, Memories or Health from one view picker.

### Activities and photos

* **Family photos** for the Board, the Night screen and a Photos page. Save a Paint drawing to
  them.
* Add **activities made by others**, like Sight words and Math practice, from a list reviewed
  for Kinwall. They run sandboxed, away from your family's data.
* Paint has forty colors plus any color you pick, **brushes** (Marker, Crayon, Highlighter, Spray,
  Rainbow and Stamps), Fill, and a **coloring book** of ten pages plus your own, added on a
  parent's device from a picture or a PDF.

### Appearance

* A **new Kinwall logo** everywhere: the app icon, favicon and installed-app icons, the sign-in,
  setup, pairing and loading screens, and the foot of Settings, which now shows the version with
  links to help, the source code and open-source credits. The logo's colors follow your scheme.
* Loading screens show a small spinner and a bigger logo, and in the Kinwall app the logo holds
  still from the splash screen to the loading screen.
* **Color schemes**: eighteen built-in ones, including seasons, holidays and a Modern group led by
  Peacock, plus your own with a contrast check. Pick one for the whole family, or a different one
  on a device.
* **Peacock** 🦚 is the default for new families: deep peacock blue with a sky-blue accent, the
  logo's colors. Families who never picked a scheme keep the colors they have.
* The **Modern** schemes have more color.
* **Typefaces**: seven, including Hyperlegible (Atkinson Hyperlegible Next) and
  Dyslexia-friendly (Lexend), plus Modern, Playful, Storybook and Handwritten, for the whole
  family or per device, picked from a sheet of samples.
* Kinwall follows the device's **light or dark mode** by default.
* **12-hour or 24-hour** clock times, for the family or per device.
* **Easier for colorblind eyes**: a warning when two people's colors look alike, and charts,
  priorities and categories that don't rely on color alone.
* Settings → Features turns off what your family doesn't use, like Paint, Photos, Notes or
  Check-ins & journal (thanks to [@OwenIbarra](https://github.com/OwenIbarra) for these
  switches), and Rewards has its own. What's off also leaves the Board's layout editor, the Night
  screen and Newscast, and a chore's checklist goes with Lists.

### Devices and access

* Pairing asks **what the device is**: a wall screen or a kid's device. A wall screen turns on
  Use as a wall screen by itself. Grown-ups use their own phone's sign-in instead, and first-time
  setup asks whose phone it is.
* Settings → Access groups devices by kind, with each phone's widgets nested under it. Removing
  a phone signs its widgets out too.
* **Kids' devices change only their own things**: their own calendars, list items (or
  unassigned ones), notes, tracker entries, sticker book and activity progress. Adding to a list
  still works everywhere.
* **Wall screens and kids' devices can't** rename, archive, delete or reorder lists, change the
  family's event categories, edit the grocery catalog, add, edit or delete chores, or change
  family settings. They can still tick chores and items off.
* **Kids' devices get only their own notifications** and the family's, not messages or
  reminders meant for a grown-up.
* **First-time setup starts on a phone or computer**: on a wall screen it shows a QR code that
  opens setup there with the code filled in. Setup always leaves a way back in, a passkey or, where
  the browser can't make one, recovery codes.
* The Kinwall app for iPhone and Android (1.1.0) follows the family's feature switches in Siri,
  widgets and the Apple Watch, scans barcodes, and has the new logo and splash screen.
* A Help button in the same spot on every screen.
* Phones get a new header, a More tab when there are more than five screens, landscape support
  and an install prompt.
* Old iPads (iOS 12 to 16.3) get a compatibility build.

### Home Assistant and automations

* Automations can keep their own events in sync on a local calendar, like meal kit
  deliveries.
* A weekly meal kit blueprint imports your HelloFresh meals (through the
  [HelloFresh integration](https://github.com/kedube/ha-hellofresh) by Katherine Dubé), plans them as
  dinners and can put them on a calendar.
* Recipe, meal, contact and reward events for webhooks, and chore events carry who and how many
  points.
* Kinwall tells Home Assistant which part changed (events, lists or chores), and background
  calendar syncs that change nothing stay quiet, so the integration fetches much less.
* The Kinwall integration (1.9.0) follows the family's feature switches: with Chores & points or
  Lists off, their entities aren't created and their data isn't fetched. The blueprints say which
  features they need.
* The integration and the Home Assistant app have the new logo.
* A guide for connecting Kinwall to [n8n](https://n8n.io).

### Privacy and security

* **Health data is encrypted at rest**, always, on every host: health visits, medicines, Temp
  check sleep and feelings, goal checks, journal entries and drained check-ins.
* **Connected apps** (AI assistants and MCP) get no health data unless the family turns it on in
  Settings → Access → Connected apps, and can no longer manage sign-ins, keys or other connected
  apps.
* **No more requests to Google for fonts**: every typeface ships with Kinwall. See
  [Credits](docs/contributing/credits.md).
* **Security activity** under Settings → Access on parent devices: passkeys, sign-ins, recovery
  codes, keys, paired devices, connected apps, the Night PIN and private journal changes, kept for
  a year and searchable. A new passkey or a recovery-code sign-in also notifies parents. Privacy
  notes now show only on that person's own devices, and they can dismiss them there.
* **Opening a sign-in link asks first**, naming the family and the address, so nobody can sign
  your browser into their family with a link.
* Connecting a Google or Microsoft calendar finishes only in the browser that started it.
* Photos, covers and the photo download no longer put your key in the address (where it lands in
  browser history and logs); they use media tokens and one-time links.
* Medicine reminders in the notification feed are encrypted like the medicines themselves.
* A kid's device sees only its own reward requests and point history, and wall screens no longer
  show declined requests or a parent's note.
* Marking a grown-up as a kid is refused once they have a private journal, unless it's done from
  their own device, and the change is logged.
* Connected apps can no longer subscribe to push notifications or set up webhooks.
* Unexpected errors show "Something went wrong" with a short reference, never the server's
  internals.
* A self-hosted server checks the address an outbound fetch (webhooks, calendar feeds, recipe
  pages, images) actually connects to, so a public name pointing into your home network is
  refused.
* Sign-in attempt limits count the connection's own address, not a header anyone can set.
* A link can't tick a chore off without asking first, and a tick counts only for a day the chore
  is due.
* Push notifications go only to Apple's, Google's, Microsoft's and Mozilla's push services.
* Wrong Night PIN guesses are limited per screen and per family, and wrong setup codes per
  address, so one guesser can't lock the owner out.

### Faster

* Calendar views, the Board, lists and the notification check read far less from the database.
* Self-hosted servers send the web app compressed, so a phone's first load is about twice as
  fast.
* The app refetches only what changed, and hidden tabs stop polling (wall screens keep going).
* SQLite on Node and Docker skips an extra disk sync on every write and waits briefly for a
  backup instead of failing.

### API, MCP and export

* **Breaking**: a private journal entry's `text` is `null` (in the API and in exports) for anyone
  but its owner. `DELETE /api/notifications` keeps privacy lines.
* **Breaking**: display keys get `403` on list rename, archive, delete and reorder
  (`PATCH /api/lists/{id}` takes only `sortBy`, `groupBy` and `keepChecked`), on event category
  writes, on catalog edits, and, on a kid's device, on other people's items, notes, tracker
  entries, stickers and activity progress. A display key can't be owned by a grown-up (`400`).
* **Breaking**: connected apps (OAuth) get `403` on sign-in management routes (keys, recovery
  codes, passkeys, pairing, sign-in providers, connected apps).
* **Breaking**: `GET /mcp` answers `405` instead of holding an SSE stream open.
* **Breaking**: `GET /api/oauth/{kind}/start?key=` is removed. Start a calendar connection with
  `POST /api/oauth/{kind}/start` and the `Authorization` header; the callback finishes only in the
  browser carrying the cookie it sets. An embedding host must redirect its shared OAuth callback
  to the instance (SPEC.md, "Embedding the server").
* **Breaking**: a full key as `?key=` on image routes and `GET /api/photos/export.zip` gets `401`.
  Send it in the `Authorization` header, or use `GET /api/media-token` (for `?key=` on image
  routes) and `POST /api/photos/export-link` (a one-time zip link).
* **Breaking**: request bodies over 2 MB get `413` (the photo zip, plugin packages and import keep
  their own limits); an unreadable body on `.../clear-completed` or `.../reset` is a `400` and
  changes nothing; a kid's device can assign an item only to itself or no one.
* **Breaking**: a chore completion's date must be a day the chore is due (wall screens and kids'
  devices: the last 7 days to tomorrow). Events need valid `start`, `end` and `rrule`; repeats
  finer than daily or that can never happen are refused; `from`/`to` must be dates at most 400
  days apart, and a series gives at most 1,000 instances per read. A hidden event is a `404` by id
  to display keys.
* **Breaking**: a kid's device gets `403` on other members' reward requests and only a sibling's
  balance, not their ledger. Connected apps get `403` on push subscriptions and webhooks
  (migration 0087 removes push subscriptions they already made).
* An unexpected failure answers "Something went wrong. Please try again." with a `ref` that's also
  in the server log.
* `GET /api/lists/{id}` returns empty stores, categories and aisles for non-shopping lists, and
  takes `?suggestions=false`.
* New: `revs` in `GET /api/rev`; `householdId` in `GET /api/me`; `busy` on events;
  `includeHidden=true` for parents; `itemsRev` and `overdueCount` on lists; `addedBy`,
  `checkedBy`, `lastDoneAt` and `lastDoneBy` on items; `?skipExisting=1` on adding items;
  `POST /api/lists/{id}/items/move`; the grocery catalog under `/api/lists/remembered` (with
  `?catalog=` and `?tag=`) and `/api/lists/remembered-tags`; device kinds on keys
  (`PATCH /api/keys/{id}`, `PUT /api/me/owner`); `PUT /api/members/{id}/avatar`;
  `POST /api/rewards/redemptions/{id}/cancel`; per-display sources on `GET /api/tidbits`;
  `GET /api/security-events` (parent devices, with `q`, `kinds` and `before`); `removable` on
  notifications; `syncFailures` on calendars; `isDefault` on lists;
  `/api/chore-library`; `/api/library` and `GET /api/books/search`; `coverUrl` on reading entries
  and `GET /api/trackers/{id}/cover`; `/api/lists/{id}/barcodes/{code}`; `/api/coloring-pages`.
* MCP: `list_remembered_items`, `update_remembered_item` and `move_list_items`; `groceries` as a
  list kind; `busy` on events; `list_library`, `add_to_library`, `update_library_book` and
  `search_books`; `isDefault` on `update_list`, and `add_list_items` with no list uses the default
  Groceries list.
* Export: `itemBarcodes`, `libraryBooks` and `choreLibrary` are included; older files still import.
* Older export files (without `overdueCount`) still import.
* `GET /api/board` and `GET /api/snapshot` (and MCP `get_board` / `get_snapshot`) answer empty
  `chores` while Chores & points is off and empty `items` while Lists is off, in the same shape.
* New settings: `features.checkIns` and `rewardsEnabled` (both default on). Reward requests
  answer `403` while rewards are off.

### Fixed

* The **update banner** no longer shows for good inside Home Assistant.
* A calendar feed no longer loses every event when its last event is old.
* Deleting a chore keeps the points already earned from it.
* Marking a chore not done asks first, so a stray tap doesn't take points back.
* The update banner no longer gets stuck behind cooking mode or shopping mode.
* A refresh no longer flashes the default colors before your color scheme loads.
* A browser tab and the installed app no longer fight over the saved look and pin the CPU.
* Recipe ratings and steps no longer show twice.
* Shared recipe pages no longer fail on an old recipe's source link, and skip photos they can't
  show.
* Foggy weather shows a cloud instead of a gray square on iPhone and iPad.
* Profile sections no longer squash on short screens.
* Contact phone numbers survive a vCard import with a photo, and one bad value no longer fails
  the whole import.
* Merged contacts stay as private as the stricter copy.
* Passkeys work behind Home Assistant's ingress, and other proxies, when Home Assistant serves
  https itself (also in 1.0.3).
* Passkeys work in the Home Assistant app (add-on) without setting `PUBLIC_URL`: requests through the
  Supervisor's ingress proxy (172.30.32.2 only) use the browser's own address, even when an
  upstream proxy rewrites Host. A page on the wrong address gets a clear 400 naming the right one.
  Inside a frame (Safari refuses passkeys there), Settings links to Kinwall in its own tab.
* Contact import keeps Apple and Android labels, names, departments, yearless birthdays,
  anniversaries and extensions. The review matches the contact editor and offers to update a
  duplicate.
* First-time setup: going back keeps the people already added, starter chores work on a wall
  screen, a reload resumes setup, and the "Saved" pill no longer sticks.
* A new family's leaderboard no longer ranks everyone #1 at 0 points.
* The Cloudflare setup script runs on Windows.
* Tapping to wake the Night screen no longer taps what's underneath.
* Returning to the Board when idle no longer pulls a kid out of an activity or a parent's phone
  away from what they're reading.
* Scrollbars show with a mouse and on light pages; open lists no longer pan sideways on touch.
* Long timer names wrap instead of pushing the clock off screen.
* A Try again button when the Board or events fail to load.
* Activities no longer disappears when Paint, Photos and the sticker book are off but an added
  activity (like Math practice) is on, and a chore's Play link always opens its activity.
* With Photos off, the Board's picture card falls back to other pictures instead of going blank,
  and the Night screen shows drawings only while Paint is on.
* All-day events from a synced calendar no longer drop out for a few hours around midnight and
  come back (which also sent two updates and webhooks a day for each one).
* One failing part of the scheduled background work (calendar sync, reminders, the daily summary,
  cleanup) no longer stops the rest, and one calendar that fails to sync doesn't hold up the
  others.
* Accent text (links, the active tab, focus rings) stays readable after switching to dark mode.
  Dark schemes with a deep accent, like Peacock, showed it most.
* On narrow phones the header hides the family name instead of cutting it to "O…" when the offline
  icon or the Night button is showing, and every icon keeps its full size.
* The Board lists today's meals by time, so a 3:30 snack no longer shows after a 6:00 dinner.
* Count tiles take two rows on tablets instead of being cut off, and the tablet header's buttons
  stay on screen.
* Day and Week line up with their hour labels on a phone turned on its side.
* An activity's title stays readable on a phone when its chore is done.
* A setup code pasted with a space works, and a new family on a reinstalled server no longer picks
  up the last family's Board layout, filters or unsynced changes.
* A time zone with no offset shows as UTC, not UTC+0.

### Upgrading

* **Database migrations run automatically** when the server starts (Docker, Node and the Home
  Assistant app) or on the first request (Cloudflare Workers). There's nothing to run by
  hand.
* **Health data needs an `ENCRYPTION_KEY`.** Docker and the Home Assistant app already have
  one: if you didn't set `ENCRYPTION_KEY` or `ENCRYPTION_KEY_FILE`, it was generated into
  `encryption.key` in your data folder on first boot. On Cloudflare Workers, make sure the
  `ENCRYPTION_KEY` secret is set (the setup script sets one). Without a key, Kinwall refuses to
  save health visits, medicines and check-in answers rather than store them unencrypted, and an
  import that includes them is refused. Keep the key with your backups: a lost key can't be
  recovered.
* **Kids' devices and wall screens can do less.** They can no longer delete, archive, rename or
  reorder lists, edit event categories or the grocery catalog, or add, edit and delete chores.
  On a kid's device, other people's list items, notes and tracker entries open read-only, and
  notifications follow only that kid. Parent devices are unchanged.
* **Grown-ups' journals become private**, including past entries, and open only on that
  grown-up's own devices. Each grown-up should pick themselves under Settings → Access → **This device** so their
  phone counts as theirs. A paired display that belonged to a grown-up shows under **Needs a
  fix**; pick a wall screen or a kid for it.
* **Quiet hours are now Night** (Settings → General → For the whole family → Night). Your times,
  PIN and night screen carry over, and both effects stay on. Old links to the quiet hours page
  redirect.
* **Shopping lists are split** into Groceries and Shopping by name. Check that each list landed
  on the right side, and change its type under **Edit** → **Type** if not. Meal ingredients go only
  to Groceries lists.
* **Color scheme**: new families start on Peacock. If you never picked a scheme, you keep Peach:
  migration 0079 stores it for you. Migration 0094 does the same for the default Peacock replaces,
  but a server upgrading from 1.0.x already has Peach stored, so it changes nothing there.
* **New switches start on.** Check-ins & journal (`features.checkIns`) and Rewards
  (`rewardsEnabled`) default on, so nothing disappears; turning one off hides it and keeps its
  data. Check-in points now also need Chores & points on.
* **Board and snapshot answers follow the switches.** `GET /api/board` and `GET /api/snapshot`
  (and MCP `get_board` / `get_snapshot`) return empty `chores` while Chores & points is off and
  empty `items` while Lists is off, in the same shape, and `checkInPoints` reads 0 while check-in
  points can't be earned. Anything reading them should expect empty arrays.
* **Behind a reverse proxy or Cloudflare Tunnel** (Docker or Node), set `TRUST_PROXY=1` and
  publish the port only to the proxy. Kinwall now ignores `X-Forwarded-For` without it, so
  sign-in attempt limits would count everyone behind the proxy as one address. Don't set it when
  the port is reachable directly. See [Configuration](docs/self-hosting/configuration.md).
* **Fonts** now come from your own server. If you run a reverse proxy with its own
  Content-Security-Policy, it no longer needs the Google Fonts hosts.
* **Home Assistant**: update the Kinwall Home Assistant app to 1.1.0 and the Kinwall integration to
  1.9.0 or later, so it fetches only what changed and follows the feature switches (1.8.0 fetches
  less too, but keeps the entities of a switched-off feature).
* **The Kinwall app for iPhone and Android**: update to 1.1.0. Connecting a Google or Microsoft
  calendar from inside the app needs it (older versions are told to update or use a browser), as
  do barcode scanning and the feature switches in Siri, widgets and the Watch.
* **Home Assistant app**: `PUBLIC_URL` is no longer needed for passkeys. Use https and a host
  name; each address needs its own passkey, or set `PUBLIC_URL` and use only that address.
* **Your own Google OAuth client**: Kinwall now requests `calendar.events`,
  `calendar.calendarlist.readonly`, `openid` and `email`. Declare those under the consent screen's
  **Data access** (drop `calendar.readonly`). Accounts connected before keep working; their grant
  covers more.
* **Cloudflare Workers**: deploy with this release's `wrangler.toml`, which adds the routes for
  recipe share links and activities.
* Connected apps that managed keys, passkeys or other sign-ins through the API need a parent's
  own sign-in for that now, and can no longer subscribe to push or set up webhooks.
* **Scripts and integrations using the API**: a full key in the address (`?key=`) no longer works
  for images or the photo download, and calendar connections start with
  `POST /api/oauth/{kind}/start`. A sign-in link (`#key=`) now asks before it signs a browser in.
  The other breaking API changes are listed under [API, MCP and export](#api-mcp-and-export);
  nothing else breaks.
* The old accent and background presets are replaced by color schemes; an accent you set carries
  over.
* Self-hosters can see how to delete their family's data in Settings.
