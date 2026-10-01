# Household Contacts Directory

Kinwall's Contacts directory stores people, services, organizations, and places outside the household. Household members already stored in **Settings → Family** are not copied into this directory. A babysitter, grandparent, school office, pediatrician, veterinarian, utility, contractor, or neighbor can be a contact.

An admin can turn off **Contacts** in **Settings → General** (tap **Change** under **Features**). The Contacts tab is hidden, contacts are kept, and the contacts API keeps answering. See [Features](../settings/general.md#features).

Contacts support multiple categories, tags, phone numbers, email addresses, postal addresses, relationships, associated household members, service hours, service areas, an emergency flag, favorites, and wall visibility. Built-in categories include Emergency services, Medical, Veterinary, Childcare, Family, Friends, Neighbors, School, Work, Home services, Transportation, Organizations, and Other. Households can add custom categories.

## Finding a contact

Search by name, place or phone number. Tap the **Filters** button next to the search to sort the list and narrow it by **Show** (all contacts, favorites, emergency or on wall), **Contact kind** and **Category**. Changes apply right away; **Clear filters** puts everything back. While a filter is on, the button shows how many are on and a line under the search lists them; tap that line to change them. Filters reset when you leave the page.

A link to `#/contacts?contact=<contact id>` opens that contact (Spotlight and Siri in the phone app use it). An id that doesn't exist, or a contact this device can't see, just opens Contacts.

**Import** and **Add** are at the top of the page. **Import** brings in contacts from a phone, a vCard file or pasted vCard text; **Add** starts a new contact. Both are on parent devices only.

In a contact's editor, **Categories**, **Associated household members** and **Who can see it on their own device** each show what's chosen ("Medical, School", "Maya and Leo", "None"). Tap one to open the list: tap rows to tick or untick them, **Clear** unticks them all and **Done** closes it. Categories show their color, and a long list has a search box. The import review has the same **Categories** and **Household members** rows for each contact.

## Who can see a contact

Each contact has a **Who can see it** setting (`visibility` in the API). Parent devices (and connected apps with full access) always see every contact.

| Setting | API value | Seen on |
|---|---|---|
| Everyone in the family | `household` | Parent devices, every member's own device, and shared wall screens when **Show on wall** is on. |
| Grown-ups only | `adults` | Parent devices and the own devices of members marked as grown-ups. Never wall screens or kids' devices. |
| Only the people I choose | `selected_members` | Parent devices and the own devices of the members in `selectedMemberIds`. Never wall screens. |
| Parent devices only | `private` | Parent devices only. |

A member's own device is one whose owner is that member under [Settings → Access](../settings/access.md). A shared wall screen is a device set to the whole family, or one with no owner.

**Show on wall** (`wallVisible`) is a separate switch, off by default. On a wall screen, phone numbers show only when **Show permitted phone numbers on wall** is on (and only the numbers marked for the wall), and the address only when **Show address on wall** is on. Wall screens never get email, notes, tags, dates or who the contact is for. Members' own devices get the contact without its notes and without the fields listed in `privateFields`. `memberIds` is who a contact is for ("Leo's dentist"); `selectedMemberIds` is who may see a contact set to `selected_members`. Device keys can read contacts but can't add, import, merge, edit or delete them.

## Emergency contacts

The Contacts page has an Emergency filter (under **Filters → Show**) and blank templates for Poison Control, Animal Control, emergency services, police non-emergency, fire department, pediatrician, veterinarian, pharmacy, school office, utility company, locksmith, insurance provider, and custom services. Templates never guess country-specific phone numbers. Enter and verify those numbers for your household. Emergency records can include service hours or a 24/7 flag and support `tel:`, `sms:`, email, copy, and map actions. On an iPhone, iPad or Mac, phone numbers and email addresses also get **FaceTime**, which starts a FaceTime video call (by number or Apple ID email). In the Kinwall Android app, phone numbers get **Video call**, which starts a Google Meet video call to that number (or opens Google Meet in the Play Store when it isn't installed). Android browsers can't start a Meet call from a page, so they don't show it.

## Importing vCards

Import is a one-time snapshot into Kinwall; it is not synchronization and Kinwall never writes to the phone's address book. vCard files and pasted text go to your Kinwall server, which reads them and returns drafts to review; nothing is saved until you import. The importer reads vCard 2.1, 3.0 and 4.0 as Apple Contacts, Google Contacts and Android export them: `FN`, `N` (first and last name), `NICKNAME`, `ORG` (with its department), `TITLE`, `TEL`, `EMAIL`, `ADR`, `URL`, `BDAY` and `ANNIVERSARY` (with or without a year), Apple's other dates (`X-ABDATE`), `NOTE` and `CATEGORIES`, including folded lines, quoted-printable text and accented or emoji names. Labels come through as words: Mobile, Home, Work, Work fax, iPhone, Main, Home page, or the contact's own custom label (Apple's `X-ABLabel`, Android's `X-CUSTOM`). A card with only a company name comes in as an organization. Photos aren't imported; no photo data is stored or fetched. Raw uploaded files are not retained or sent to a third-party service.

Before saving, review each proposed contact. The review shows each one like its contact sheet: name, nickname, job title and company at the top, then its phones, emails, addresses and websites with their labels, then birthday and other dates, tags and notes. Below that, **Add to Kinwall** or **What to do** picks what happens, and for a contact being added, **In Kinwall** sets its name, kind, relationship, categories, household members and switches. A contact with the same phone, email or name as a saved one is marked **Already in Kinwall?**; that's a suggestion only. Choose **Skip it** (the default), **Update** the saved contact with the new details, or **Add as a separate contact**. **Save** (or **Update contact**) saves; on a shared contact, **Cancel** closes without saving; merging requires an explicit decision and keeps every unique phone, email, address, category and tag. A merged contact is never shown to more people than before: it keeps the stricter **Who can see it** setting, each wall switch stays on only if both copies had it on, and fields private in either copy stay private. The Browser Contact Picker is feature-detected and shown only in a secure top-level browsing context. If it is unavailable, export/share contacts from the phone as a `.vcf` file and import that file instead.

## Share a contact from your phone

In the Kinwall app for iPhone, iPad and Android, you can send a contact straight to Kinwall from the phone's Contacts app, or from any app that shares contacts as a vCard. Open the contact, tap **Share Contact** (Android: **Share**) and pick **Kinwall**.

- **iPhone and iPad**: the share sheet says "Opening in Kinwall…", then "Reading contact…", and shows the contact for review: name and company at the top, then its phones, emails, addresses, websites, dates and notes with their labels, marking one that looks like a saved contact as **Already in Kinwall?**. Choose **Add this contact** or **Skip it** for a new contact, and **Skip it**, **Update** the saved contact (adds the missing details) or **Add as a separate contact** for one already in Kinwall, then tap **Save**. Kinwall saves it there and then; there's no need to open the app.
- **Android**: Kinwall opens on Contacts, says "Reading the contact…", then shows the same review you get from **Import**. A contact shared as text (a vCard in plain text) opens the contact review too, not the recipe importer.

Either way, nothing is saved until you import, and photos on a shared contact are left behind. Importing contacts is for parent devices: on a kid's device or a wall screen, Kinwall says to ask a parent instead.

Direct full address-book access requires platform-specific native permissions. Kinwall doesn't read the phone's address book on its own or keep contacts in sync with it; sharing a contact is a one-time import. The import boundary is intentionally normalized so future native adapters can provide contact drafts without changing the directory API.

## REST and MCP

The REST API exposes `GET/POST /api/contacts`, `GET/PATCH/DELETE /api/contacts/:id`, contact category CRUD at `/api/contact-categories`, import preview/import, and explicit merge. List queries support search, kind, category, favorite, emergency, wall, member, and privacy filters. Import preview saves nothing and takes vCard text (`vcard`) or normalized drafts (`contacts`); the MCP tool takes drafts only.

MCP provides `list_contacts` (with an optional search), `get_contact`, `create_contact`, `update_contact`, `delete_contact`, `preview_contact_import`, `import_contacts`, `merge_contacts`, and contact-category tools. Read results follow the caller's key scope. Import, merge, delete, and category management require administrative authorization.

## Export and import

Household exports include contact records, built-in/custom contact categories, tags, member associations, visibility settings, phones, emails, addresses, service metadata, and safe source metadata. Raw uploaded vCard files and credentials are not exported. Re-import preserves stable contact/category IDs using the same idempotent household import behavior as the rest of Kinwall.
