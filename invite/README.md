# Invite

An agent can name a time. It is bad at timezones, line folding, and event ids. This returns an `.ics` file a calendar app will open on the right instant.

This starter is unpaid. Add MPP after you have seen it work.

## What it does

`GET` or `POST /api/invite` returns `text/calendar`.

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | Up to 200 characters |
| `start` | yes | `YYYY-MM-DDTHH:mm` in `timezone`, or an ISO time with `Z` or an offset |
| `timezone` | no | IANA name. Default `UTC`. Used when `start` has no offset |
| `duration_minutes` | no | Integer from 5 to 1440. Default 30 |
| `location` | no | Up to 200 characters |
| `description` | no | Up to 2000 characters |

Times in the file are UTC. A local time that does not exist when clocks spring forward is rejected. A time that happens twice when clocks fall back is one of those two instants.

```bash
cd invite
npm start
```

Open [http://127.0.0.1:4101](http://127.0.0.1:4101). Download the file and open it in Calendar.

## Test before MPP

A build should return **200** and start with `BEGIN:VCALENDAR`. It must not return **402**.

15:00 in London on 15 Oct 2026 is still British Summer Time, so the file should contain `DTSTART:20261015T140000Z`.

```bash
curl -s -D - -o invite.ics http://127.0.0.1:4101/api/invite \
  -H 'content-type: application/json' \
  -d '{"title":"Ship review","start":"2026-10-15T15:00","timezone":"Europe/London","duration_minutes":30,"location":"Room 4"}'
```

```bash
grep DTSTART invite.ics
# DTSTART:20261015T140000Z
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://127.0.0.1:4101/api/invite?title=Ship%20review&start=2026-10-15T15:00&timezone=Europe/London'
# expect 200
```

Discovery (still unpaid): [openapi.json](http://127.0.0.1:4101/openapi.json) · [llms.txt](http://127.0.0.1:4101/llms.txt).

## How to add MPP

Charge `GET` and `POST /api/invite`. Keep the calendar builder as it is.

Stay on **Tempo testnet**. `testnet: true` and `--network testnet` only. Fund from the faucet. Do not take real money.

### 1. Using this command

```text
Reference https://mpp.dev/quickstart/server.md

Add mppx to this Node server so GET and POST /api/invite charge $0.01 per request using Tempo pathUSD on testnet only (testnet: true, no mainnet, no real funds).
Add x-payment-info.offers[] and a 402 response on /api/invite in /openapi.json. Mention the price in /llms.txt.
Run `npx mppx validate http://127.0.0.1:4101 --network testnet` as you develop.
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

3. Wrap the invite route. These servers use Node `http`, so use `mppx/server` (and `Mppx.toNodeListener` if you stay on `IncomingMessage`):

   ```js
   import { Mppx, tempo } from "mppx/server";

   const mppx = Mppx.create({
     methods: [
       tempo.charge({
         currency: process.env.TEMPO_CURRENCY, // pathUSD — see mpp.dev/quickstart/server.md
         recipient: process.env.TEMPO_RECIPIENT,
         testnet: true, // required — faucet pathUSD, not live funds
       }),
     ],
     secretKey: process.env.MPP_SECRET_KEY,
   });

   const payment = await mppx.charge({ amount: "0.01" })(request);
   if (payment.status === 402) return payment.challenge;
   return payment.withReceipt(new Response(ics, { headers: { "content-type": "text/calendar; charset=utf-8" } }));
   ```

4. On `/api/invite` in `/openapi.json`, add `x-payment-info.offers[]` and a `402` response. Note the price in `/llms.txt`.

Docs: [Server quickstart](https://mpp.dev/quickstart/server.md) · [Discovery](https://mpp.dev/advanced/discovery)

## Test after MPP

Still testnet. An unpaid build must now return **402**, not the calendar file:

```bash
curl -i http://127.0.0.1:4101/api/invite \
  -H 'content-type: application/json' \
  -d '{"title":"Ship review","start":"2026-10-15T15:00","timezone":"Europe/London"}'
```

Then run the official checker and a paid request:

```bash
npx mppx validate http://127.0.0.1:4101 --network testnet
npx mppx account create --network testnet
npx mppx account fund --network testnet
npx mppx http://127.0.0.1:4101/api/invite \
  --network testnet \
  --method POST \
  --json-body '{"title":"Ship review","start":"2026-10-15T15:00","timezone":"Europe/London"}'
```

You should get the `.ics` file plus a receipt. Deploy the paid service, then submit the live URL to the hackathon.
