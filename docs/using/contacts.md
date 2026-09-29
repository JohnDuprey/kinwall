# Household Contacts Directory

Kinwall's Contacts directory stores people, services, organizations, and places outside the household. Household members already stored in **Settings → Family** are not copied into this directory. A babysitter, grandparent, school office, pediatrician, veterinarian, utility, contractor, or neighbor can be a contact.

An admin can turn off **Contacts** in **Settings → General** (tap **Change** under **Features**). The Contacts tab is hidden, contacts are kept, and the contacts API keeps answering. See [Features](../settings/general.md#features).

Contacts support multiple categories, tags, phone numbers, email addresses, postal addresses, relationships, associated household members, service hours, service areas, an emergency flag, favorites, and wall visibility. Built-in categories include Emergency services, Medical, Veterinary, Childcare, Family, Friends, Neighbors, School, Work, Home services, Transportation, Organizations, and Other. Households can add custom categories.

## Finding a contact

Search by name, place or phone number. Tap the **Filters** button next to the search to sort the list and narrow it by **Show** (all contacts, favorites, emergency or on wall), **Contact kind** and **Category**. Changes apply right away; **Clear filters** puts everything back. While a filter is on, the button shows how many are on and a line under the search lists them; tap that line to change them. Filters reset when you leave the page.

**Add** is at the top of the page. To bring in contacts from a phone or a vCard file, choose **Import contacts…** from the **More…** menu next to it. With no contacts yet, the page shows just **Add a contact** and **Import**.

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

The Contacts page has an Emergency filter (under **Filters → Show**) and blank templates for Poison Control, Animal Control, emergency services, police non-emergency, fire department, pediatrician, veterinarian, pharmacy, school office, utility company, locksmith, insurance provider, and custom services. Templates never guess country-specific phone numbers. Enter and verify those numbers for your household. Emergency records can include service hours or a 24/7 flag and support `tel:`, `sms:`, email, copy, and map actions.

## Importing vCards

Import is a one-time snapshot into Kinwall; it is not synchronization and Kinwall never writes to the phone's address book. vCard files and pasted text go to your Kinwall server, which reads them and returns drafts to review; nothing is saved until you import. The importer supports common vCard 2.1, 3.0, and 4.0 fields including `FN`, `N`, `NICKNAME`, `ORG`, `TITLE`, `TEL`, `EMAIL`, `ADR`, `URL`, `NOTE`, and `CATEGORIES`. Photo properties are ignored in this web-first version; no photo data is stored or fetched. Raw uploaded files are not retained or sent to a third-party service.

Before saving, review each proposed contact. Possible and exact duplicates are suggestions only. Choose Skip, Create/Keep both, or Merge; merging requires an explicit decision and keeps every unique phone, email, address, category and tag. A merged contact is never shown to more people than before: it keeps the stricter **Who can see it** setting, each wall switch stays on only if both copies had it on, and fields private in either copy stay private. The Browser Contact Picker is feature-detected and shown only in a secure top-level browsing context. If it is unavailable, export/share contacts from the phone as a `.vcf` file and import that file instead.

Direct full address-book access requires platform-specific native permissions. This web-first version does not ship native iOS or Android code or continuous phone-contact synchronization. The import boundary is intentionally normalized so future native adapters can provide contact drafts without changing the directory API.

## REST and MCP

The REST API exposes `GET/POST /api/contacts`, `GET/PATCH/DELETE /api/contacts/:id`, contact category CRUD at `/api/contact-categories`, import preview/import, and explicit merge. List queries support search, kind, category, favorite, emergency, wall, member, and privacy filters. Import preview saves nothing and takes vCard text (`vcard`) or normalized drafts (`contacts`); the MCP tool takes drafts only.

MCP provides `list_contacts` (with an optional search), `get_contact`, `create_contact`, `update_contact`, `delete_contact`, `preview_contact_import`, `import_contacts`, `merge_contacts`, and contact-category tools. Read results follow the caller's key scope. Import, merge, delete, and category management require administrative authorization.

## Export and import

Household exports include contact records, built-in/custom contact categories, tags, member associations, visibility settings, phones, emails, addresses, service metadata, and safe source metadata. Raw uploaded vCard files and credentials are not exported. Re-import preserves stable contact/category IDs using the same idempotent household import behavior as the rest of Kinwall.
