# Welcome to paasbox

**paasbox** is a fast, lightweight infrastructure source-of-truth for your
**data center (DCIM)**, **IP address management (IPAM)** and **virtualization**.
It exposes the same REST API as NetBox, so existing tools, scripts and integrations
work unchanged — but it boots in seconds and runs from a single container on either
SQLite or MariaDB.

## What you can do here

- **Browse and edit** every object (sites, racks, devices, prefixes, VLANs, clusters,
  virtual machines, and more) from the web interface.
- **Automate** everything through a documented REST API — every screen shows you the
  exact API URL behind it.
- **React to changes** in real time with **webhooks** and a live **WebSocket** feed.
- **Extend** the product with **plugins** that add new object types and endpoints.

## Finding your way around

- The **left menu** is grouped by area (Operations, DCIM, IPAM, Virtualization, …).
  Click a section title to expand it, then a sub-group, then a resource.
- **Dashboard** shows live activity and how many resource types are available.
- The **search box** at the top filters the menu.
- Every list page links to its **API endpoint** so you can copy it into a script.

New here? Read **Using the interface** next, then **The object model** to understand
how things fit together.

> Tip: there is nothing to install to *use* paasbox — it is all in the browser and the
> API. You only need credentials if your administrator turned authentication on.
