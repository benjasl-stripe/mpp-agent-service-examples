# Call Later

An agent can fetch a web page itself. It cannot stay alive for five minutes and then fire a request. This service does that: you hand it JSON and a delay; it holds the work after the agent has moved on.

This service works now. It does **not** charge. MPP is the next step, not part of the starter.

## What it does

`POST /api/jobs` schedules a job:

| Field | Required | Notes |
| --- | --- | --- |
| `delay_seconds` | yes | Integer from 1 to 3600 |
| `payload` | no | Any JSON. Default `{}` |
| `callback_url` | no | If set, this server POSTs `{ job_id, run_at, payload }` there when due |

`GET /api/jobs/:id` returns the job. `status` is `scheduled`, then either `ready` (no callback — just held), `delivered` (callback got a response), or `failed`.

Why an agent would pay: retry a webhook, poll a slow job, or remind another service after the model’s turn is over. The process keeps running; the chat does not.

Loopback (`127.0.0.1`) is allowed so you can fire into a server on this machine. Cloud metadata and LAN ranges are blocked. Jobs are in memory and expire 30 minutes after they run.

## How to use it

```bash
cd agent-service-examples/call-later
npm start
```

Open [http://127.0.0.1:4101](http://127.0.0.1:4101) and schedule an 8 second hold, or:

```bash
JOB=$(curl -s -X POST http://127.0.0.1:4101/api/jobs \
  -H 'content-type: application/json' \
  -d '{"delay_seconds":8,"payload":{"check":"invoice-42"}}')
echo "$JOB"
ID=$(node -e "console.log(JSON.parse(process.argv[1]).id)" "$JOB")
sleep 9
curl -s http://127.0.0.1:4101/api/jobs/$ID
```

To see it call something else, point `callback_url` at any URL that accepts POST.

Discovery (unpaid):

- [http://127.0.0.1:4101/openapi.json](http://127.0.0.1:4101/openapi.json)
- [http://127.0.0.1:4101/llms.txt](http://127.0.0.1:4101/llms.txt)

## How to add MPP

Charge `POST /api/jobs`. Leave `GET /api/jobs/:id` unpaid so the agent can poll without paying again.

1. Create a server secret:

   ```bash
   openssl rand -hex 32
   ```

   Store it as `MPP_SECRET_KEY`.

2. Install the SDK:

   ```bash
   npm install mppx
   ```

3. Wrap the create route. From the [MPP server quickstart](https://mpp.dev/quickstart):

   ```text
   Reference https://mpp.dev/quickstart/server.md

   Add mppx to my server so POST /api/jobs charges $0.01 using the Tempo payment method with pathUSD.
   Leave GET /api/jobs/:id unpaid. Run `npx mppx validate <your-server>` as you develop.
   ```

   Unpaid create → `402`. Paid create → the same job JSON, plus a Receipt.

4. Add `x-payment-info.offers[]` and a `402` response on `POST /api/jobs` in `/openapi.json`. Mention the price in `/llms.txt`.

5. Validate:

   ```bash
   npx mppx validate http://127.0.0.1:4101
   ```

6. Deploy, then submit the live URL to the hackathon.

Docs: [mpp.dev/quickstart](https://mpp.dev/quickstart) · [Discovery](https://mpp.dev/advanced/discovery)
