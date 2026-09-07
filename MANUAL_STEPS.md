# What only you can do (≈15 minutes)

Everything else is built, tested and deployed. These steps need your identity.

## 1. Create the Gumroad product (5 min)
1. https://gumroad.com → sign up / log in (email is enough; add payout details later, sales register immediately).
2. **New product** → type *Digital product* → name: **WhatsApp Chat to PDF — Pro (lifetime)**.
3. Price: **$4.99 USD** (or set "$3+" pay-what-you-want with a $3 minimum — urgent-need buyers rarely haggle). One sale clears the $1 goal.
4. Content tab: write
   > Thanks! Your license key is below (also in your receipt email). Go to https://jbarca.github.io/whatsapp-chat-to-pdf/ → *Already bought? Enter license key* → Activate. Works forever on any chat. Reply to this email if anything doesn't work — you'll get a fix or a refund.
5. **Checkout → Settings → tick "Generate a unique license key per sale."**
6. Publish. Copy two things:
   - the **product URL** (e.g. `https://jbarca.gumroad.com/l/xxxx`)
   - the **product ID** (Product → *Share* tab → "Product ID", or Advanced settings). It's a long id like `ABCdef12...==`.

## 2. Wire the store into the app (2 min)
Edit `app.js` top `CONFIG` block:
```js
GUMROAD_PRODUCT_ID: 'PASTE_PRODUCT_ID',
GUMROAD_PRODUCT_URL: 'https://jbarca.gumroad.com/l/xxxx',
PRICE_LABEL: '$4.99 one-time',
```
Then:
```bash
cd ~/Documents/whatsapp-chat-to-pdf && git commit -am "Wire Gumroad product" && git push
```
GitHub Pages redeploys in ~1 minute. Test: buy it yourself with Gumroad's test mode (or a 100% discount code), paste the key into the site, confirm "Pro activated".

## 3. Post it (5 min) — this is what actually makes the sale today
Copy-paste ready text is in `launch/POSTS.md`. Priority order:
1. **r/whatsapp** (self-post, tool showcase) — biggest intent-matched audience.
2. **Hacker News → Show HN** — lead with the privacy/no-server angle.
3. **r/privacy**, **r/DataHoarder**, **r/legaladviceofftopic** (only where self-promo rules allow; the text is written as a genuine "I built this" post, not an ad).
4. Reply to existing threads people search: search Reddit/Quora for "whatsapp chat to pdf court" from the last month and answer with the link. This is the highest-conversion move — people in those threads have the urgent need *now*.
5. Tweet/X + LinkedIn (optional).

## 4. Later today (optional)
- Gumroad → Payouts: add bank/PayPal so the money actually reaches you (not needed for the sale to count).
- Add a custom domain to GitHub Pages if you want the link to look nicer.

## If something breaks
- License check says "Store not configured yet" → step 2 not done / not pushed.
- Key rejected → product ID wrong, or license keys not enabled on the product.
- Run `node test/parser.test.mjs` after any parser change.
