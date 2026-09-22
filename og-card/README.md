# OG Card

An agent has a title and needs a share image. This returns a 1200×630 SVG Open Graph card — the size every social preview expects.

This starter is unpaid. Add MPP after you have seen it work.

## What it does

`GET` or `POST /api/card` renders an SVG from:

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | Wrapped across up to 3 lines |
| `subtitle` | no | Supporting line |
| `tag` | no | Small uppercase label. Default `agent` |
| `theme` | no | `ink`, `paper`, or `signal` |

Response `Content-Type` is `image/svg+xml`.

```bash
cd og-card
npm start
```

Open [http://127.0.0.1:4103](http://127.0.0.1:4103).

## Test before MPP

A render should return **200** and start with `<svg`. It must not return **402**.

```bash
curl -s -D - -o card.svg http://127.0.0.1:4103/api/card \
  -H 'content-type: application/json' \
  -d '{"title":"Ship a paid API","subtitle":"Agents pay over HTTP 402","tag":"hackathon","theme":"ink"}'
```

```bash
curl -sG http://127.0.0.1:4103/api/card \
  --data-urlencode 'title=Ship a paid API' \
  --data-urlencode 'theme=signal' \
  -o card.svg
```

```bash
head -n 2 card.svg
# expect an SVG document
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:4103/api/card?title=Hello'
# expect 200
```

Discovery (still unpaid): [openapi.json](http://127.0.0.1:4103/openapi.json) · [llms.txt](http://127.0.0.1:4103/llms.txt).

## How to add MPP

Charge `GET` and `POST /api/card`. Keep the SVG renderer as it is.

### 1. Using this command

```text
Reference https://mpp.dev/quickstart/server.md

Add mppx to this Node server so GET and POST /api/card charge $0.01 per request using the Tempo payment method with pathUSD (testnet: true while developing).
Add x-payment-info.offers[] and a 402 response on /api/card in /openapi.json. Mention the price in /llms.txt.
Run `npx mppx validate http://127.0.0.1:4103` as you develop.
```

### 2. Manually, step by step

1. Create a server secret and keep it off the client:

   ```bash
   export MPP_SECRET_KEY=$(openssl rand -hex 32)
   # TEMPO_CURRENCY and TEMPO_RECIPIENT: copy pathUSD and your address from https://mpp.dev/quickstart/server.md
   ```

2. Install the SDK:

   ```bash
   npm install mppx
   ```

3. Wrap the card route. These servers use Node `http`, so use `mppx/server` (and `Mppx.toNodeListener` if you stay on `IncomingMessage`):

   ```js
   import { Mppx, tempo } from "mppx/server";

   const mppx = Mppx.create({
     methods: [
       tempo.charge({
         currency: process.env.TEMPO_CURRENCY, // pathUSD — see mpp.dev/quickstart/server.md
         recipient: process.env.TEMPO_RECIPIENT,
         testnet: true,
       }),
     ],
     secretKey: process.env.MPP_SECRET_KEY,
   });

   const payment = await mppx.charge({ amount: "0.01" })(request);
   if (payment.status === 402) return payment.challenge;
   return payment.withReceipt(new Response(svg, { headers: { "content-type": "image/svg+xml" } }));
   ```

4. On `/api/card` in `/openapi.json`, add `x-payment-info.offers[]` and a `402` response. Note the price in `/llms.txt`.

Docs: [Server quickstart](https://mpp.dev/quickstart/server.md) · [Discovery](https://mpp.dev/advanced/discovery)

## Test after MPP

An unpaid render must now return **402**, not the SVG:

```bash
curl -i http://127.0.0.1:4103/api/card \
  -H 'content-type: application/json' \
  -d '{"title":"Ship a paid API","theme":"ink"}'
```

Then run the official checker and a paid request:

```bash
npx mppx validate http://127.0.0.1:4103
npx mppx account create --network testnet
npx mppx account fund --network testnet
npx mppx http://127.0.0.1:4103/api/card \
  --method POST \
  --header 'content-type: application/json' \
  --body '{"title":"Ship a paid API","theme":"ink"}'
```

You should get the SVG plus a receipt. Deploy the paid service, then submit the live URL to the hackathon.
