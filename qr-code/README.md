# QR Code

An agent can write an `.ics` file. It cannot emit a QR that a phone will accept — it draws a picture of a QR. This runs the real encoder and returns SVG.

Typical payloads: a URL, a Wi‑Fi join string, a one-time pairing code, a ticket id.

This service works now. It does **not** charge. MPP is the next step, not part of the starter.

## What it does

`GET` or `POST /api/qr` returns `image/svg+xml`.

| Field | Required | Notes |
| --- | --- | --- |
| `text` | yes | Up to 800 characters |

## How to use it

```bash
cd agent-service-examples/qr-code
npm install
npm start
```

Open [http://127.0.0.1:4102](http://127.0.0.1:4102) and scan the code, or:

```bash
curl -s http://127.0.0.1:4102/api/qr \
  -H 'content-type: application/json' \
  -d '{"text":"https://mpp.dev/"}' -o qr.svg
```

Discovery (unpaid):

- [http://127.0.0.1:4102/openapi.json](http://127.0.0.1:4102/openapi.json)
- [http://127.0.0.1:4102/llms.txt](http://127.0.0.1:4102/llms.txt)

## How to add MPP

Charge `GET`/`POST /api/qr`.

1. Create a server secret:

   ```bash
   openssl rand -hex 32
   ```

   Store it as `MPP_SECRET_KEY`.

2. Install the SDK:

   ```bash
   npm install mppx
   ```

3. Wrap the route. From the [MPP server quickstart](https://mpp.dev/quickstart):

   ```text
   Reference https://mpp.dev/quickstart/server.md

   Add mppx to my server so GET and POST /api/qr charge $0.01 using the Tempo payment method with pathUSD.
   Run `npx mppx validate <your-server>` as you develop.
   ```

   Unpaid request → `402`. Paid request → the same SVG, plus a Receipt.

4. Add `x-payment-info.offers[]` and a `402` response on `/api/qr` in `/openapi.json`. Mention the price in `/llms.txt`.

5. Validate:

   ```bash
   npx mppx validate http://127.0.0.1:4102
   ```

6. Deploy, then submit the live URL to the hackathon.

Docs: [mpp.dev/quickstart](https://mpp.dev/quickstart) · [Discovery](https://mpp.dev/advanced/discovery)
