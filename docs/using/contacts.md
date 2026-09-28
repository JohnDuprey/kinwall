# Household Contacts Directory

Kinwall's Contacts directory stores people, services, organizations, and places outside the household. Household members already stored in **Settings → Family** are not copied into this directory. A babysitter, grandparent, school office, pediatrician, veterinarian, utility, contractor, or neighbor can be a contact.

Contacts support multiple categories, tags, phone numbers, email addresses, postal addresses, relationships, associated household members, service hours, service areas, an emergency flag, favorites, and wall visibility. Built-in categories include Emergency services, Medical, Veterinary, Childcare, Family, Friends, Neighbors, School, Work, Home services, Transportation, Organizations, and Other. Households can add custom categories.

## Privacy and wall visibility

New personal and service contacts default to household visibility and are not shown on the wall. Visibility can be `household`, `adults`, `selected_members`, or `private`. Wall visibility is a separate switch. Phone numbers and addresses stay redacted on wall/display-scoped responses unless their individual wall switches are enabled; private notes are never returned to display-scoped keys. Display keys can read wall-visible contacts but cannot import, merge, edit, or delete them.

## Emergency contacts

The Contacts page has an Emergency filter and blank templates for Poison Control, Animal Control, emergency services, police non-emergency, fire department, pediatrician, veterinarian, pharmacy, school office, utility company, locksmith, insurance provider, and custom services. Templates never guess country-specific phone numbers. Enter and verify those numbers for your household. Emergency records can include service hours or a 24/7 flag and support `tel:`, `sms:`, email, copy, and map actions.

## Importing vCards

Import is a one-time snapshot into Kinwall; it is not synchronization and Kinwall never writes to the phone's address book. vCard files and pasted text go to your Kinwall server, which reads them and returns drafts to review; nothing is saved until you import. The importer supports common vCard 2.1, 3.0, and 4.0 fields including `FN`, `N`, `NICKNAME`, `ORG`, `TITLE`, `TEL`, `EMAIL`, `ADR`, `URL`, `NOTE`, and `CATEGORIES`. Photo properties are ignored in this web-first version; no photo data is stored or fetched. Raw uploaded files are not retained or sent to a third-party service.

Before saving, review each proposed contact. Possible and exact duplicates are suggestions only. Choose Skip, Create/Keep both, or Merge; merging requires an explicit decision and preserves unique methods, addresses, categories, and tags. The Browser Contact Picker is feature-detected and shown only in a secure top-level browsing context. If it is unavailable, export/share contacts from the phone as a `.vcf` file and import that file instead.

Direct full address-book access requires platform-specific native permissions. This web-first version does not ship native iOS or Android code or continuous phone-contact synchronization. The import boundary is intentionally normalized so future native adapters can provide contact drafts without changing the directory API.

## REST and MCP

The REST API exposes `GET/POST /api/contacts`, `GET/PATCH/DELETE /api/contacts/:id`, contact category CRUD at `/api/contact-categories`, import preview/import, and explicit merge. List queries support search, kind, category, favorite, emergency, wall, member, and privacy filters. Import preview saves nothing and takes vCard text (`vcard`) or normalized drafts (`contacts`); the MCP tool takes drafts only.

MCP provides `list_contacts` (with an optional search), `get_contact`, `create_contact`, `update_contact`, `delete_contact`, `preview_contact_import`, `import_contacts`, `merge_contacts`, and contact-category tools. Read results follow the caller's key scope. Import, merge, delete, and category management require administrative authorization.

## Export and import

Household exports include contact records, built-in/custom contact categories, tags, member associations, visibility settings, phones, emails, addresses, service metadata, and safe source metadata. Raw uploaded vCard files and credentials are not exported. Re-import preserves stable contact/category IDs using the same idempotent household import behavior as the rest of Kinwall.
