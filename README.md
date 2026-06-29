# Inventory MVP v2

This is the updated MVP for your inventory program. It is built to match the way your current spreadsheet works, while adding stricter tracking for shipments, usage, zero reports, switches, and Slack alerts.

Stack:

- Next.js App Router
- Vercel hosting
- Supabase Postgres database
- Supabase Auth employee login

## What changed in this version

The first version was a simple inventory tracker. This version adds the spreadsheet workflow:

- Upload Etsy, Amazon, TikTok Shop, and Shopify CSV files
- See all imported order rows in one table
- Add product mapping rules so platform variations map to internal finished products
- Keep finished products and BOM logic like the MASTER FILE tab
- Track shipments/purchases like the Purchases area in the spreadsheet
- Track manual adjustments and inventory switches
- Separate forced switches from voluntary customer changes
- Track actual warehouse zero events
- Show weekly/monthly usage
- Add basic prediction similar to the spreadsheet PREDICTION tab
- Add advanced reorder calculation per part
- Add part QR/card pages for warehouse scanning
- Add Slack notification setup placeholder

## Database setup

Run these SQL files in Supabase SQL Editor, in this order:

1. `supabase/migrations/0001_inventory_mvp.sql`
2. `supabase/migrations/0002_inventory_sheet_imports_predictions.sql`

If you already ran `0001`, only run `0002`.

## Environment variables in Vercel

Required:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-or-anon-key
```

Optional for Slack testing:

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

Do not upload `.env.local` to GitHub.

## Main pages

- `/dashboard` - alerts, low stock, overdue shipments, imported order issues
- `/uploads` - CSV uploads now, API connections later
- `/imported-orders` - all imported rows from all platforms
- `/mapping-rules` - rules for how imported variations become internal products
- `/products` - finished products and variations
- `/boms` - BOM/master-file logic
- `/parts` - parts/components and supplier/order settings
- `/shipments` - incoming inventory and purchase orders
- `/receiving` - confirm actual received quantities
- `/adjustments` - manual adjustments and inventory switches
- `/usage` - weekly/monthly inventory usage
- `/predictions/basic` - spreadsheet-style prediction
- `/predictions/advanced` - safe reorder calculator per part
- `/zero` - report actual warehouse stockout
- `/reports` - zero events, dead stock, forced switches, overdue shipments
- `/scanner` - part URLs for QR cards
- `/slack` - Slack alert settings and test button

## First real testing flow

1. Add suppliers.
2. Add parts/components.
3. Add starting inventory through Counts.
4. Add finished products and variations.
5. Add BOMs.
6. Upload CSV files from Etsy/Amazon/TikTok/Shopify.
7. Check Imported Orders.
8. Add mapping rules.
9. Add shipments/purchases.
10. Receive shipments.
11. Test zero reports, manual adjustments, and switches.
12. Check Basic Prediction and Advanced Prediction.

## Important logic

For forced switches, the system should count demand separately from actual usage.

Example: customer ordered white passport holder, but we ran out and forced them to switch to cream.

- White still counts as demand for prediction.
- Cream counts as actual inventory usage.

This version creates the switch table and UI for that. The next build step should connect imported order mapping to BOM consumption automatically.

## Not included yet

These should come later:

- Direct Etsy API connection
- Veeqo API connection
- Automatic BOM consumption from imported orders
- AI reorder analysis button
- Full order management / employee assignment system
- Shipping label buttons
- Push inventory back to marketplaces


## V5 changes

Run this SQL after 0004:

```text
supabase/migrations/0005_inventory_workflow_fixes.sql
```

V5 adds/fixes:
- Mapping rules now save correctly and can map rows to **Ignore / void line**.
- Active mapping rules are applied during CSV import.
- Button to apply mapping rules to existing unmapped rows.
- Imported rows store normalized dates and Sunday week starts.
- Usage page now has Sunday-to-Saturday timeline like the spreadsheet.
- Manual products produced/sold entry for bulk orders.
- BOM page is now a spreadsheet-style editable grid.
- Receiving damaged items now creates a damage report, dashboard notification, and Slack alert if configured.
- Damaged/missing received shipment quantities reduce projected incoming inventory.
- Part pages include an Add Supplier form.
```
