# Call Later

An agent cannot stay alive for five minutes and then fire a request. This service can: you hand it JSON and a delay; it holds the work after the agent has moved on.

This starter is unpaid. Add MPP after you have seen it work.

## What it does

`POST /api/jobs` schedules a job:

| Field | Required | Notes |
| --- | --- | --- |
| `delay_seconds` | yes | Integer from 1 to 3600 |
| `payload` | no | Any JSON. Default `{}` |
| `callback_url` | no | If set, this server POSTs `{ job_id, run_at, payload }` there when due |

`GET /api/jobs/:id` returns the job. `status` is `scheduled`, then `ready` (held, no callback), `delivered`, or `failed`.

Loopback (`127.0.0.1`) is allowed so you can fire into a server on this machine. Cloud metadata and LAN ranges are blocked. Jobs are in memory and expire 30 minutes after they run.

```bash
cd call-later
npm start
```

Open [http://127.0.0.1:4101](http://127.0.0.1:4101).

## Test before MPP

A create should return **201** with `"status":"scheduled"`. It must not return **402**.

```bash
JOB=$(curl -s -X POST http://127.0.0.1:4101/api/jobs \
  -H 'content-type: application/json' \
  -d '{"delay_seconds":8,"payload":{"check":"invoice-42"}}')
echo "$JOB"
```

Wait, then poll. After ~8 seconds `status` should be `ready`:

```bash
ID=$(node -e "console.log(JSON.parse(process.argv[1]).id)" "$JOB")
sleep 9
curl -s http://127.0.0.1:4101/api/jobs/$ID
```

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:4101/api/jobs \
  -H 'content-type: application/json' \
  -d '{"delay_seconds":8,"payload":{"check":"invoice-42"}}'
# expect 201
```

Discovery (still unpaid): [openapi.json](http://127.0.0.1:4101/openapi.json) · [llms.txt](http://127.0.0.1:4101/llms.txt).

## How to add MPP

Charge `POST /api/jobs`. Leave `GET /api/jobs/:id` unpaid so polling does not cost again.

### 1. Using this command

```text
Reference https://mpp.dev/quickstart/server.md

Add mppx to this Node server so POST /api/jobs charges $0.01 per request using the Tempo payment method with pathUSD (testnet: true while developing).
Leave GET /api/jobs/:id unpaid.
Add x-payment-info.offers[] and a 402 response on POST /api/jobs in /openapi.json. Mention the price in /llms.txt.
Run `npx mppx validate http://127.0.0.1:4101` as you develop.
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

3. Wrap only the create route. These servers use Node `http`, so use `mppx/server` (and `Mppx.toNodeListener` if you stay on `IncomingMessage`):

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

   // around POST /api/jobs
   const payment = await mppx.charge({ amount: "0.01" })(request);
   if (payment.status === 402) return payment.challenge;
   return payment.withReceipt(Response.json(job, { status: 201 }));
   ```

4. On `POST /api/jobs` in `/openapi.json`, add `x-payment-info.offers[]` and a `402` response. Note the price in `/llms.txt`.

Docs: [Server quickstart](https://mpp.dev/quickstart/server.md) · [Discovery](https://mpp.dev/advanced/discovery)

## Test after MPP

An unpaid create must now return **402**, not 201:

```bash
curl -i -X POST http://127.0.0.1:4101/api/jobs \
  -H 'content-type: application/json' \
  -d '{"delay_seconds":8,"payload":{"check":"invoice-42"}}'
```

Poll stays free:

```bash
curl -i http://127.0.0.1:4101/api/jobs/SOME_ID
# 200 or 404 — not 402
```

Then run the official checker and a paid request:

```bash
npx mppx validate http://127.0.0.1:4101
npx mppx account create --network testnet
npx mppx account fund --network testnet
npx mppx http://127.0.0.1:4101/api/jobs \
  --network testnet \
  --method POST \
  --json-body '{"delay_seconds":8,"payload":{"check":"invoice-42"}}'
```

You should get the job JSON plus a receipt. Deploy the paid service, then submit the live URL to the hackathon.
