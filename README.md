# gcash-deeplink

Turn an EMV **QR Ph** payload into a **GCash deeplink** — a link that opens the
GCash app straight onto the payment confirmation screen, instead of asking the
payer to scan a code they cannot scan because it is on the phone they are
holding.

TypeScript, Node 22+, zero runtime dependencies.

```bash
gcash-deeplink build "00020101021228600011ph.ppmi.p2m0111TESTPHM1XXX..."
```
```
gcash://com.mynt.gcash/app/006300000800?qrCode=0002010102122860...&sub=p2mpay&...
```

---

> [!WARNING]
> **Unofficial and unsupported.** The `gcash://` scheme is not documented by GXI.
> It was derived from observed traffic and can break in any release of the app,
> silently. It is also **real money** — a working link completes an actual
> payment, not a simulation.
>
> Always render the QR underneath as the real rail, and never treat "GCash
> opened" as "payment initiated". Your acquirer's webhook remains the only
> authority on payment state.

---

## Why this exists

QR Ph is the Philippines' national QR standard (BSP Circular 1055, built on
EMVCo MPM). It standardises the payload and nothing else. Unlike India's UPI —
where `upi://pay` is a defined intent any app must handle — QR Ph has no handoff
mechanism at all. The assumption is a human with a camera.

So a payer checking out on their phone has no supported path into their wallet
app. This project implements the unsupported one.

## Requirements

Node **22.18 or newer**. The repo runs TypeScript directly via Node's built-in
type stripping.

```bash
nvm use 22
npm install     # only devDependencies: typescript, @types/node
```

### Configuration

Two identifiers travel with every link and are **not committed to this repo**:

```bash
cp .env.example .env    # then fill both in
# or
export GCASH_CLIENT_ID=...
export GCASH_MERCHANT_ID=...
```

Building a link without them throws `MissingConfigError` naming the missing
variable, rather than substituting a placeholder — a wrong identifier produces a
link that opens GCash and then fails at the confirmation screen, which is a much
more expensive way to find out.

Neither is a secret in the cryptographic sense: the whole URL is plaintext and
the scheme has no signature. They are configuration because they are values
observed in someone else's traffic, not because disclosure breaks anything. See
[docs/protocol.md](./docs/protocol.md#the-two-identifiers).

## Commands

Run through `node src/cli.ts`, or install the repo and use `gcash-deeplink`.

### `decode` — inspect a payload

```bash
node src/cli.ts decode "00020101021228600011ph.ppmi.p2m..."
```
```
=== decoded QR Ph ===
  merchant              Demo Store!
  city                  Test City
  amount                160
  bank code             TESTPHM1XXX
  shop id (28-03)       1000000000000000001
  reference (62-05)     2000000000000000002
  init method           12 (dynamic — expires)
  crc                   E371 valid
```

Start here when something fails. A CRC mismatch means the payload is truncated
or mistyped, and GCash will reject it regardless of the link.

### `build` — print deeplinks

```bash
# every variant
node src/cli.ts build "<qr>"

# one variant, nothing else — pipe it somewhere
node src/cli.ts build "<qr>" --variant minimal

# with the intent:// form and an adb command
node src/cli.ts build "<qr>" --variant minimal --intent --adb

# machine-readable
node src/cli.ts build "<qr>" --json
```

### `page` — write the tap-through HTML

```bash
node src/cli.ts page "<qr>" -o out.html
node src/cli.ts page "<qr-a>" "<qr-b>" -o out.html   # one section each
```

Every variant becomes a pair of buttons, `gcash://` and `intent://`. Hand it to
whoever is holding the Android phone.

### `serve` — render and serve it

```bash
node src/cli.ts serve "<qr>"
node src/cli.ts serve "<qr>" --port 3003
```
```
serving 1 section(s), 5 variant(s) on port 3003
  local   http://127.0.0.1:3003/
  lan     http://192.168.1.8:3003/
```

Every path returns the page — it is not a static file server, so pointing a
tunnel at it cannot expose anything on disk. Useful when the tester is not on
your network.

## Variants

There is no documentation saying which link shape GCash accepts, and the failure
mode is quiet: the app opens and then declines. So the tools generate the whole
matrix and you tap through it.

| Variant | What it changes |
|---|---|
| `minimal` | Standard P2M (`paymentType` 000) |
| `dynamic` | Dynamic (010) with a generated `orderId` |
| `static` | Static (001) |
| `swappedIds` | Exchanges shop id (28-03) and reference label (62-05) |
| `noMerchantId` | Drops `merchantId` — known to fail, kept as a control |
| `withCallback` | Only when `--redirect-url` or `--notify-url` is given |

## Probing a single field

`--probe` builds a variant that is the `minimal` link with exactly one
identifier changed, so a difference in outcome can only come from that field.

```bash
node src/cli.ts serve "<qr>" \
  --probe merchantId:garbage=1 \
  --probe clientId:omitted=
```

An empty value omits the parameter entirely rather than sending it empty —
those are different experiments.

**Tap probes before any link that succeeds.** A dynamic QR may be single-use, so
once one tap goes through, every later tap fails regardless of the field being
probed — which reads exactly like a rejection.
[docs/findings.md](./docs/findings.md) explains how this already confounded one
round of results.

## Library use

```ts
import { parseQrph, buildDeeplink, toAndroidIntent } from './src/index.ts';

const parsed = parseQrph(qr);
if (!parsed.crcValid) throw new Error('bad QR');

const link = buildDeeplink(parsed, { orderId: 'ORDER-1' });
const forBrowser = toAndroidIntent(link);   // Chrome on Android needs this form
```

Also exported: `buildVariants`, `buildProbes`, `renderPage`, `startServer`,
`parseTlv`, `crc16`, and the protocol constants.

## Development

```bash
npm test         # node --test, 87 assertions, no test framework
npm run typecheck
```

Tests run against synthetic payloads modelled on two acquirers' differing
conventions: numeric versus alphanumeric shop ids, `ph.ppmi.p2m` versus
`ph.starpay` namespaces in tag 62, space-padded fields, and reference labels
containing `#`. No real merchant payload is committed — every fixture is
generated with a valid CRC.

### Why there is no build step

Node 22 strips types at runtime, so relative imports must carry real `.ts`
extensions — a `.js` specifier resolves to nothing on disk. This repo is run
rather than published, so it leans into that: `tsc` is configured `noEmit` and
used only for typechecking. To publish to npm later you would add
`rewriteRelativeImportExtensions` and a real emit target.

`erasableSyntaxOnly` is on, so enums, namespaces and constructor parameter
properties are rejected at typecheck time rather than failing at runtime.

## Documentation

- **[docs/protocol.md](./docs/protocol.md)** — the URL, every query parameter,
  `param3`/`param5` layouts, encoding rules, and failure modes.
- **[docs/findings.md](./docs/findings.md)** — what has been tested on a
  handset, what is still unknown, and the experiment design that separates the
  two.

## License

MIT. See [LICENSE](./LICENSE).

The protocol itself is not covered by this license — it is an observed fact
about someone else's application, reimplemented here from scratch.
