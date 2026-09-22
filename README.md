# Agent service examples

Three small, working APIs an agent would actually call. None of them charge yet.

Clone the repo, pick one folder, run it, then add [MPP](https://mpp.dev/) so a request returns HTTP `402`, the client pays, and you send the result with a receipt.

| Folder | What an agent cannot do alone | Port |
| --- | --- | --- |
| [`call-later`](./call-later) | Stay alive and fire work after the chat ends | `4101` |
| [`qr-code`](./qr-code) | Encode a string into a QR a phone will actually scan | `4102` |
| [`og-card`](./og-card) | Return a 1200×630 share image | `4103` |

Call Later is the one that needs a process. QR is the one that needs a real encoder, not a drawing. OG Card is a layout helper. No API keys. Node 18+.

```bash
cd agent-service-examples/call-later
npm start
```

Each folder README has the same three sections: **Test before MPP**, **How to add MPP** (using this command, or manually step by step), then **Test after MPP**.
