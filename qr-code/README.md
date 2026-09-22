# QR Code

Models can draw something that looks like a QR code. Phones reject those. This runs the real encoder and returns SVG you can scan.

Typical payloads: a URL, a Wi‑Fi join string, a one-time pairing code, a ticket id.

This starter is unpaid. Add MPP after you have seen it work.

## What it does

`GET` or `POST /api/qr` returns `image/svg+xml`.

| Field | Required | Notes |
| --- | --- | --- |
| `text` | yes | Up to 800 characters |

```bash
cd qr-code
npm install
npm start
```

Open [http://127.0.0.1:4102](http://127.0.0.1:4102) and scan the code.

## Test before MPP

A render should return **200** and start with `<svg`. It must not return **402**.

```bash
curl -s -D - -o qr.svg http://127.0.0.1:4102/api/qr \
  -H 'content-type: application/json' \
  -d '{"text":"https://mpp.dev/"}'
```

```bash
head -n 2 qr.svg
# expect an SVG document
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:4102/api/qr?text=https://mpp.dev/'
# expect 200
```

Open `qr.svg` and scan it with a phone. Discovery (still unpaid): [openapi.json](http://127.0.0.1:4102/openapi.json) · [llms.txt](http://127.0.0.1:4102/llms.txt).

## How to add MPP

Charge `GET` and `POST /api/qr`. Keep the encoder as it is.

### 1. Using this command

```text
Reference https://mpp.dev/quickstart/server.md

Add mppx to this Node server so GET and POST /api/qr charge $0.01 per request using the Tempo payment method with pathUSD (testnet: true while developing).
Add x-payment-info.offers[] and a 402 response on /api/qr in /openapi.json. Mention the price in /llms.txt.
Run `npx mppx validate http://127.0.0.1:4102` as you develop.
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

3. Wrap the QR route. These servers use Node `http`, so use `mppx/server` (and `Mppx.toNodeListener` if you stay on `IncomingMessage`):

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

4. On `/api/qr` in `/openapi.json`, add `x-payment-info.offers[]` and a `402` response. Note the price in `/llms.txt`.

Docs: [Server quickstart](https://mpp.dev/quickstart/server.md) · [Discovery](https://mpp.dev/advanced/discovery)

## Test after MPP

An unpaid render must now return **402**, not the SVG:

```bash
curl -i http://127.0.0.1:4102/api/qr \
  -H 'content-type: application/json' \
  -d '{"text":"https://mpp.dev/"}'
```

Then run the official checker and a paid request:

```bash
npx mppx validate http://127.0.0.1:4102
npx mppx account create --network testnet
npx mppx account fund --network testnet
npx mppx http://127.0.0.1:4102/api/qr \
  --method POST \
  --header 'content-type: application/json' \
  --body '{"text":"https://mpp.dev/"}'
```

You should get the SVG plus a receipt. Deploy the paid service, then submit the live URL to the hackathon.
