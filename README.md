# Agent service examples

Three small, working APIs an agent would actually call. None of them charge yet.

Clone the repo, pick one folder, run it, then add [MPP](https://mpp.dev/) so a request returns HTTP `402`, the client pays, and you send the result with a receipt. The paid path is **Tempo testnet** only — faucet funds, no real money.

| Folder | What an agent cannot do alone | Port |
| --- | --- | --- |
| [`invite`](./invite) | Turn a wall-clock time into a calendar file | `4101` |
| [`qr-code`](./qr-code) | Encode a string into a QR a phone will actually scan | `4102` |
| [`og-card`](./og-card) | Return a 1200×630 share image | `4103` |

Invite writes an `.ics` file with the timezone done correctly. QR is the one that needs a real encoder, not a drawing. OG Card is a layout helper. No API keys. Node 18+.

```bash
cd agent-service-examples/invite
npm start
```

Each folder README has the same three sections: **Test before MPP**, **How to add MPP** (using this command, or manually step by step), then **Test after MPP**.
