/**
 * Solana address handling for Futurelite.
 *
 * Nothing here talks to the Solana network and nothing here holds a key. The
 * only job is to make sure an address pasted into the admin panel is a real,
 * well-formed Solana address before a customer is ever told to send money to
 * it.
 *
 * That matters more than it looks. A USDC transfer to a mistyped address is
 * gone — there is no chargeback, no support line, and no way to reverse it. One
 * wrong character costs a customer their money and costs the shop the order. So
 * the paste box validates every address on the way in, and the database repeats
 * the check as a constraint.
 */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Reverse lookup, built once. */
const BASE58_MAP = new Map<string, number>(
  BASE58_ALPHABET.split('').map((char, index) => [char, index]),
);

/**
 * Decodes base58 to bytes, or returns null if the string is not valid base58.
 *
 * Base58 deliberately omits 0, O, I and l because they are the characters
 * people misread. A string containing any of them is not a Solana address, and
 * catching that here is most of the value of this file.
 */
export function decodeBase58(input: string): Uint8Array | null {
  if (input.length === 0) return null;

  const bytes: number[] = [0];

  for (const char of input) {
    const value = BASE58_MAP.get(char);
    if (value === undefined) return null;

    let carry = value;
    for (let i = 0; i < bytes.length; i += 1) {
      // `?? 0` only to satisfy noUncheckedIndexedAccess: i is bounded by
      // bytes.length, so the element always exists.
      carry += (bytes[i] ?? 0) * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Each leading '1' in base58 is a leading zero byte.
  for (const char of input) {
    if (char !== '1') break;
    bytes.push(0);
  }

  return new Uint8Array(bytes.reverse());
}

// --- ed25519 curve check ---------------------------------------------------
// Solana addresses carry no checksum. Ethereum has EIP-55 mixed-case checksums
// and Bitcoin has a four-byte hash suffix; a raw ed25519 public key in base58
// has neither. So a dropped or transposed character can still decode to a
// perfectly well-formed 32 bytes, and length and alphabet checks will wave it
// through.
//
// What is left is the curve itself. A wallet address is a compressed ed25519
// public key, which means it has to be a point that actually lies on the curve.
// Roughly half of all random 32-byte values are not, so this rejects about half
// of the typos that survive every other check. Not a checksum, but the only
// mathematical handle available, and free.

const P = (1n << 255n) - 19n;
const D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

/**
 * True when the 32 bytes decompress to a point on the ed25519 curve.
 *
 * Program Derived Addresses are deliberately off-curve, so this would reject
 * one — which is correct here, because every address in the pool is meant to be
 * a wallet address from a phone.
 */
export function isOnCurve(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) return false;

  // Little-endian, with the top bit holding the sign of x rather than data.
  let y = 0n;
  for (let i = 31; i >= 0; i -= 1) {
    y = (y << 8n) | BigInt(bytes[i] ?? 0);
  }
  const sign = (y >> 255n) & 1n;
  y &= (1n << 255n) - 1n;

  if (y >= P) return false;

  // Recover x from the curve equation: x² = (y² - 1) / (d·y² + 1)
  const y2 = (y * y) % P;
  const numerator = (y2 - 1n + P) % P;
  const denominator = (D * y2 + 1n) % P;
  if (denominator === 0n) return false;

  const x2 = (numerator * modPow(denominator, P - 2n, P)) % P;
  if (x2 === 0n) return sign === 0n;

  // Candidate root, then confirm it really squares back to x².
  let x = modPow(x2, (P + 3n) / 8n, P);
  if ((x * x - x2) % P !== 0n) {
    const sqrtMinusOne = modPow(2n, (P - 1n) / 4n, P);
    x = (x * sqrtMinusOne) % P;
  }

  return (x * x - x2) % P === 0n;
}

/**
 * A Solana address is a 32-byte public key written in base58, which lands
 * between 32 and 44 characters. Length alone is not enough — "0OIl..." is the
 * right length and decodes to nothing — so this decodes properly, checks the
 * byte count, and then checks the point is on the curve.
 */
export function isValidSolanaAddress(address: string): boolean {
  const trimmed = address.trim();
  if (trimmed.length < 32 || trimmed.length > 44) return false;

  const decoded = decodeBase58(trimmed);
  if (decoded === null || decoded.length !== 32) return false;

  return isOnCurve(decoded);
}

/** The specific reason an address failed, so the paste box can say something useful. */
export function describeAddressProblem(address: string): string | null {
  const trimmed = address.trim();
  if (trimmed === '') return 'Empty line.';

  const bad = [...trimmed].filter((c) => !BASE58_MAP.has(c));
  if (bad.length > 0) {
    const unique = [...new Set(bad)].join(' ');
    // Worth naming these explicitly: they are the ones people mistype.
    return `Contains characters that never appear in a Solana address: ${unique}`;
  }

  if (trimmed.length < 32) return 'Too short to be a Solana address.';
  if (trimmed.length > 44) return 'Too long to be a Solana address.';

  const decoded = decodeBase58(trimmed);
  if (decoded === null) return 'Not valid base58.';
  if (decoded.length !== 32) {
    return `Decodes to ${decoded.length} bytes; a Solana address is 32.`;
  }
  if (!isOnCurve(decoded)) {
    return 'Not a valid Solana wallet address — check for a missed or swapped character.';
  }

  return null;
}

// --- USDC amounts ----------------------------------------------------------
// USDC has six decimals on Solana. Everything is stored as integer micros for
// the same reason CAD is stored as integer cents: floating point has no place
// anywhere near money.

export const USDC_DECIMALS = 6;
export const MICROS_PER_USDC = 1_000_000;

/** 36_500_000 -> "36.50". Two decimals, because that is what a person can type. */
export function formatUsdc(micros: number | bigint): string {
  const value = Number(micros) / MICROS_PER_USDC;
  return value.toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** "36.50" -> 36_500_000. Returns null on anything that is not a clean number. */
export function parseUsdcToMicros(input: string): number | null {
  const cleaned = input.trim().replace(/,/g, '').replace(/\s/g, '');
  if (!/^\d+(\.\d{1,6})?$/.test(cleaned)) return null;

  const [whole, fraction = ''] = cleaned.split('.');
  const padded = fraction.padEnd(USDC_DECIMALS, '0');
  return Number(whole) * MICROS_PER_USDC + Number(padded);
}

/**
 * Shortens an address for table display: first eight and last six characters.
 * Enough to eyeball a match against a wallet app without the address swallowing
 * the row.
 */
export function shortenAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

/**
 * A Solana Pay URL. Phantom and Solflare turn this into a prefilled send
 * screen, which removes the two ways a customer can get this wrong: pasting the
 * wrong address and typing the wrong amount.
 *
 * Plain address-and-amount instructions stay on screen as well, because not
 * every wallet handles these links and some customers pay from an exchange.
 */
export function solanaPayUrl({
  address,
  amountMicros,
  usdcMint,
  label,
  message,
}: {
  address: string;
  amountMicros: number;
  usdcMint: string;
  label: string;
  message: string;
}): string {
  const amount = (amountMicros / MICROS_PER_USDC).toFixed(2);
  const params = new URLSearchParams({
    amount,
    'spl-token': usdcMint,
    label,
    message,
  });
  return `solana:${address}?${params.toString()}`;
}

/**
 * The USDC mint on Solana mainnet. Pinned as a constant rather than configured,
 * because a wrong value here would tell customers to send a different token
 * entirely.
 */
export const USDC_MINT_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
