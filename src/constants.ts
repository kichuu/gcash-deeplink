/**
 * Protocol constants for the GCash scan-to-pay deeplink.
 *
 * The structural values below are facts about the URL format. The two
 * identifiers are NOT here — they are configuration, read from the
 * environment. See {@link getClientId} and {@link getMerchantId}.
 *
 * None of this is documented or supported by GXI, and any of it can change
 * without notice. See docs/protocol.md for what each value does and
 * docs/findings.md for what has actually been tested on a handset.
 */

/**
 * GCash's internal scan-to-pay mini-program.
 *
 * The trailing path segment is the mini-app id and is the same for everyone —
 * it is not a merchant identifier.
 */
export const GCASH_BASE_URL = 'gcash://com.mynt.gcash/app/006300000800';

/** Android package name, used to build the `intent://` fallback form. */
export const GCASH_ANDROID_PACKAGE = 'com.globe.gcash.android';

/** Routes the mini-program to its person-to-merchant handler. */
export const GCASH_SUB = 'p2mpay';

/** The QR Ph domestic P2M namespace, as it appears in EMV sub-tag 00. */
export const QRPH_P2M_UID = 'ph.ppmi.p2m';

/**
 * Payment type, the last field of `param3`.
 *
 * Only these three have been seen in the wild. Anything else is guesswork.
 */
export const PaymentType = {
  /** Standard P2M. */
  Standard: '000',
  /** Dynamic QR (amount fixed by the merchant). */
  Dynamic: '010',
  /** Static QR (payer enters the amount). */
  Static: '001',
} as const;

export type PaymentTypeValue = (typeof PaymentType)[keyof typeof PaymentType];

export const CLIENT_ID_ENV = 'GCASH_CLIENT_ID';
export const MERCHANT_ID_ENV = 'GCASH_MERCHANT_ID';

/**
 * Thrown when a required identifier is not configured.
 *
 * Deliberately not a silent fallback: a link built with a placeholder would
 * look fine, open GCash, and fail at the confirmation screen with no clue why.
 */
export class MissingConfigError extends Error {
  readonly variable: string;

  constructor(variable: string) {
    super(
      `${variable} is not set.\n\n` +
        `This value is configuration, not a constant — it is deliberately not ` +
        `committed to this repository.\n` +
        `Set it in your environment or a local .env file (see .env.example):\n\n` +
        `    export ${variable}=...\n\n` +
        `See docs/protocol.md "The two identifiers" for what it is and how to ` +
        `obtain one.`,
    );
    this.name = 'MissingConfigError';
    this.variable = variable;
  }
}

function fromEnv(variable: string): string {
  const value = process.env[variable];
  if (value === undefined || value.trim() === '') throw new MissingConfigError(variable);
  return value.trim();
}

/**
 * The `clientId` sent with every link.
 *
 * Whether GCash requires it, validates it, or ignores it is UNTESTED — no probe
 * run so far has varied it. See docs/findings.md.
 */
export function getClientId(): string {
  return fromEnv(CLIENT_ID_ENV);
}

/**
 * The `merchantId` sent with every link.
 *
 * This is NOT the id of whoever is being paid — routing is done entirely by the
 * embedded QR and `tfrAcctNo`. Omitting it fails; whether a different value
 * works is unsettled. Read docs/findings.md before depending on any particular
 * value here.
 */
export function getMerchantId(): string {
  return fromEnv(MERCHANT_ID_ENV);
}
