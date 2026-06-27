# Inventory MVP

This is the first MVP for an internal business inventory system.

It is built with:

- Next.js App Router
- Vercel hosting
- Supabase Postgres database
- Supabase Auth employee login

## What this first MVP does

This version includes:

- Suppliers
- Parts / supplies
- Products and variations
- BOM recipes
- Purchase orders / incoming shipments
- Receiving confirmation
- Damage / scrap tracking
- Replacement orders that consume BOM parts
- Cycle counts / inventory count adjustments
- Reorder dashboard
- Inventory movement history

It does **not** yet include Etsy, Amazon, TikTok, or Shopify syncing. Those should come after the internal inventory system is working.

## Important inventory rule

Inventory is not stored as one editable number.

Every change is stored in `inventory_movements`, like:

- `+500 supplier_received`
- `-1 replacement_order`
- `-2 damage`
- `+12 cycle_count_adjustment`

This makes it possible to see why inventory changed.

## Setup steps

### 1. Create a Supabase project

Go to Supabase and create a new project.

### 2. Run the database migration

In Supabase:

1. Open your project
2. Go to **SQL Editor**
3. Open `supabase/migrations/0001_inventory_mvp.sql`
4. Copy the full SQL
5. Paste it into Supabase SQL Editor
6. Click **Run**

### 3. Create your first employee login

In Supabase:

1. Go to **Authentication**
2. Go to **Users**
3. Click **Add user**
4. Add your email and password
5. Confirm the user

For the MVP, every logged-in user can access the full system. Later we can add Admin / Manager / Warehouse roles.

### 4. Add environment variables

Create a file named `.env.local` in the project root.

Use `.env.example` as the template:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

You find these in Supabase under:

**Project Settings → API**

### 5. Run locally

```bash
npm install
npm run dev
```

Open:

```bash
http://localhost:3000
```

### 6. Deploy to Vercel

1. Push this folder to GitHub
2. In Vercel, click **Add New Project**
3. Import the GitHub repo
4. Add the same environment variables from `.env.local`
5. Deploy

## First testing flow

Use this order when testing:

1. Add suppliers
2. Add parts
3. Go to **Counts** and enter starting inventory for each part
4. Add products
5. Add product variations
6. Add BOM recipes
7. Add purchase orders
8. Add PO items
9. Receive shipments
10. Add a damage report
11. Add a replacement order
12. Check Dashboard and Reports

## What to build next

Recommended next upgrades:

1. Employee roles: Admin / Manager / Warehouse
2. Better reorder calculation based on daily usage and lead time
3. Daily marketplace order import
4. Order consumption from Etsy/Amazon/TikTok/Shopify
5. Platform inventory sync back
6. Damage photos
7. Supplier performance report
8. Christmas forecast report
