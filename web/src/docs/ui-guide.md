# Using the interface

The interface has three parts: the **top bar**, the **left menu**, and the **content
area**.

## The left menu

Resources are organised **by section** (DCIM, IPAM, Virtualization, Operations, …),
and each section is split into **functional sub-groups** (for example DCIM → *Sites*,
*Racks*, *Cabling*, *Power*, *Interfaces*, *Devices*…).

- Everything starts **collapsed**. Click a **section title** to open it, then a
  **sub-group title** to reveal its resources, then a **resource** to open its list.
- Within a sub-group, resources are ordered by **creation dependency** — items you
  need first appear first (e.g. *Region* before *Site* before *Location*). Work down
  the list and you will rarely hit a "you must create X first" error.
- The number badge shows how many resource types are in that section/group.

## The top bar

- **Search** filters the menu by name as you type (it temporarily expands matching
  sections so you can see the hits).
- The **live** indicator shows the WebSocket connection status (green = connected).
  When it is green, changes made anywhere appear instantly without reloading.

## Browsing a resource

Opening a resource shows a list page with:

- a **breadcrumb** and title with the total record count;
- a **search box** (matches across common text fields);
- **pagination** (Prev / Next, 50 rows per page);
- an **API ↗** link and **Copy URL** button for the exact endpoint (see *The API*);
- a row of actions per record.

## Creating and editing

- Click **+ Add** to create a record. The form is **generated from the schema**, so
  each field shows the right control:
  - text / number / checkbox for simple fields,
  - a **dropdown** for choice fields,
  - a **searchable picker** for links to other objects (foreign keys),
  - a JSON box for advanced fields (e.g. custom fields).
- Required fields are marked with a red `*`.
- Click the **✎** (pencil) on a row to edit, or **✕** to delete.
- If the server rejects your input, the error appears **inline** under the offending
  field.

## Live updates

paasbox streams every create / update / delete over a WebSocket. Open two browser
tabs: create or edit a record in one, and watch the list and the Dashboard activity
log update in the other in real time.

## The API links

Every list page exposes its REST endpoint, and every row has an **API** link to that
exact object. This makes it easy to move from "clicking in the UI" to "scripting it" —
copy the URL and drop it into `curl`, Postman, or your automation tool. See **The
API** page for details.
