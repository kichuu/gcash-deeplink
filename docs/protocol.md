# The GCash scan-to-pay deeplink

Everything here was derived from observing GCash traffic. **None of it is
documented or supported by GXI.** It can change or disappear in any release of
the app, with no notice and no deprecation window.

## Why a deeplink is needed at all

QR Ph is the Philippines' national QR standard, mandated by the BSP under
Circular 1055 and built on EMVCo's Merchant-Presented Mode. It standardises the
*payload* only. Unlike India's UPI, which defines a `upi://pay` intent that any
app must handle, QR Ph defines no handoff mechanism whatsoever — the assumption
throughout is that a human points a camera at a printed code.

That leaves a gap. A payer already holding their phone, looking at a checkout
page on that same phone, cannot scan a QR displayed on it. There is no official
answer to this. The link below is the unofficial one.

## The URL

```
gcash://com.mynt.gcash/app/006300000800?<query>
```

`com.mynt.gcash` is the app's internal authority and `006300000800` is the
mini-program id for the scan-to-pay handler. Both are fixed — `006300000800`
is **not** a merchant identifier, it is the same for everyone.

### Android: use the intent form from a browser

Chrome on Android refuses to follow an unrecognised custom scheme from a link in
most contexts. Rewriting it as an Android intent URL, naming the scheme and
target package explicitly, does get handed off:

```
intent://com.mynt.gcash/app/006300000800?<query>#Intent;scheme=gcash;package=com.globe.gcash.android;end
```

Use `intent://` from a web page and plain `gcash://` from native code or `adb`.
`toAndroidIntent()` does this rewrite.

Because the fragment delimiter is `#`, any `#` inside the query must be
percent-encoded or it truncates the link. Some acquirers issue reference labels
shaped like `OR#TEST01`, so this is not hypothetical.

## Query parameters

| Parameter | Source | Notes |
|---|---|---|
| `qrCode` | the whole EMV payload | Verbatim. This is what actually routes the payment. |
| `qrCodeFormat` | constant `EMVCO` | |
| `sub` | constant `p2mpay` | Selects the person-to-merchant handler. |
| `bizNo` | constant `null` | Literally the string `null`. |
| `orderAmount` | EMV tag 54 | Empty on a static QR, where the payer chooses. |
| `merchantName` | EMV tag 59 | |
| `merchantCity` | EMV tag 60 | |
| `merchantCategoryCode` | EMV tag 52 | |
| `tfrbnkcode` | merchant template 01 | Acquirer BIC, e.g. `TESTPHM1XXX`, `TESTPHM2XXX`. |
| `shopId` | merchant template 03 | The merchant's account with that acquirer. |
| `tfrAcctNo` | template 04, else 03 | The payee account. |
| `acqInfo` | tag 62 sub-tag 05 | Reference label. Usually per-transaction. |
| `param3` | composed | See below. |
| `param5` | composed | See below. |
| `clientId` | configuration | See "The two identifiers". |
| `merchantId` | configuration | See "The two identifiers". |
| `orderId` | caller | Optional. Merchant's own reference. |
| `redirectUrl` / `returnUrl` | caller | Optional, same value in both. |
| `notifyUrl` / `callbackUrl` | caller | Optional, same value in both. Public HTTPS. |
| `lucky` | constant `false` | Purpose unknown. |

### param3

```
99960005~ph.ppmi.p2m~~~<paymentType>
```

Five tilde-separated fields, three of them empty. `paymentType` is one of:

| Code | Meaning |
|---|---|
| `000` | Standard P2M |
| `010` | Dynamic QR (amount fixed by merchant) |
| `001` | Static QR (payer enters amount) |

### param5

```
<shopId>~<merchantName>~<terminalLabel>~<acqInfo>
```

A packed duplicate of fields already sent individually. Omitted when there is no
shop id.

## Encoding

Spaces must be `%20`, never `+`. Android's `Uri.getQueryParameter()` does not
undo form encoding, so a `+` arrives as a literal plus.

`!`, `'`, `(`, `)` and `*` are escaped, matching GCash's own links — a merchant
named `Demo Store!` becomes `Click%20KO%21`.

`~` is left bare: `param3` and `param5` use it as a field separator.

## The shop / reference ambiguity

Acquirers disagree about which EMV field holds the stable merchant identifier
and which holds the per-transaction reference. Two QRs from the same merchant
make the convention visible:

| | tag 28-03 | tag 62-05 | display name |
|---|---|---|---|
| QR 1 | `1000000000000000001` | `2000000000000000003` | Demo Shop |
| QR 2 | `1000000000000000001` | `2000000000000000002` | Demo Store! |

28-03 is constant, 62-05 changes per transaction. So 28-03 is the merchant
account and 62-05 is the reference — the default mapping. (Both display names
ride on one underlying account, which is a merchant-side naming feature, not a
protocol one.)

The `swappedIds` variant exchanges them for acquirers that do it the other way.
It is ignored when tag 28-04 (destination account) is present, since that pins
the payee unambiguously.

## The two identifiers

`clientId` and `merchantId` are fixed values observed in GCash traffic. They do
**not** identify whoever is being paid — routing is entirely by `qrCode` and
`tfrAcctNo`.

They are **not committed to this repository**. Supply them through the
environment:

```
GCASH_CLIENT_ID=...
GCASH_MERCHANT_ID=...
```

Building a link without them throws `MissingConfigError` rather than falling
back to a placeholder — a link with a wrong identifier opens GCash and then
fails at the confirmation screen, which is a far more expensive way to discover
the value is missing.

Neither is a secret in the cryptographic sense: the whole URL travels in
plaintext, there is no signature anywhere in the scheme, and the payload's
integrity comes from the embedded QR's own CRC and the acquirer's server-side
validation. They are treated as configuration because a value observed in
someone else's traffic is not ours to publish, not because disclosure breaks
anything.

What is actually known about them is in [findings.md](./findings.md). The short
version: omitting `merchantId` fails, and everything else is unsettled.

## Failure modes

The scheme fails quietly. GCash opens, then declines, usually with
*"Transaction Failed — No amount was deducted"* and a reference number. Causes
worth ruling out, roughly in order:

1. **The QR expired.** Dynamic QRs are typically valid 15–30 minutes. Check EMV
   tag 01: `12` means dynamic.
2. **The QR was already paid.** A dynamic QR carries a fixed amount and may be
   single-use. This is the most common reason a *second* tap fails when the
   first succeeded — and the most common way to mistake exhaustion for a
   rejected parameter.
3. **Merchant not enabled for P2M** with the acquirer.
4. **Wrong field mapping** — try `swappedIds`.
5. **Malformed payload.** Validate the CRC first; `decode` reports it.

A payment that reaches "Payment confirmation in progress" and stalls is usually
a callback problem: `notifyUrl` must be public HTTPS and actually reachable.

## What this does not change

A working deeplink is a convenience on top of the QR, not a replacement for it:

- **Always render the QR underneath.** The deeplink is unsupported; the QR is
  the actual rail.
- **"GCash opened" is not "payment initiated".** The acquirer's webhook remains
  the only authority on payment state, exactly as it is for a scanned QR.
