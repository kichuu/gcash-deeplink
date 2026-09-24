# Findings

What has actually been observed on a handset, separated from what is assumed.
Everything here came from tapping links on a real Android phone against live
merchant QRs.

## Settled

**The scheme works.** Links open GCash and complete real payments. This was not
a given — it is undocumented and could have been dead.

**Four of five standard variants work.** On a live dynamic QR, `minimal`,
`dynamic`, `static` and `swappedIds` all opened GCash and paid the correct
merchant.

**`merchantId` must be present.** The `noMerchantId` variant — identical in every
other respect — failed. This is the one control with a clean result, because it
was tapped in the same session as variants that succeeded.

**Routing ignores `merchantId`.** Payments landed on the correct merchant while
sending a `merchantId` belonging to an unrelated party. The payee comes from the
embedded `qrCode` and `tfrAcctNo`.

**28-03 is the merchant account, 62-05 is the reference.** Two QRs from the same
merchant shared a 28-03 and differed in 62-05. See
[protocol.md](./protocol.md#the-shop--reference-ambiguity).

## Unsettled

### Whether `merchantId`'s *value* is validated

A probe run varying only `merchantId` — `1`, a random 21-digit number, the
merchant's own code with each of its two acquirers — saw every probe fail while
the configured value worked.

**This result is confounded and should not be relied on.** Two other
explanations fit it equally well:

1. **The QR was spent.** The probes were tapped *after* a variant that
   succeeded. A dynamic QR with a fixed amount may be single-use, in which case
   every later tap fails regardless of `merchantId`.
2. **The QR expired mid-session.** These QRs were turning over in minutes.

Both produce exactly the observed pattern with `merchantId` being entirely
unvalidated.

### Whether `clientId` is needed at all

**No data.** Every link generated so far carried the same `clientId`. It has
never been omitted or varied. There is no evidence in either direction.

## How to settle them

The ordering is the whole experiment. A control tapped *first* cannot
distinguish "value rejected" from "QR already spent" — only a control tapped
*after* a failing probe can.

On a **fresh** QR, tap the probe **first**:

```
gcash-deeplink serve "<fresh qr>" --probe merchantId:garbage=1
```

- **Probe works** → the field is not validated. Earlier probe failures were
  exhaustion. Use your own identifier.
- **Probe fails** → now tap `minimal` on that same QR.
  - `minimal` works → the QR was alive, so the value really was rejected.
  - `minimal` also fails → the QR was dead. Inconclusive; start again.

Failed taps cost nothing, so this costs at most one payment.

The same shape settles `clientId`:

```
gcash-deeplink serve "<fresh qr>" --probe clientId:omitted= --probe clientId:garbage=1
```

`clientId:omitted=` drops the parameter entirely rather than sending it empty —
those are different experiments, and the builder distinguishes them.

## Why this matters beyond curiosity

If `merchantId` turns out to be validated, then every payment sent this way
transmits a third party's registered merchant identifier to GCash. That is a
different kind of problem from technical fragility, and worth raising with
whoever signs off before this goes near production.

If it is *not* validated, the field can carry your own identifier and nothing
borrowed remains except `clientId` — which is why settling `clientId` matters
too.

## Recording new results

Keep the distinction this file is built around: separate what was *observed*
from what it was *taken to mean*, and write down the tap order. Most of the
ambiguity above exists only because the order was not controlled the first time.
