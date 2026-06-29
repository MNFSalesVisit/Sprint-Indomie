# Salesperson Workflows

Login & session
- Login via email OTP; session persists until logout.

Sales Visit flow
1. Select region → subregions and shops filtered by assignment.
2. Choose shop: register new (`Shop Name - Location`) or select existing.
3. Enter stock position per SKU (numeric, +/- controls), indicate `Sold?` Yes/No.
4. If sold: enter sold qty per SKU (cannot exceed available stock). System deducts from `stock_balances`.
5. If not sold: choose reason (Financial constraints, Stock available, Other).
6. Capture selfie (camera), preview, then submit. Server records GPS coordinates and visit items.

Uplift flow
- Submit cartons and upload receipt. Status `pending`. Stock unchanged until admin approval.

Business rules & validations
- No sale allowed if `stock_balance = 0` (error message instructs uplift first).
- Sales cannot exceed available stock.
- Selfie and GPS must be provided for visit submission.
