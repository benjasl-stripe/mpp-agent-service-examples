# OG Card

An agent has a title and needs a share image. This returns a 1200×630 SVG Open Graph card — the size every social preview expects.

This service works now. It does **not** charge. MPP is the next step, not part of the starter.

## What it does

`GET` or `POST /api/card` renders an SVG from:

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | Wrapped across up to 3 lines |
| `subtitle` | no | Supporting line |
| `tag` | no | Small uppercase label. Default `agent` |
| `theme` | no | `ink`, `paper`, or `signal` |

Response `Content-Type` is `image/svg+xml`.

## How to use it

```bash
cd agent-service-examples/og-card
npm start
```

Open [http://127.0.0.1:4103](http://127.0.0.1:4103) or:

```bash
curl -s http://127.0.0.1:4103/api/card \
  -H 'content-type: application/json' \
  -d '{"title":"Ship a paid API","subtitle":"Agents pay over HTTP 402","tag":"hackathon","theme":"ink"}' \
  -o card.svg
```

```bash
curl -sG http://127.0.0.1:4103/api/card \
  --data-urlencode 'title=Ship a paid API' \
  --data-urlencode 'theme=signal' \
  -o card.svg
```

Discovery (unpaid):

- [http://127.0.0.1:4103/openapi.json](http://127.0.0.1:4103/openapi.json)
- [http://127.0.0.1:4103/llms.txt](http://127.0.0.1:4103/llms.txt)

## How to add MPP

Keep the SVG renderer. Charge `GET`/`POST /api/card`.

1. Create a server secret:

   ```bash
   openssl rand -hex 32
   ```

   Store it as `MPP_SECRET_KEY`.

2. Install the SDK:

   ```bash
   npm install mppx
   ```

3. Wrap the card route. From the [MPP server quickstart](https://mpp.dev/quickstart):

   ```text
   Reference https://mpp.dev/quickstart/server.md

   Add mppx to my server so GET and POST /api/card charge $0.01 using the Tempo payment method with pathUSD.
   Run `npx mppx validate <your-server>` as you develop.
   ```

   Unpaid request → `402`. Paid request → the same SVG, plus a Receipt.

4. Add `x-payment-info.offers[]` and a `402` response on `/api/card` in `/openapi.json`. Mention the price in `/llms.txt`.

5. Validate:

   ```bash
   npx mppx validate http://127.0.0.1:4103
   ```

6. Deploy, then submit the live URL to the hackathon.

Docs: [mpp.dev/quickstart](https://mpp.dev/quickstart) · [Discovery](https://mpp.dev/advanced/discovery)
